import { beforeAll, beforeEach, describe, expect, jest, test } from "@jest/globals";
import express from "express";
import request from "supertest";
import { auditLogs, invoices } from "@shared/schema";

const customer = { id: "customer", organizationId: "org", companyName: "Fixture Customer" };
const releasedInvoice = {
  id: "invoice", organizationId: "org", customerId: customer.id, invoiceNumber: 20001,
  status: "billed", totalCents: 25000, currency: "USD", invoiceVersion: 2,
  customerReleasedAt: new Date("2026-01-01T00:00:00Z"),
};
let invoice = { ...releasedInvoice };

// Both routes load the same synthetic invoice. The empty payment and claim
// rows model an invoice with no existing settlement or processor attempt.
const select = jest.fn((fields?: Record<string, unknown>) => ({
  from(table: unknown) {
    const rows = table !== invoices ? [] : [
      fields && "invoice" in fields ? { invoice, customer }
        : { ...invoice, storedCustomerId: customer.id, billingCustomerId: customer.id },
    ];
    const query = {
      leftJoin: () => query,
      where: () => query,
      groupBy: () => query,
      orderBy: () => query,
      limit: async () => rows,
      then: (resolve: (result: typeof rows) => unknown) => Promise.resolve(rows).then(resolve),
    };
    return query;
  },
}));
const insert = jest.fn((_table: unknown) => ({ values: async () => undefined }));
const reserve = jest.fn(async (input: { amountCents: number; stripeAccountId: string; metadata: unknown }) => ({
  attempt: { ...input, id: "fixture-attempt" },
}));
const resume = jest.fn(async () => ({
  id: "pi_fixture", client_secret: "fixture-secret", status: "requires_payment_method",
}));
const recordIntent = jest.fn(async () => undefined);
const getStripeClient = jest.fn(() => ({}));
const runtime = jest.fn(async () => ({ ok: true, data: { connectedAccountId: "acct_fixture" } }));
const staffUrl = "/api/invoices/invoice/payments/stripe/create-intent";
const portalInvoiceUrl = "/api/portal/invoices/invoice";
const portalUrl = `${portalInvoiceUrl}/payments/stripe/create-intent`;
let staffApp: express.Express;
let portalApp: express.Express;
let portalRole: "BILLING" | "VIEWER";

beforeAll(async () => {
  jest.unstable_mockModule("../db", () => ({
    db: { select, insert },
    hasQuoteAttachmentPagesTable: () => true,
    hasPageCountStatusColumn: () => true,
  }));
  jest.unstable_mockModule("../lib/stripe", () => ({
    getStripeClient,
    assertStripeServerConfig: jest.fn(),
    getStripeWebhookSecret: jest.fn(),
  }));
  jest.unstable_mockModule("../services/stripeRuntimeConfig.service", () => ({
    resolveStripeRuntimeConfig: runtime,
  }));
  jest.unstable_mockModule("../services/stripePaymentAttempt.service", () => ({
    reserveStripePaymentAttempt: reserve,
    resumeStripePaymentAttemptIntent: resume,
    recordStripePaymentAttemptIntent: recordIntent,
    assertStripeAttemptIntent: jest.fn(),
    findStripePaymentAttempt: jest.fn(),
    retireCanceledStripeAttempt: jest.fn(),
    markStripePaymentAttemptTerminalForPayment: jest.fn(),
  }));

  const { registerMvpInvoicingRoutes } = await import("../routes/mvpInvoicing.routes");
  const { registerPortalRoutes } = await import("../routes/portal.routes");
  const tenantContext: express.RequestHandler = (req, _res, next) => {
    req.organizationId = customer.organizationId;
    next();
  };
  staffApp = express();
  await registerMvpInvoicingRoutes(staffApp, {
    tenantContext,
    isAuthenticated: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
      req.user = { id: "staff", role: "admin" };
      next();
    },
    requireOrgOwnerAdmin: (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
  });
  portalApp = express();
  registerPortalRoutes(portalApp, {
    tenantContext,
    isAuthenticated: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
      req.user = { id: "portal-user" };
      next();
    },
    portalContext: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
      Object.assign(req, {
        organizationId: customer.organizationId, portalCustomerId: customer.id, portalCustomer: customer,
        portalAccess: {
          organizationId: customer.organizationId, customerId: customer.id, userId: "portal-user",
          status: "ACTIVE", accessRole: portalRole,
        },
      });
      next();
    },
  });
});

beforeEach(() => {
  jest.clearAllMocks();
  invoice = { ...releasedInvoice };
  portalRole = "BILLING";
});

describe("V1 payment eligibility parity", () => {
  test.each([
    { status: "void", totalCents: 25000, reason: "Void invoices cannot accept payment." },
    { status: "billed", totalCents: 0, reason: "Invoice is already paid." },
  ])("staff and portal refuse checkout for $status with $totalCents cents", async ({ status, totalCents, reason }) => {
    invoice = { ...invoice, status, totalCents };
    const detail = await request(portalApp).get(portalInvoiceUrl).expect(200);
    expect(detail.body.data.paymentEligibility).toEqual({ payable: false, blockedReason: reason });
    const staff = await request(staffApp).post(staffUrl).expect(400);
    expect(staff.body).toEqual({ success: false, error: reason });
    const portal = await request(portalApp).post(portalUrl).expect(409);
    expect(portal.body).toEqual({ success: false, message: reason });
    expect(reserve).not.toHaveBeenCalled();
    expect(getStripeClient).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
  });

  test("a paid label with a remaining balance still lets staff and authorized portal customers open checkout", async () => {
    invoice = { ...invoice, status: "paid" };
    const detail = await request(portalApp).get(portalInvoiceUrl).expect(200);
    expect(detail.body.data.paymentEligibility).toMatchObject({ payable: true });
    const session = await request(portalApp).get("/api/portal/me").expect(200);
    expect(session.body.data.permissions.canPayInvoices).toBe(true);

    for (const [app, url] of [[staffApp, staffUrl], [portalApp, portalUrl]] as const) {
      const checkout = await request(app).post(url).expect(200);
      expect(checkout.body).toMatchObject({ success: true, data: { clientSecret: "fixture-secret", paymentId: null } });
    }
    expect(reserve.mock.calls.map(([input]) => input)).toEqual([
      expect.objectContaining({ channel: "staff", amountCents: 25000 }),
      expect.objectContaining({ channel: "portal", amountCents: 25000 }),
    ]);
    expect(insert.mock.calls).toEqual([[auditLogs], [auditLogs]]);
  });

  test("a portal viewer can read the invoice but cannot initiate a payment", async () => {
    portalRole = "VIEWER";
    const session = await request(portalApp).get("/api/portal/me").expect(200);
    expect(session.body.data.permissions.canPayInvoices).toBe(false);
    const detail = await request(portalApp).get(portalInvoiceUrl).expect(200);
    expect(detail.body.data.paymentEligibility).toMatchObject({ payable: false, reasonCode: "CUSTOMER_ACCESS_DENIED" });

    select.mockClear();
    const checkout = await request(portalApp).post(portalUrl).expect(403);
    expect(checkout.body).toMatchObject({ success: false, message: expect.stringContaining("does not permit") });
    expect(select).not.toHaveBeenCalled();
    expect(reserve).not.toHaveBeenCalled();
    expect(getStripeClient).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
  });
});
