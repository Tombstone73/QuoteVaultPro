import { and, eq } from "drizzle-orm";
import { customerPaymentBatches, payments } from "../../shared/schema";

/** Resolves the one economic Stripe collection without copying its id to allocations. */
export async function resolveStripePaymentLineage(tx: any, input: { organizationId: string; stripePaymentIntentId: string }) {
  const [batch] = await tx.select().from(customerPaymentBatches).where(and(
    eq(customerPaymentBatches.organizationId, input.organizationId),
    eq(customerPaymentBatches.provider, "stripe"),
    eq(customerPaymentBatches.stripePaymentIntentId, input.stripePaymentIntentId),
  )).limit(1);
  if (batch) {
    const children = await tx.select().from(payments).where(and(eq(payments.organizationId, input.organizationId), eq(payments.customerPaymentBatchId, batch.id)));
    return { source: "customer_payment_batch" as const, batch, children, payment: null };
  }
  const [payment] = await tx.select().from(payments).where(and(eq(payments.organizationId, input.organizationId), eq(payments.provider, "stripe"), eq(payments.stripePaymentIntentId, input.stripePaymentIntentId))).limit(1);
  return payment ? { source: "legacy_invoice_payment" as const, batch: null, children: [payment], payment } : null;
}

/** Resolves the provider transaction for one invoice-level payment effect.
 * Grouped allocations intentionally inherit the provider identity from their
 * parent batch rather than copying it onto every child payment. */
export async function resolveStripeRefundProviderLineage(tx: any, input: { organizationId: string; payment: any }) {
  const payment = input.payment;
  const directPaymentIntentId = typeof payment?.stripePaymentIntentId === "string" ? payment.stripePaymentIntentId.trim() : "";
  if (directPaymentIntentId) {
    const stripeAccountId = typeof payment?.metadata?.stripeAccountId === "string" ? payment.metadata.stripeAccountId.trim() : "";
    return stripeAccountId ? { source: "legacy_invoice_payment" as const, paymentIntentId: directPaymentIntentId, stripeAccountId, batch: null } : null;
  }
  const batchId = typeof payment?.customerPaymentBatchId === "string" ? payment.customerPaymentBatchId.trim() : "";
  if (!batchId) return null;
  const [batch] = await tx.select().from(customerPaymentBatches).where(and(
    eq(customerPaymentBatches.id, batchId),
    eq(customerPaymentBatches.organizationId, input.organizationId),
    eq(customerPaymentBatches.provider, "stripe"),
  )).limit(1);
  const paymentIntentId = typeof batch?.stripePaymentIntentId === "string" ? batch.stripePaymentIntentId.trim() : "";
  const stripeAccountId = typeof batch?.stripeAccountId === "string" ? batch.stripeAccountId.trim() : "";
  return batch && paymentIntentId && stripeAccountId
    ? { source: "customer_payment_batch" as const, paymentIntentId, stripeAccountId, batch }
    : null;
}
