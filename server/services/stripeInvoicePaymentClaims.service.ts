import { and, eq, inArray, or, sql } from "drizzle-orm";
import { db } from "../db";
import { customerPaymentBatches, invoices, payments, stripePaymentAttempts } from "../../shared/schema";
import { computeInvoicePaymentRollup } from "../../shared/rollups/invoicePaymentRollup";
import { getInvoiceFinancialPaymentEligibility } from "../../shared/paymentOrchestration";
import { normalizeInvoiceAccountingDisplay } from "../../shared/invoiceAccountingDisplay";
import { resolveHistoricalArState } from "../../shared/historicalArAuthority";
import { lockInvoicePaymentContext } from "./invoicePaymentSession.service";
import { getStripeClient } from "../lib/stripe";
import { randomUUID } from "node:crypto";
import { checkoutInactive, isUnsubmittedStripeCheckout } from "./stripeCheckoutLifecycle";

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
  if ([...rows.batches.map(row => row.providerEvidence), ...rows.attempts.map(row => row.metadata), ...rows.legacy.map(row => row.metadata)]
    .some(data => Date.parse(String(data?.checkoutRecoveryUntil || "")) > Date.now())) {
    throw new StripeInvoiceClaimError("Checkout is being restarted. Retry shortly.", "STRIPE_PAYMENT_INITIALIZING");
  }
  if (rows.batches.some(row => row.id !== same?.batchId) ||
      rows.attempts.some(row => row.id !== same?.attemptId) ||
      rows.legacy.some(row => !same?.intentId || row.stripePaymentIntentId !== same.intentId)) {
    throw new StripeInvoiceClaimError("Another Stripe payment is unresolved for a selected invoice. Resume it or release the unpaid attempt before starting another payment.");
  }
}

/** Called only after the route has authorized this invoice/intent. User activity
 * renews inactivity; background polling and webhook deliveries do not. */
export async function touchStripeCheckoutActivity(organizationId: string, invoiceId: string, intentId: string) {
  await db.transaction(async tx => {
    await lockInvoicePaymentContext(tx, organizationId, [invoiceId]);
    const rows = await unresolved(tx, organizationId, [invoiceId]);
    const attempt = rows.attempts.find(row => row.stripePaymentIntentId === intentId);
    const payment = rows.legacy.find(row => row.stripePaymentIntentId === intentId);
    if (!attempt && !payment) throw new StripeInvoiceClaimError("Checkout is no longer active. Start a new checkout.");
    const metadata = (attempt || payment)!.metadata || {};
    if (Date.parse(String(metadata.checkoutRecoveryUntil || "")) > Date.now()) throw new StripeInvoiceClaimError("Checkout is being restarted. Retry shortly.", "STRIPE_PAYMENT_INITIALIZING");
    const table = attempt ? stripePaymentAttempts : payments;
    await tx.update(table).set({ metadata: { ...metadata, checkoutLastActivityAt: new Date().toISOString() } })
      .where(and(eq(table.organizationId, organizationId), eq(table.id, (attempt || payment)!.id)));
  });
}

/**
 * Observe/cancel at Stripe outside database transactions. A durable claim remains
 * active until Stripe confirms cancellation or canonical settlement succeeds.
 * Cancellation racing a capture fails closed; no local cancellation guesses.
 */
export async function recoverStripeInvoiceClaims(input: { organizationId: string; invoiceIds: string[]; cancelUnfunded?: boolean; customerId?: string; retireInactive?: boolean; restartUnsubmitted?: boolean; requestKey?: string }) {
  const rows = await unresolved(db, input.organizationId, input.invoiceIds);
  const claims = [
    ...rows.batches.map(row => ({ kind: "batch" as const, row, intentId: row.stripePaymentIntentId, account: row.stripeAccountId })),
    ...rows.attempts.map(row => ({ kind: "attempt" as const, row, intentId: row.stripePaymentIntentId, account: row.stripeAccountId })),
    ...rows.legacy.filter(row => !rows.attempts.some(attempt => attempt.stripePaymentIntentId === row.stripePaymentIntentId))
      .map(row => ({ kind: "legacy" as const, row, intentId: row.stripePaymentIntentId, account: String(row.metadata?.stripeAccountId || "") })),
  ];
  let recovered = 0;
  for (const claim of claims) {
    const evidence = () => (claim.kind === "batch" ? (claim.row as typeof rows.batches[number]).providerEvidence : (claim.row as typeof rows.attempts[number]).metadata) || {};
    const wantsRetirement = () => Boolean(input.cancelUnfunded ||
      (input.retireInactive && checkoutInactive(claim.row)) ||
      (input.restartUnsubmitted && (!input.requestKey || evidence().checkoutRequestKey !== input.requestKey)));
    if (claim.kind === "batch" && wantsRetirement()) {
      const batch = claim.row as typeof rows.batches[number];
      const allocations = batch.providerEvidence.allocations as Array<{ invoiceId: string }> | undefined;
      if ((input.customerId && batch.customerId !== input.customerId) || !allocations?.length || allocations.some(a => !input.invoiceIds.includes(a.invoiceId))) {
        throw new StripeInvoiceClaimError("Select all invoices in the pending grouped payment before releasing it.");
      }
    }
    if (!claim.intentId && claim.account && wantsRetirement() && claim.kind !== "legacy") {
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
      if (wantsRetirement()) throw new StripeInvoiceClaimError("The original payment identity requires processor review.", "STRIPE_RESERVATION_REVIEW_REQUIRED");
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
    if (intent.status !== "canceled" && wantsRetirement()) {
      if (claim.kind === "batch") {
        const allocations = (row as typeof rows.batches[number]).providerEvidence.allocations as Array<{ invoiceId: string }> | undefined;
        if (!allocations?.length || allocations.some(a => !input.invoiceIds.includes(a.invoiceId))) {
          throw new StripeInvoiceClaimError("Select all invoices in the pending grouped payment before releasing it.");
        }
      }
      if (!isUnsubmittedStripeCheckout(intent)) throw new StripeInvoiceClaimError("This payment has been submitted or is awaiting authentication, processing, or capture. Check its status before starting another payment.", "STRIPE_PAYMENT_SUBMITTED");
      // Lease the exact claim under the same invoice locks as creation. A new
      // opener cannot refresh/reuse a secret while it is being superseded.
      const leaseId = randomUUID();
      const leased = await db.transaction(async tx => {
        await lockInvoicePaymentContext(tx, input.organizationId, input.invoiceIds);
        const table = claim.kind === "batch" ? customerPaymentBatches : claim.kind === "attempt" ? stripePaymentAttempts : payments;
        const [fresh] = await tx.select().from(table).where(and(eq(table.organizationId, input.organizationId), eq(table.id, row.id))).for("update");
        if (!fresh || !["reserved", "pending", "failed"].includes(fresh.status)) return false;
        const data = ((claim.kind === "batch" ? (fresh as typeof rows.batches[number]).providerEvidence : (fresh as typeof rows.attempts[number]).metadata) || {}) as Record<string, any>;
        if (Date.parse(data.checkoutRecoveryUntil || "") > Date.now()) throw new StripeInvoiceClaimError("Checkout is being restarted. Retry shortly.", "STRIPE_PAYMENT_INITIALIZING");
        if (!input.cancelUnfunded && !(input.retireInactive && checkoutInactive(fresh)) &&
          !(input.restartUnsubmitted && (!input.requestKey || data.checkoutRequestKey !== input.requestKey))) return false;
        const updated = { ...data, checkoutRecoveryId: leaseId, checkoutRecoveryUntil: new Date(Date.now() + 60000).toISOString() };
        if (claim.kind === "batch") await tx.update(customerPaymentBatches).set({ providerEvidence: updated }).where(eq(customerPaymentBatches.id, row.id));
        else if (claim.kind === "attempt") await tx.update(stripePaymentAttempts).set({ metadata: updated }).where(eq(stripePaymentAttempts.id, row.id));
        else await tx.update(payments).set({ metadata: updated }).where(eq(payments.id, row.id));
        return true;
      });
      if (!leased) continue;
      try {
        // Older integrations may have a hosted Session linked to this intent.
        // Expire it at Stripe first; a local timeout alone cannot disable its URL.
        const sessions = await stripe.checkout.sessions.list({ payment_intent: intent.id, limit: 100 }, { stripeAccount: claim.account });
        if (sessions.has_more) throw new StripeInvoiceClaimError("Checkout session history requires processor review.");
        for (const session of sessions.data) {
          if (session.status === "complete" || session.payment_status === "paid") throw new StripeInvoiceClaimError("Checkout was submitted. Check payment status before retrying.", "STRIPE_PAYMENT_SUBMITTED");
          if (session.status === "open") await stripe.checkout.sessions.expire(session.id, {}, { stripeAccount: claim.account, idempotencyKey: `invoice-checkout-expire:${session.id}` });
        }
        intent = await stripe.paymentIntents.retrieve(intent.id, { stripeAccount: claim.account });
        if (intent.status !== "canceled") {
          if (sessions.data.length || !isUnsubmittedStripeCheckout(intent)) throw new StripeInvoiceClaimError("Payment state changed while restarting. Check its status and retry.");
          intent = await stripe.paymentIntents.cancel(intent.id, {}, { stripeAccount: claim.account, idempotencyKey: `invoice-claim-cancel:${intent.id}` });
        }
        if (intent.status !== "canceled") throw new StripeInvoiceClaimError("Stripe did not confirm checkout cancellation. Retry the status check.");
      } catch (error) {
        // A cancel/expiry may race success or lose its response. Reconcile the
        // provider's latest state, never release a claim based on a failed call.
        const latest = await stripe.paymentIntents.retrieve(claim.intentId, { stripeAccount: claim.account });
        if (latest.status === "canceled") intent = latest;
        else if (latest.status === "succeeded") {
          await recoverStripeInvoiceClaims({ organizationId: input.organizationId, invoiceIds: input.invoiceIds, customerId: input.customerId });
          recovered++;
          continue;
        } else throw error;
      } finally {
        if (claim.kind === "batch") {
          await db.update(customerPaymentBatches).set({ providerEvidence: sql`${customerPaymentBatches.providerEvidence} - 'checkoutRecoveryUntil' - 'checkoutRecoveryId'` })
            .where(and(eq(customerPaymentBatches.organizationId, input.organizationId), eq(customerPaymentBatches.id, row.id), sql`${customerPaymentBatches.providerEvidence}->>'checkoutRecoveryId' = ${leaseId}`));
        } else {
          const table = claim.kind === "attempt" ? stripePaymentAttempts : payments;
          await db.update(table).set({ metadata: sql`${table.metadata} - 'checkoutRecoveryUntil' - 'checkoutRecoveryId'` })
            .where(and(eq(table.organizationId, input.organizationId), eq(table.id, row.id), sql`${table.metadata}->>'checkoutRecoveryId' = ${leaseId}`));
        }
      }
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
