import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "@jest/globals";

const source = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");

describe("invoice-scoped grouped Stripe refund contract", () => {
  const route = source("server/routes/mvpInvoicing.routes.ts");
  const lineage = source("server/services/stripePaymentLineage.service.ts");
  const recovery = source("server/services/stripeRefundRecovery.service.ts");
  const reconciliation = source("server/services/stripePaymentReconciliationService.ts");

  test("retains the established invoice-payment refund route and idempotency reservation", () => {
    expect(route).toContain("/api/invoices/:invoiceId/payments/:paymentId/stripe/refund");
    expect(route).toContain("stripeRefundIdempotencyKey({ originalPaymentId: paymentId, requestId })");
    expect(route).toContain("stripe-refund:${organizationId}:${paymentId}");
    expect(route).toContain("payment_intent: paymentIntentId");
    expect(route).toContain("amount: Number(reservation.request.amountCents)");
  });

  test("falls back from a grouped child allocation to its parent batch without copying provider identity to siblings", () => {
    expect(lineage).toContain("resolveStripeRefundProviderLineage");
    expect(lineage).toContain("payment.customerPaymentBatchId");
    expect(lineage).toContain("customerPaymentBatches.stripePaymentIntentId");
    expect(route).toContain("resolveStripeRefundProviderLineage(db, { organizationId, payment })");
    expect(route).toContain("providerLineage.source === 'customer_payment_batch'");
  });

  test("keeps refund capacity and local effects scoped to the selected child payment and invoice", () => {
    expect(route).toContain("originalPayment: { ...(payment as any), stripePaymentIntentId: paymentIntentId }");
    expect(route).toContain("eq(stripeRefundRequests.paymentId, paymentId)");
    expect(route).toContain("eq(payments.invoiceId, invoiceId)");
    expect(route).toContain("refundInput.data.amountCents");
    expect(route).not.toContain("proportional refund");
  });

  test("recovery and signed refund reconciliation resolve the original child payment rather than fabricating sibling reversals", () => {
    expect(recovery).toContain("resolveStripeRefundProviderLineage(db, { organizationId, payment })");
    expect(reconciliation).toContain('lineage?.source === "customer_payment_batch" && effect === "refunded"');
    expect(reconciliation).toContain("Grouped Stripe refund does not match a durable invoice refund request.");
    expect(reconciliation).toContain("eq(payments.id, refundRequest.paymentId)");
    expect(reconciliation).toContain("originalPaymentId: payment.id");
  });
});
