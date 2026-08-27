import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { getStripeClient } from "../lib/stripe";
import { integrationConnections, invoices, payments, stripeRefundRequests } from "../../shared/schema";
import { captureAndApply, type StripePaymentReconciliationResult } from "./stripePaymentReconciliationService";
import { StripeRefundRecoveryError, verifyStripeRefundRecoveryTruth } from "./stripeRefundRecoveryValidation";

export { StripeRefundRecoveryError, verifyStripeRefundRecoveryTruth } from "./stripeRefundRecoveryValidation";

type RecoveryInput = {
  organizationId: string;
  invoiceId: string;
  paymentId: string;
  refundRequestId: string;
};

type RecoveryResult = {
  refundRequestId: string;
  processorStatus: string;
  reconciliationStatus: "processed" | "already_reconciled";
  invoiceId: string;
  paymentId: string;
  alreadyReconciled: boolean;
  reconciliation?: StripePaymentReconciliationResult;
};

function requiredText(value: unknown, code: string, message: string): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) throw new StripeRefundRecoveryError(code, message);
  return text;
}

/**
 * Fallback for a missed signed webhook only. It reads one refund by the
 * server-trusted durable id, verifies every correlation, then delegates all
 * financial mutation to the canonical reconciliation service.
 */
export async function recoverStripeRefundFromProcessor(input: RecoveryInput): Promise<RecoveryResult> {
  const organizationId = requiredText(input.organizationId, "STRIPE_REFUND_RECOVERY_ORGANIZATION_REQUIRED", "Missing organization context.");
  const invoiceId = requiredText(input.invoiceId, "STRIPE_REFUND_RECOVERY_INVOICE_REQUIRED", "Missing invoice id.");
  const paymentId = requiredText(input.paymentId, "STRIPE_REFUND_RECOVERY_PAYMENT_REQUIRED", "Missing payment id.");
  const refundRequestId = requiredText(input.refundRequestId, "STRIPE_REFUND_RECOVERY_REQUEST_REQUIRED", "Missing refund request id.");

  const [refundRequest] = await db.select().from(stripeRefundRequests).where(and(
    eq(stripeRefundRequests.organizationId, organizationId),
    eq(stripeRefundRequests.id, refundRequestId),
  )).limit(1);
  if (!refundRequest) throw new StripeRefundRecoveryError("STRIPE_REFUND_RECOVERY_REQUEST_NOT_FOUND", "Stripe refund request not found.", 404);
  if (String(refundRequest.invoiceId) !== invoiceId) throw new StripeRefundRecoveryError("STRIPE_REFUND_RECOVERY_INVOICE_MISMATCH", "Refund request does not belong to this invoice.", 404);
  if (String(refundRequest.paymentId) !== paymentId) throw new StripeRefundRecoveryError("STRIPE_REFUND_RECOVERY_PAYMENT_MISMATCH", "Refund request does not belong to this payment.", 404);

  const [invoice] = await db.select({ id: invoices.id }).from(invoices).where(and(
    eq(invoices.id, invoiceId),
    eq(invoices.organizationId, organizationId),
  )).limit(1);
  if (!invoice) throw new StripeRefundRecoveryError("STRIPE_REFUND_RECOVERY_INVOICE_NOT_FOUND", "Invoice not found.", 404);

  const [payment] = await db.select().from(payments).where(and(
    eq(payments.id, paymentId),
    eq(payments.invoiceId, invoiceId),
    eq(payments.organizationId, organizationId),
  )).limit(1);
  if (!payment) throw new StripeRefundRecoveryError("STRIPE_REFUND_RECOVERY_PAYMENT_NOT_FOUND", "Original payment not found.", 404);
  if (String((payment as any).provider || "").toLowerCase() !== "stripe") {
    throw new StripeRefundRecoveryError("STRIPE_REFUND_RECOVERY_PROVIDER_INVALID", "Only Stripe payments can be recovered.");
  }
  if (!["succeeded", "captured"].includes(String((payment as any).status || "").toLowerCase())) {
    throw new StripeRefundRecoveryError("STRIPE_REFUND_RECOVERY_PAYMENT_NOT_SETTLED", "The original Stripe payment is not settled.");
  }
  const paymentIntentId = requiredText((payment as any).stripePaymentIntentId, "STRIPE_REFUND_PAYMENT_INTENT_MISSING", "The original payment has no Stripe PaymentIntent id.");
  if (String(refundRequest.stripePaymentIntentId) !== paymentIntentId) {
    throw new StripeRefundRecoveryError("STRIPE_REFUND_REQUEST_PAYMENT_INTENT_MISMATCH", "Refund request PaymentIntent does not match the original payment.");
  }

  const stripeRefundId = requiredText(refundRequest.stripeRefundId, "STRIPE_REFUND_PROCESSOR_ID_MISSING", "The durable refund request has no Stripe refund id.");
  const stripeAccountId = requiredText(refundRequest.stripeAccountId, "STRIPE_REFUND_CONNECTED_ACCOUNT_MISSING", "The durable refund request has no connected-account id.");
  const paymentAccountId = requiredText((payment as any).metadata?.stripeAccountId, "STRIPE_REFUND_ORIGINAL_ACCOUNT_MISSING", "The original payment has no connected-account identity.");
  if (paymentAccountId !== stripeAccountId) {
    throw new StripeRefundRecoveryError("STRIPE_REFUND_CONNECTED_ACCOUNT_MISMATCH", "Refund request and original payment have different connected accounts.");
  }
  const [connection] = await db.select({ organizationId: integrationConnections.organizationId }).from(integrationConnections).where(and(
    eq(integrationConnections.provider, "stripe"),
    eq(integrationConnections.externalAccountId, stripeAccountId),
  )).limit(1);
  if (!connection || String(connection.organizationId) !== organizationId) {
    throw new StripeRefundRecoveryError("STRIPE_REFUND_CONNECTED_ACCOUNT_TENANT_MISMATCH", "Connected Stripe account does not belong to this organization.");
  }

  const [existingEffect] = await db.select({ id: payments.id }).from(payments).where(and(
    eq(payments.organizationId, organizationId),
    eq(payments.provider, "stripe"),
    eq(payments.providerTransactionId, stripeRefundId),
    eq(payments.status, "refunded"),
  )).limit(1);
  if (existingEffect && String(refundRequest.status).toLowerCase() === "succeeded") {
    return { refundRequestId, processorStatus: "succeeded", reconciliationStatus: "already_reconciled", invoiceId, paymentId, alreadyReconciled: true };
  }

  let refund: any;
  try {
    refund = await getStripeClient().refunds.retrieve(stripeRefundId, { stripeAccount: stripeAccountId } as any);
  } catch {
    throw new StripeRefundRecoveryError("STRIPE_REFUND_PROCESSOR_READ_FAILED", "Unable to retrieve the existing Stripe refund.", 502);
  }
  const verified = verifyStripeRefundRecoveryTruth({ refundRequest, payment, stripeAccountId, refund });

  // This is deliberately not the missing Stripe event id. It is a stable,
  // local recovery-observation identity, so retries and later webhooks converge.
  const reconciliation = await captureAndApply({
    eventId: `stripe-refund-recovery:${stripeRefundId}`,
    type: "refund.updated",
    organizationId,
    invoiceId,
    paymentIntentId,
    stripeAccountId,
    amountCents: Number(refund.amount),
    currency: String(refund.currency || (payment as any).currency || "USD"),
    refundId: stripeRefundId,
    refundRequestId,
    refundAmountCents: Number(refund.amount),
    refundStatus: verified.processorStatus,
    occurredAt: verified.occurredAt,
  });

  return {
    refundRequestId,
    processorStatus: verified.processorStatus,
    reconciliationStatus: "processed",
    invoiceId,
    paymentId,
    alreadyReconciled: Boolean(reconciliation.alreadyProcessed),
    reconciliation,
  };
}
