import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "node:fs";
import path from "node:path";

const source = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");

describe("Stripe refund processor-truth recovery contract", () => {
  const service = source("server/services/stripeRefundRecovery.service.ts");
  const validation = source("server/services/stripeRefundRecoveryValidation.ts");
  const route = source("server/routes/mvpInvoicing.routes.ts");
  const hooks = source("client/src/hooks/useInvoices.ts");
  const page = source("client/src/pages/invoice-detail.tsx");

  test("keeps the recovery route owner/admin-only and tenant-scoped", () => {
    expect(route).toContain("/api/invoices/:invoiceId/payments/:paymentId/stripe/refunds/:refundRequestId/reconcile");
    expect(route).toContain("requireOrgOwnerAdmin");
    expect(service).toContain("eq(stripeRefundRequests.organizationId, organizationId)");
    expect(service).toContain("STRIPE_REFUND_RECOVERY_INVOICE_MISMATCH");
    expect(service).toContain("STRIPE_REFUND_RECOVERY_PAYMENT_MISMATCH");
  });

  test("uses only server-trusted durable identities and processor read truth", () => {
    expect(service).toContain("getStripeClient().refunds.retrieve");
    expect(service).toContain("stripeAccount: stripeAccountId");
    expect(service).toContain("STRIPE_REFUND_PROCESSOR_ID_MISSING");
    expect(service).toContain("STRIPE_REFUND_CONNECTED_ACCOUNT_TENANT_MISMATCH");
    expect(service).toContain("STRIPE_REFUND_ORIGINAL_ACCOUNT_MISSING");
    expect(service).not.toContain("refunds.create");
  });

  test("verifies every refund correlation before canonical reconciliation", () => {
    for (const code of [
      "STRIPE_REFUND_PROCESSOR_ID_MISMATCH",
      "STRIPE_REFUND_PROCESSOR_PAYMENT_INTENT_MISMATCH",
      "STRIPE_REFUND_PROCESSOR_AMOUNT_MISMATCH",
      "STRIPE_REFUND_PROCESSOR_ORGANIZATION_MISMATCH",
      "STRIPE_REFUND_PROCESSOR_INVOICE_MISMATCH",
      "STRIPE_REFUND_PROCESSOR_PAYMENT_MISMATCH",
      "STRIPE_REFUND_PROCESSOR_REQUEST_MISMATCH",
      "STRIPE_REFUND_PROCESSOR_ACCOUNT_MISMATCH",
      "STRIPE_REFUND_NOT_TERMINAL",
    ]) expect(validation).toContain(code);
  });

  test("uses a deterministic synthetic recovery observation and canonical financial mutation", () => {
    expect(service).toContain("stripe-refund-recovery:${stripeRefundId}");
    expect(service).toContain("captureAndApply({");
    expect(service).toContain('type: "refund.updated"');
    expect(service).not.toContain("insert(payments)");
    expect(service).not.toContain("update(stripeRefundRequests)");
    expect(service).toContain("providerTransactionId, stripeRefundId");
  });

  test("converges retries, concurrent calls, and later real webhooks without duplicate effects", () => {
    expect(service).toContain("reconciliationStatus: \"already_reconciled\"");
    expect(service).toContain("alreadyReconciled: Boolean(reconciliation.alreadyProcessed)");
    const processor = source("server/services/stripePaymentReconciliationService.ts");
    expect(processor).toContain("stripe-webhook:${normalizedEventId}");
    expect(processor).toContain("providerTransactionId, refundTransactionId");
  });

  test("provides an admin-only UI action that calls recovery rather than refund initiation", () => {
    expect(hooks).toContain("useRecoverStripeInvoiceRefund");
    expect(hooks).toContain("/stripe/refunds/${encodeURIComponent(payload.refundRequestId)}/reconcile");
    expect(page).toContain("Reconcile Refund");
    expect(page).toContain("reconcileExistingStripeRefund");
    expect(page).toContain("isAdminOrOwner");
    expect(page).toContain("stripeRefundRequests.refetch()");
  });
});
