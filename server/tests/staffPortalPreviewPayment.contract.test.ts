import { readFileSync } from "node:fs";
import path from "node:path";

const read = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");

describe("developer Staff Preview payment boundary", () => {
  test("only single and grouped Stripe mutation routes use the narrow permission exception", () => {
    const routes = read("server/routes/portal.routes.ts");
    for (const url of [
      "/api/portal/invoices/:id/payments/stripe/create-intent",
      "/api/portal/payments/stripe/create-intent",
      "/api/portal/invoices/:id/payments/stripe/confirm",
      "/api/portal/payments/stripe/confirm",
    ]) {
      expect(routes).toContain(`app.post("${url}", ...portalPaymentMiddlewares,`);
    }
    expect(routes).toContain("const portalPaymentMiddlewares = [isAuthenticated, portalContext, authorizeStaffPreviewPayment]");
    expect(routes).toContain("const portalMiddlewares = [isAuthenticated, portalContext, denyStaffPreviewMutations]");
    for (const url of ["/api/portal/profile", "/api/portal/proofs/:id/approve", "/api/portal/quotes/:id/approve"]) {
      expect(routes).toContain(`"${url}", ...portalMiddlewares,`);
    }
    const policy = read("server/services/staffPortalPreviewService.ts");
    expect(policy).toContain('PORTAL_PREVIEW_PAYMENT_EXECUTE = "portal.preview.payment.execute"');
    expect(policy).toContain("isPlatformDeveloper: users.isPlatformDeveloper");
    expect(policy).toContain("userOrganizations.organizationId, preview.organizationId");
  });

  test("the server session capability drives the same real Elements checkout for one or many invoices", () => {
    const service = read("server/services/portal.service.ts");
    const dto = read("client/src/hooks/usePortal.ts");
    const detail = read("client/src/pages/portal/invoice-detail.tsx");
    const list = read("client/src/pages/portal/invoices.tsx");
    const dialog = read("client/src/components/payments/StripePayDialog.tsx");
    expect(service).toContain("canExecutePayments: canExecutePreviewPayments");
    expect(service).toContain("canPayInvoices: !staffPreview || canExecutePreviewPayments");
    expect(dto).toContain("canExecutePayments: boolean");
    expect(detail).toContain("previewPaymentAuthorized={Boolean(sessionQuery.data?.staffPreview?.canExecutePayments)}");
    expect(list).toContain("previewPaymentAuthorized={Boolean(session.staffPreview?.canExecutePayments)}");
    expect(dialog).toContain("props.previewMode && !props.previewPaymentAuthorized");
    expect(dialog).toContain("<PaymentElement");
    expect(dialog).toContain("Developer preview: payment submission enabled. This will create a real payment.");
    expect(dialog).toContain("Staff preview: payment submission disabled.");
  });

  test("staff actor and customer scope are durable while payment accounting remains canonical", () => {
    const service = read("server/services/portal.service.ts");
    const finalizer = read("server/services/stripeCustomerPaymentBatchFinalization.service.ts");
    expect(service).toContain("staffPreviewPayment: previewPayment");
    expect(service).toContain("existingPreviewActor !== previewPayment.actorUserId");
    expect(service).toContain("reservedPreviewActor !== previewPayment.actorUserId");
    expect(service).toContain("createdByUserId: scope.userId");
    expect(service).toContain("getPortalInvoiceForPayment(scope, invoiceId)");
    expect(service).toContain("assertPortalInvoicePayable(invoice, paymentRows)");
    expect(finalizer).toContain("recordCustomerPayment({");
    expect(finalizer).toContain("actorUserId: prepared.batch.createdByUserId || input.actorUserId || null");
    expect(finalizer).toContain("existingBatchId: prepared.batch.id");
  });
});
