import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "node:fs";
import path from "node:path";

import { buildCustomerPortalUrl, buildInvoiceEmailHtml, buildInvoicePortalInvoiceUrl, buildInvoicePortalPaymentUrl } from "../services/invoiceEmailContent";

const source = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");

describe("invoice email portal link contract", () => {
  test("builds an environment-origin, invoice-specific portal destination", () => {
    expect(buildInvoicePortalInvoiceUrl({
      publicWebOrigin: "https://printershero.example.test/some/path",
      invoiceId: "invoice/with reserved characters",
    })).toBe("https://printershero.example.test/portal/invoices/invoice%2Fwith%20reserved%20characters");
    expect(buildInvoicePortalInvoiceUrl({ publicWebOrigin: "not a URL", invoiceId: "invoice" })).toBeNull();
    expect(buildCustomerPortalUrl("https://printershero.example.test/some/path")).toBe("https://printershero.example.test/portal");
  });

  test("renders a consistent invoice CTA for both active and secure setup paths", () => {
    const invoiceUrl = buildInvoicePortalInvoiceUrl({ publicWebOrigin: "https://app.example.test", invoiceId: "inv-open" });
    const payableUrl = buildInvoicePortalPaymentUrl({ publicWebOrigin: "https://app.example.test", invoiceId: "inv-open", canPayOnline: true });
    const paidUrl = buildInvoicePortalPaymentUrl({ publicWebOrigin: "https://app.example.test", invoiceId: "inv-paid", canPayOnline: false });
    const payable = buildInvoiceEmailHtml({ invoiceNumber: "OPEN", companyName: "Shop", customerName: "Customer", totalFormatted: "10.00", dueDate: "today", paymentUrl: payableUrl, portalUrl: invoiceUrl, hasBalanceDue: true });
    const setup = buildInvoiceEmailHtml({ invoiceNumber: "OPEN", companyName: "Shop", customerName: "Customer", totalFormatted: "10.00", dueDate: "today", portalUrl: "https://app.example.test/accept-invite?token=ab12&kind=portal", hasBalanceDue: true });
    const paid = buildInvoiceEmailHtml({ invoiceNumber: "PAID", companyName: "Shop", customerName: "Customer", totalFormatted: "10.00", dueDate: "today", paymentUrl: paidUrl, portalUrl: buildInvoicePortalInvoiceUrl({ publicWebOrigin: "https://app.example.test", invoiceId: "inv-paid" }), portalMode: "active", hasBalanceDue: false });

    expect(payable).toContain("View &amp; Pay Invoice");
    expect(setup).toContain("View &amp; Pay Invoice");
    expect(setup).not.toContain("Set Up Customer Portal");
    expect(paid).toContain("View Invoice");
    expect(paid).not.toContain("View &amp; Pay Invoice");
  });

  test("does not use a generic portal CTA when an invoice route is available", () => {
    const html = buildInvoiceEmailHtml({
      invoiceNumber: "INV",
      companyName: "Shop",
      customerName: "Customer",
      totalFormatted: "10.00",
      dueDate: "today",
      portalUrl: buildInvoicePortalInvoiceUrl({ publicWebOrigin: "https://app.example.test", invoiceId: "inv-secure" }),
      portalMode: "login",
    });
    expect(html).toContain("View Invoice");
    expect(html).toContain("/portal/invoices/inv-secure");
  });

  test("individual and queued sends use the canonical secured portal path", () => {
    const route = source("server/routes/mvpInvoicing.routes.ts");
    const queue = source("server/services/invoiceBulkEmailQueue.service.ts");
    const portalRoutes = source("server/routes/portal.routes.ts");
    const portalService = source("server/services/portal.service.ts");
    const app = source("client/src/App.tsx");
    const login = source("client/src/pages/login.tsx");
    const inviteRoutes = source("server/routes/customerPortalAccess.routes.ts");

    expect(route).toContain("resolveInvoiceEmailPortalDestination");
    expect(route).toContain("buildInvoicePortalInvoiceUrl");
    expect(route).toContain("buildInvoiceEmailPlainText");
    expect(queue).toContain("canonicalInvoiceEmailSender");
    expect(portalRoutes).toContain("const portalMiddlewares = [isAuthenticated, portalContext, denyStaffPreviewMutations]");
    expect(portalService).toContain("eq(invoices.organizationId, scope.organizationId)");
    expect(portalService).toContain("eq(invoices.customerId, scope.customerId)");
    expect(portalRoutes).toContain('/api/portal/invoices/:id/payments/stripe/create-intent');
    expect(app).toContain("PortalInvoiceLoginRedirect");
    expect(login).toContain("sanitizePortalReturnTarget");
    expect(inviteRoutes).toContain("sanitizePortalReturnTarget(parse.data.returnTo)");
  });
});
