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

  test("renders View & Pay only for the existing payable portal path", () => {
    const invoiceUrl = buildInvoicePortalInvoiceUrl({ publicWebOrigin: "https://app.example.test", invoiceId: "inv-open" });
    const payableUrl = buildInvoicePortalPaymentUrl({ publicWebOrigin: "https://app.example.test", invoiceId: "inv-open", canPayOnline: true });
    const paidUrl = buildInvoicePortalPaymentUrl({ publicWebOrigin: "https://app.example.test", invoiceId: "inv-paid", canPayOnline: false });
    const payable = buildInvoiceEmailHtml({ invoiceNumber: "OPEN", companyName: "Shop", customerName: "Customer", totalFormatted: "10.00", dueDate: "today", paymentUrl: payableUrl, portalUrl: invoiceUrl });
    const paid = buildInvoiceEmailHtml({ invoiceNumber: "PAID", companyName: "Shop", customerName: "Customer", totalFormatted: "10.00", dueDate: "today", paymentUrl: paidUrl, portalUrl: buildInvoicePortalInvoiceUrl({ publicWebOrigin: "https://app.example.test", invoiceId: "inv-paid" }), portalMode: "active" });

    expect(payable).toContain("View &amp; Pay Invoice");
    expect(paid).toContain("View Invoice");
    expect(paid).not.toContain("View &amp; Pay Invoice");
  });

  test("provides a secure portal-login fallback without exposing invoice data", () => {
    const html = buildInvoiceEmailHtml({
      invoiceNumber: "INV",
      companyName: "Shop",
      customerName: "Customer",
      totalFormatted: "10.00",
      dueDate: "today",
      portalUrl: buildCustomerPortalUrl("https://app.example.test"),
      portalMode: "login",
    });
    expect(html).toContain("Open Customer Portal");
    expect(html).toContain("Contact the shop if you need portal access.");
    expect(html).not.toContain("/portal/invoices/");
  });

  test("individual and queued sends use the canonical secured portal path", () => {
    const route = source("server/routes/mvpInvoicing.routes.ts");
    const queue = source("server/services/invoiceBulkEmailQueue.service.ts");
    const portalRoutes = source("server/routes/portal.routes.ts");
    const portalService = source("server/services/portal.service.ts");

    expect(route).toContain("resolveInvoiceEmailPortalDestination");
    expect(route).toContain("buildInvoicePortalInvoiceUrl");
    expect(route).toContain("portalMode");
    expect(queue).toContain("canonicalInvoiceEmailSender");
    expect(portalRoutes).toContain("const portalMiddlewares = [isAuthenticated, portalContext, denyStaffPreviewMutations]");
    expect(portalService).toContain("eq(invoices.organizationId, scope.organizationId)");
    expect(portalService).toContain("eq(invoices.customerId, scope.customerId)");
    expect(portalRoutes).toContain('/api/portal/invoices/:id/payments/stripe/create-intent');
  });
});
