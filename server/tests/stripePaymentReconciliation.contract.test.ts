import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "node:fs";
import path from "node:path";

const source = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");

describe("Stripe payment reconciliation contract", () => {
  const processor = source("server/services/stripePaymentReconciliationService.ts");

  test("captures a durable sanitized observation before applying local financial state", () => {
    expect(processor).toContain("onConflictDoNothing");
    expect(processor).toContain("STRIPE_EVENT_CONFLICT");
    expect(processor).toContain("retryByEvent(observation.eventId)");
    expect(processor).toContain("stripe-webhook:${normalizedEventId}");
    expect(processor).toContain("stripe-payment:${organizationId}:${paymentIntentId}");
  });

  test("applies payment, canonical rollup, and reconciliation completion in one transaction", () => {
    const transactionStart = processor.indexOf("return await db.transaction");
    const transactionBody = processor.slice(transactionStart);
    expect(transactionBody).toContain("reconcileInvoicePaymentStateInTransaction");
    expect(transactionBody).toContain("await markProcessed(tx, normalizedEventId, now)");
    expect(processor).toContain("status: \"error\"");
    expect(processor).toContain("processedAt: null");
    expect(processor).toContain("reconcilePendingStripeObservations");
  });

  test("protects replay, terminal ordering, tenant ownership, and partial refund history", () => {
    expect(processor).toContain("STRIPE_EVENT_INVOICE_MISMATCH");
    expect(processor).toContain("STRIPE_EVENT_ACCOUNT_MISMATCH");
    expect(processor).toContain('eq(payments.provider, "stripe")');
    expect(processor).toContain("currentStatus !== \"succeeded\"");
    expect(processor).toContain("providerTransactionId: refundTransactionId");
    expect(processor).toContain("status: \"refunded\"");
    expect(processor).toContain("originalPaymentId: payment.id");
  });

  test("reconciles only successful refunds as capped immutable negative effects", () => {
    expect(processor).toContain('const isRefundSucceeded = observation.refundStatus === "succeeded"');
    expect(processor).toContain("const remainingCents = Math.max(0, Number(payment.amountCents || 0) - alreadyRefundedCents)");
    expect(processor).toContain("const effectiveRefundCents = Math.min(refundAmountCents, remainingCents)");
    expect(processor).toContain("amountCents: effectiveRefundCents");
    expect(processor).not.toContain('status: "refunded",\n            amount: (amountCents / 100).toFixed(2)');
  });

  test("staff confirmation, portal confirmation, and signed webhooks use the same processor", () => {
    const invoicesRoute = source("server/routes/mvpInvoicing.routes.ts");
    const portal = source("server/services/portal.service.ts");
    expect(invoicesRoute).toContain("captureAndApplyStripeObservation");
    expect(invoicesRoute).toContain("/api/payments/stripe/events/:eventId/reconcile");
    expect(portal).toContain("captureAndApplyStripeObservation");
    expect(portal).toContain("stripe-portal-confirm:");
  });
});
