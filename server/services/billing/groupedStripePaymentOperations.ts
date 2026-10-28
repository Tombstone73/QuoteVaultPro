import { and, eq, inArray } from "drizzle-orm";
import { db } from "../../db";
import { customerPaymentBatches, invoices, payments } from "../../../shared/schema";
import { previewCustomerPayment } from "./customerPaymentOperations";
import { initiateGroupedStripePayment, GroupedStripeInitiationError } from "../groupedStripePaymentInitiation.service";
import { lockAndValidateStripeInvoices, assertStripeClaimAvailable } from "../stripeInvoicePaymentClaims.service";
import { stripeBatchExpectedBalances } from "../../../shared/stripeBatchExpectedBalances";
import { getStripeClient } from "../../lib/stripe";
import { finalizeStripeCustomerPaymentBatch } from "../stripeCustomerPaymentBatchFinalization.service";
import { computeInvoicePaymentRollup } from "../../../shared/rollups/invoicePaymentRollup";

export async function prepareFullBalanceStripePayment(organizationId: string, invoiceIds: string[]) {
  const preview = await previewCustomerPayment({ organizationId, invoiceIds, amountCents: 1, allocationMode: "oldest_first", staffSelection: true });
  if (!preview.eligibleCount || preview.excludedCount) throw new GroupedStripeInitiationError(409, "Select only eligible invoices with open balances for card payment.");
  const rows = await db.select().from(invoices).where(and(eq(invoices.organizationId, organizationId), inArray(invoices.id, invoiceIds)));
  const currency = String(rows[0]?.currency || "USD").toUpperCase();
  if (rows.length !== invoiceIds.length || rows.some(row => String(row.currency || "USD").toUpperCase() !== currency)) {
    throw new GroupedStripeInitiationError(409, "Selected invoices must use the same currency.");
  }
  const allocations = invoiceIds.map(invoiceId => ({ invoiceId, amountCents: preview.invoices.find(row => row.invoiceId === invoiceId)!.remainingCents }));
  return { customerId: preview.customerId as string, currency, allocations, amountCents: preview.totalOutstandingCents,
    invoiceVersions: Object.fromEntries(rows.map(row => [row.id, Number(row.invoiceVersion || 1)])) };
}

export async function initiateFullBalanceStripePayment(input: {
  organizationId: string; actorUserId: string; invoiceIds: string[]; expectedRemainingCents: Record<string, number>;
  requestKey: string; stripeAccountId: string;
}) {
  const prepared = await prepareFullBalanceStripePayment(input.organizationId, input.invoiceIds);
  if (Object.keys(input.expectedRemainingCents).length !== input.invoiceIds.length ||
      prepared.allocations.some(a => input.expectedRemainingCents[a.invoiceId] !== a.amountCents)) {
    throw new GroupedStripeInitiationError(409, "Invoice balances changed. Refresh and review the total before paying.");
  }
  return initiateGroupedStripePayment({ ...input, ...prepared, source: "staff", providerEvidence: {
    portal: false, allocations: prepared.allocations, expectedRemainingCents: input.expectedRemainingCents,
    initiatedByCustomerId: prepared.customerId,
  } });
}

type BatchAccess = {
  organizationId: string; paymentIntentId: string; customerId?: string;
  authorizeInvoice?: (invoiceId: string) => Promise<void>;
};
async function authorizedBatch(input: BatchAccess) {
  if (!input.paymentIntentId) throw new GroupedStripeInitiationError(400, "Missing payment intent.");
  const [batch] = await db.select().from(customerPaymentBatches).where(and(eq(customerPaymentBatches.organizationId, input.organizationId),
    eq(customerPaymentBatches.provider, "stripe"), eq(customerPaymentBatches.stripePaymentIntentId, input.paymentIntentId),
    ...(input.customerId ? [eq(customerPaymentBatches.customerId, input.customerId)] : []))).limit(1);
  if (!batch) throw new GroupedStripeInitiationError(404, "Payment not found.");
  const allocations = batch.providerEvidence.allocations as Array<{ invoiceId: string; amountCents: number }> | undefined;
  if (!allocations?.length || allocations.some(a => !a.invoiceId || !Number.isSafeInteger(a.amountCents) || a.amountCents <= 0) ||
      new Set(allocations.map(a => a.invoiceId)).size !== allocations.length || allocations.reduce((sum, a) => sum + a.amountCents, 0) !== batch.amountCents) {
    throw new GroupedStripeInitiationError(409, "Payment allocation evidence requires review.");
  }
  const ids = allocations.map(a => a.invoiceId);
  const selected = await db.select().from(invoices).where(and(eq(invoices.organizationId, input.organizationId), inArray(invoices.id, ids)));
  if (selected.length !== ids.length || selected.some(row => row.customerId !== batch.customerId)) throw new GroupedStripeInitiationError(409, "Payment billing ownership changed.");
  if (input.authorizeInvoice) for (const id of ids) await input.authorizeInvoice(id);
  return { batch, allocations, ids };
}
export async function validateGroupedStripePayment(input: BatchAccess) {
  const { batch, allocations, ids } = await authorizedBatch(input);
  if (batch.status !== "pending") throw new GroupedStripeInitiationError(409, "Payment is no longer pending.");
  const expected = stripeBatchExpectedBalances(batch.providerEvidence, allocations);
  await db.transaction(async tx => {
    await lockAndValidateStripeInvoices(tx, input.organizationId, allocations.map(a => ({ invoiceId: a.invoiceId,
      remainingCents: expected[a.invoiceId], currency: batch.currency, customerId: batch.customerId })));
    await assertStripeClaimAvailable(tx, input.organizationId, ids, { batchId: batch.id, intentId: batch.stripePaymentIntentId });
  });
  return { eligible: true };
}
export async function readGroupedStripePayment(input: BatchAccess) {
  const { batch, allocations, ids } = await authorizedBatch(input);
  return db.transaction(async tx => {
    const [saved] = await tx.select().from(customerPaymentBatches).where(and(eq(customerPaymentBatches.id, batch.id), eq(customerPaymentBatches.organizationId, input.organizationId)));
    const children = await tx.select().from(payments).where(and(eq(payments.organizationId, input.organizationId), eq(payments.customerPaymentBatchId, batch.id)));
    const selected = await tx.select().from(invoices).where(and(eq(invoices.organizationId, input.organizationId), inArray(invoices.id, ids)));
    const allPayments = await tx.select().from(payments).where(and(eq(payments.organizationId, input.organizationId), inArray(payments.invoiceId, ids)));
    const finalized = saved.status === "succeeded" && children.length === allocations.length &&
      allocations.every(a => children.filter(p => p.invoiceId === a.invoiceId && p.amountCents === a.amountCents && p.status === "succeeded").length === 1);
    return { finalized, paymentBatchId: batch.id, invoiceIds: ids, status: saved.status,
      reconciliationRequired: !finalized && saved.providerEvidence.reconciliationRequired === true,
      allocations: children.map(p => ({ invoiceId: p.invoiceId, paymentId: p.id, amountCents: p.amountCents })),
      invoices: selected.map(row => ({ invoiceId: row.id, status: row.status,
        ...computeInvoicePaymentRollup({ invoiceTotalCents: Number(row.totalCents || 0), payments: allPayments.filter(p => p.invoiceId === row.id).map(p => ({ id: p.id, status: p.status, amountCents: Number(p.amountCents || 0) })) }) })) };
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
}
export async function confirmGroupedStripePayment(input: BatchAccess & { actorUserId?: string }) {
  const { batch } = await authorizedBatch(input);
  const account = String(batch.stripeAccountId || "");
  if (!account) throw new GroupedStripeInitiationError(409, "Payment account identity is missing.");
  const intent = await getStripeClient().paymentIntents.retrieve(input.paymentIntentId, { stripeAccount: account });
  if (intent.metadata.organizationId !== input.organizationId || intent.metadata.customerPaymentBatchId !== batch.id ||
      intent.metadata.customerId !== batch.customerId) throw new GroupedStripeInitiationError(409, "Payment identity does not match.");
  if (intent.status !== "succeeded") throw new GroupedStripeInitiationError(409, "Payment has not succeeded yet.");
  await finalizeStripeCustomerPaymentBatch({ organizationId: input.organizationId, paymentIntentId: intent.id,
    amountCents: intent.amount_received, currency: intent.currency, stripeAccountId: account, actorUserId: input.actorUserId,
    source: "browser_confirmation" });
  return readGroupedStripePayment(input);
}
