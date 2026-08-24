import { jest } from "@jest/globals";
import express from "express";
import request from "supertest";

const resolveOrderPayment = jest.fn<(...args: any[]) => Promise<any>>();

jest.mock("../services/payments/paymentOrchestrator.service", () => ({
  resolveOrderPayment,
}));

let registerMvpInvoicingRoutes: any;

beforeAll(async () => {
  const routeModule = await import("../routes/mvpInvoicing.routes");
  registerMvpInvoicingRoutes = routeModule.registerMvpInvoicingRoutes;
});

function buildApp(organizationId = "org_1") {
  const app = express();
  app.use(express.json());
  const isAuthenticated = (req: any, _res: any, next: any) => {
    req.user = { id: "user_1", email: "admin@example.com", role: "admin" };
    next();
  };
  const tenantContext = (req: any, _res: any, next: any) => {
    req.organizationId = organizationId;
    next();
  };
  registerMvpInvoicingRoutes(app, { isAuthenticated, tenantContext });
  return app;
}

describe("order payment resolution route", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("returns not found safely when the order is outside the tenant", async () => {
    resolveOrderPayment.mockResolvedValueOnce(null);

    const response = await request(buildApp("org_a")).get("/api/orders/order_other/payment-resolution");

    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({ success: false, error: "Order not found" });
    expect(resolveOrderPayment).toHaveBeenCalledWith({ organizationId: "org_a", orderId: "order_other" });
  });

  test("returns the read-only resolution envelope", async () => {
    resolveOrderPayment.mockResolvedValueOnce({
      entityType: "order",
      orderId: "order_1",
      requestedInvoiceId: "invoice_1",
      resolutionStatus: "SINGLE_PAYABLE_INVOICE",
      payable: true,
      blockedReason: null,
      invoiceCandidates: [],
      selectedInvoice: null,
      amountDueCents: 1000,
      provider: {
        configuredProvider: "stripe",
        hostedProvider: "stripe",
        hostedResolution: { provider: "stripe", reason: "configured_default", availableProviders: ["stripe"] },
        epsReady: false,
        stripeEnabled: true,
        stripeConnected: true,
      },
      availablePaymentMethods: ["hosted_card", "manual"],
      recommendedAction: "TAKE_PAYMENT",
      redirectTarget: "/invoices/invoice_1?takePayment=1",
    });

    const response = await request(buildApp("org_1")).get("/api/orders/order_1/payment-resolution");

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      success: true,
      data: {
        resolutionStatus: "SINGLE_PAYABLE_INVOICE",
        redirectTarget: "/invoices/invoice_1?takePayment=1",
      },
    });
    expect(JSON.stringify(response.body)).not.toContain("epsApiKey");
  });
});
