import { and, eq, inArray, or, sql } from "drizzle-orm";
import { db } from "../db";
import { customerPaymentBatches, invoices, payments, stripePaymentAttempts } from "../../shared/schema";
import { computeInvoicePaymentRollup } from "../../shared/rollups/invoicePaymentRollup";
import { getInvoiceFinancialPaymentEligibility } from "../../shared/paymentOrchestration";
import { normalizeInvoiceAccountingDisplay } from "../../shared/invoiceAccountingDisplay";
import { resolveHistoricalArState } from "../../shared/historicalArAuthority";
import { lockInvoicePaymentContext } from "./invoicePaymentSession.service";
import { getStripeClient } from "../lib/stripe";
import { canCancelUnfundedStripeIntent } from "../lib/invoicePaymentEvidence";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
export class StripeInvoiceClaimError extends Error {
  readonly statusCode = 409;
  constructor(message: string, readonly code = "STRIPE_PAYMENT_CONFLICT") { super(message); }
}
export type StripeInvoiceSnapshot = {
  invoiceId: string; remainingCents: number; currency: string;
  customerId?: string | null; invoiceVersion?: number; allowApprovedImportedQuickBooks?: boolean;
};

/** Runs only inside the short claim transaction, before any provider call. */
export async function lockAndValidateStripeInvoices(tx: Transaction, organizationId: string, snapshots: StripeInvoiceSnapshot[]) {
  const ids = snapshots.map(row => row.invoiceId);
  await lockInvoicePaymentContext(tx, organizationId, ids);
  const rows = await tx.select().from(invoices).where(and(eq(invoices.organizationId, organizationId), inArray(invoices.id, ids))).orderBy(invoices.id).for("update");
  if (rows.length !== ids.length) throw new StripeInvoiceClaimError("One or more invoices are unavailable.", "INVOICE_NOT_FOUND");
  const existingPayments = await tx.select().from(payments).where(and(eq(payments.organizationId, organizationId), inArray(payments.invoiceId, ids)));
  for (const invoice of rows) {
    const expected = snapshots.find(row => row.invoiceId === invoice.id)!;
    const rollup = computeInvoicePaymentRollup({ invoiceTotalCents: Number(invoice.totalCents || 0),
      payments: existingPayments.filter(row => row.invoiceId === invoice.id).map(row => ({ id: row.id, status: row.status, amountCents: Number(row.amountCents || 0) })) });
    const historicalState = resolveHistoricalArState(invoice);
    // Preserve the existing staff single-invoice approved imported A/R workflow.
    // Grouped and customer checkout continue to exclude imported invoices.
    const approvedImported = expected.allowApprovedImportedQuickBooks && historicalState === "historical_open_ar_reconciled"
      && String(invoice.importSource || "").toLowerCase() === "quickbooks" && !invoice.isHistorical && Boolean(invoice.qbInvoiceId?.trim());
    const remainingCents = approvedImported
      ? normalizeInvoiceAccountingDisplay({ ...invoice, payments: existingPayments.filter(row => row.invoiceId === invoice.id) }).displayRemainingCents
      : rollup.amountDueCents;
    const eligible = getInvoiceFinancialPaymentEligibility({ invoiceStatus: invoice.status, remainingCents });
    if (!eligible.payable || (historicalState !== null && !approvedImported) ||
        expected.remainingCents !== remainingCents ||
        expected.currency.toUpperCase() !== String(invoice.currency || "USD").toUpperCase() ||
        (expected.customerId !== undefined && expected.customerId !== invoice.customerId) ||
        (expected.invoiceVersion !== undefined && expected.invoiceVersion !== Number(invoice.invoiceVersion || 1))) {
      throw new StripeInvoiceClaimError("Invoice balance or billing context changed. Refresh and review the payment.", "PAYMENT_ALLOCATION_STALE");
    }
  }
}

async function unresolved(tx: Pick<Transaction, "select">, organizationId: string, invoiceIds: string[]) {
  const batches = await tx.select().from(customerPaymentBatches).where(and(
    eq(customerPaymentBatches.organizationId, organizationId), eq(customerPaymentBatches.provider, "stripe"),
    eq(customerPaymentBatches.status, "pending"),
    or(...invoiceIds.map(invoiceId => sql`${customerPaymentBatches.providerEvidence}->'allocations' @> ${JSON.stringify([{ invoiceId }])}::jsonb`)),
  ));
  const attempts = await tx.select().from(stripePaymentAttempts).where(and(
    eq(stripePaymentAttempts.organizationId, organizationId), inArray(stripePaymentAttempts.invoiceId, invoiceIds),
    inArray(stripePaymentAttempts.status, ["reserved", "pending", "failed"]),
  ));
  const legacy = await tx.select().from(payments).where(and(
    eq(payments.organizationId, organizationId), inArray(payments.invoiceId, invoiceIds), eq(payments.provider, "stripe"),
    inArray(payments.status, ["pending", "failed"]),
  ));
  return { batches, attempts, legacy };
}

/** Every single/grouped reservation calls this under the same invoice locks. */
export async function assertStripeClaimAvailable(tx: Transaction, organizationId: string, invoiceIds: string[], same?: { batchId?: string; attemptId?: string; intentId?: string | null }) {
  const rows = await unresolved(tx, organizationId, invoiceIds);
  if (rows.batches.some(row => row.id !== same?.batchId) ||
      rows.attempts.some(row => row.id !== same?.attemptId) ||
      rows.legacy.some(row => !same?.intentId || row.stripePaymentIntentId !== same.intentId)) {
    throw new StripeInvoiceClaimError("Another Stripe payment is unresolved for a selected invoice. Resume it or release the unpaid attempt before starting another payment.");
  }
}

/**
 * Observe/cancel at Stripe outside database transactions. A durable claim remains
 * active until Stripe confirms cancellation or canonical settlement succeeds.
 * Cancellation racing a capture fails closed; no local cancellation guesses.
 */
export async function recoverStripeInvoiceClaims(input: { organizationId: string; invoiceIds: string[]; cancelUnfunded?: boolean; customerId?: string }) {
  const rows = await unresolved(db, input.organizationId, input.invoiceIds);
  const claims = [
    ...rows.batches.map(row => ({ kind: "batch" as const, row, intentId: row.stripePaymentIntentId, account: row.stripeAccountId })),
    ...rows.attempts.map(row => ({ kind: "attempt" as const, row, intentId: row.stripePaymentIntentId, account: row.stripeAccountId })),
    ...rows.legacy.filter(row => !rows.attempts.some(attempt => attempt.stripePaymentIntentId === row.stripePaymentIntentId))
      .map(row => ({ kind: "legacy" as const, row, intentId: row.stripePaymentIntentId, account: String(row.metadata?.stripeAccountId || "") })),
  ];
  let recovered = 0;
  for (const claim of claims) {
    if (claim.kind === "batch" && input.cancelUnfunded) {
      const batch = claim.row as typeof rows.batches[number];
      const allocations = batch.providerEvidence.allocations as Array<{ invoiceId: string }> | undefined;
      if ((input.customerId && batch.customerId !== input.customerId) || !allocations?.length || allocations.some(a => !input.invoiceIds.includes(a.invoiceId))) {
        throw new StripeInvoiceClaimError("Select all invoices in the pending grouped payment before releasing it.");
      }
    }
    if (!claim.intentId && claim.account && input.cancelUnfunded && claim.kind !== "legacy") {
      if (claim.kind === "batch") {
        const batch = claim.row as typeof rows.batches[number];
        if (Date.parse(String(batch.providerEvidence.initiationLeaseUntil || "")) > Date.now()) {
          throw new StripeInvoiceClaimError("This payment is initializing. Retry recovery shortly.", "STRIPE_PAYMENT_INITIALIZING");
        }
        const { resumeGroupedStripePaymentIntent } = await import("./groupedStripePaymentInitiation.service");
        claim.intentId = (await resumeGroupedStripePaymentIntent(batch)).id;
      } else {
        const { resumeStripePaymentAttemptIntent } = await import("./stripePaymentAttempt.service");
        claim.intentId = (await resumeStripePaymentAttemptIntent(claim.row as import("./stripePaymentAttempt.service").ReservedStripePaymentAttempt)).id;
      }
    }
    if (!claim.intentId || !claim.account) {
      if (input.cancelUnfunded) throw new StripeInvoiceClaimError("The original payment identity requires processor review.", "STRIPE_RESERVATION_REVIEW_REQUIRED");
      continue;
    }
    const stripe = getStripeClient();
    let intent = await stripe.paymentIntents.retrieve(claim.intentId, { stripeAccount: claim.account });
    const row = claim.row;
    if (intent.metadata.organizationId !== input.organizationId || intent.amount !== Number(row.amountCents) ||
        intent.currency.toUpperCase() !== String(row.currency).toUpperCase() ||
        (claim.kind === "batch" ? intent.metadata.customerPaymentBatchId !== row.id : intent.metadata.invoiceId !== (row as typeof rows.attempts[number]).invoiceId)) {
      throw new StripeInvoiceClaimError("Stripe payment identity requires review.");
    }
    if (claim.kind === "attempt" && (intent.metadata.stripePaymentAttemptId !== row.id || intent.metadata.stripeAccountId !== claim.account)) {
      throw new StripeInvoiceClaimError("Stripe attempt identity requires review.");
    }
    if (claim.kind === "batch" && input.customerId && (row as typeof rows.batches[number]).customerId !== input.customerId) {
      throw new StripeInvoiceClaimError("Payment customer does not match this checkout.");
    }
    if (intent.status === "succeeded") {
      if (claim.kind === "batch") {
        const { finalizeStripeCustomerPaymentBatch } = await import("./stripeCustomerPaymentBatchFinalization.service");
        await finalizeStripeCustomerPaymentBatch({ organizationId: input.organizationId, paymentIntentId: intent.id, amountCents: intent.amount_received,
          currency: intent.currency, stripeAccountId: claim.account, source: "browser_confirmation" });
      } else {
        const { captureAndApply } = await import("./stripePaymentReconciliationService");
        await captureAndApply({ eventId: `stripe-recovery:${intent.id}:payment_intent.succeeded`, type: "payment_intent.succeeded",
          organizationId: input.organizationId, invoiceId: (row as typeof rows.attempts[number]).invoiceId, paymentIntentId: intent.id,
          ...(claim.kind === "attempt" ? { paymentAttemptId: row.id } : {}), stripeAccountId: claim.account,
          amountCents: intent.amount_received, currency: intent.currency, occurredAt: new Date() });
      }
      recovered++;
      continue;
    }
    if (intent.status !== "canceled" && input.cancelUnfunded) {
      if (claim.kind === "batch") {
        const allocations = (row as typeof rows.batches[number]).providerEvidence.allocations as Array<{ invoiceId: string }> | undefined;
        if (!allocations?.length || allocations.some(a => !input.invoiceIds.includes(a.invoiceId))) {
          throw new StripeInvoiceClaimError("Select all invoices in the pending grouped payment before releasing it.");
        }
      }
      if (!canCancelUnfundedStripeIntent(intent)) throw new StripeInvoiceClaimError("Stripe payment is processing or authorized. Wait for reconciliation before starting another payment.");
      intent = await stripe.paymentIntents.cancel(intent.id, {}, { stripeAccount: claim.account, idempotencyKey: `invoice-claim-cancel:${intent.id}` });
    }
    if (intent.status !== "canceled") continue;
    await db.transaction(async tx => {
      // Provider has made this identity permanently uncollectible.
      if (claim.kind === "batch") await tx.update(customerPaymentBatches).set({ status: "canceled", updatedAt: new Date() }).where(and(
        eq(customerPaymentBatches.id, row.id), eq(customerPaymentBatches.organizationId, input.organizationId), eq(customerPaymentBatches.status, "pending")));
      await tx.update(stripePaymentAttempts).set({ status: "canceled", updatedAt: new Date() }).where(and(
        eq(stripePaymentAttempts.organizationId, input.organizationId), eq(stripePaymentAttempts.stripePaymentIntentId, intent.id),
        inArray(stripePaymentAttempts.status, ["reserved", "pending", "failed"])));
      await tx.update(payments).set({ status: "canceled", canceledAt: new Date(), updatedAt: new Date() }).where(and(
        eq(payments.organizationId, input.organizationId), eq(payments.stripePaymentIntentId, intent.id), inArray(payments.status, ["pending", "failed"])));
    });
    recovered++;
  }
  return { recovered };
}
