import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { customerPaymentBatches } from "../../shared/schema";
import { db } from "../db";
import { getStripeClient } from "../lib/stripe";
import { assertStripeClaimAvailable, lockAndValidateStripeInvoices, recoverStripeInvoiceClaims, StripeInvoiceClaimError } from "./stripeInvoicePaymentClaims.service";
import { finalizeStripeCustomerPaymentBatch } from "./stripeCustomerPaymentBatchFinalization.service";

export class GroupedStripeInitiationError extends Error {
  constructor(readonly statusCode: number, message: string) { super(message); }
}
export type GroupedStripeInitiationInput = {
  organizationId: string; customerId: string; actorUserId: string; requestKey: string;
  stripeAccountId: string; invoiceIds: string[];
  allocations: Array<{ invoiceId: string; amountCents: number }>;
  amountCents: number; currency: string; providerEvidence: Record<string, unknown>;
  source?: "portal" | "staff";
  invoiceVersions?: Record<string, number>;
};

/** One durable batch/intent operation, shared by portal and staff. No provider calls in a DB transaction. */
export async function initiateGroupedStripePayment(input: GroupedStripeInitiationInput) {
  const { invoiceIds, allocations, amountCents } = input;
  const currency = input.currency.toUpperCase();
  if (!input.organizationId || !input.customerId || !input.actorUserId || !input.requestKey || !input.stripeAccountId ||
      !invoiceIds.length || invoiceIds.length > 50 || new Set(invoiceIds).size !== invoiceIds.length || allocations.length !== invoiceIds.length ||
      new Set(allocations.map(a => a.invoiceId)).size !== allocations.length ||
      allocations.some(a => !invoiceIds.includes(a.invoiceId) || !Number.isSafeInteger(a.amountCents) || a.amountCents <= 0) ||
      !Number.isSafeInteger(amountCents) || amountCents <= 0 || allocations.reduce((sum, a) => sum + a.amountCents, 0) !== amountCents || !currency) {
    throw new GroupedStripeInitiationError(400, "Invalid grouped payment context.");
  }
  const expected = input.providerEvidence.expectedRemainingCents as Record<string, number> | undefined;
  const snapshots = allocations.map(a => ({ invoiceId: a.invoiceId, remainingCents: expected?.[a.invoiceId] ?? a.amountCents,
    currency, customerId: input.customerId, invoiceVersion: input.invoiceVersions?.[a.invoiceId] }));
  if (snapshots.some((row, i) => !Number.isSafeInteger(row.remainingCents) || row.remainingCents < allocations[i].amountCents)) {
    throw new GroupedStripeInitiationError(400, "Invalid invoice balance snapshot.");
  }
  await recoverStripeInvoiceClaims({ organizationId: input.organizationId, invoiceIds, customerId: input.customerId });
  const stripeAccountId = input.stripeAccountId;
  // Preserve the existing portal identity and provider idempotency namespace.
  const idempotencyKey = `${input.source === "staff" ? "staff" : "portal"}-stripe-batch:${input.actorUserId}:${input.requestKey}`;
  const leaseId = randomUUID();
  const now = new Date();
  const providerEvidence = { ...input.providerEvidence, source: input.source || "portal", invoiceIds, allocations,
    expectedRemainingCents: Object.fromEntries(snapshots.map(row => [row.invoiceId, row.remainingCents])),
    initiationLeaseId: leaseId, initiationLeaseUntil: new Date(now.getTime() + 60000).toISOString() };
  const batch = await db.transaction(async tx => {
    await lockAndValidateStripeInvoices(tx, input.organizationId, snapshots);
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`stripe-batch-key:${input.organizationId}:${idempotencyKey}`}))`);
    const [existing] = await tx.select().from(customerPaymentBatches).where(and(
      eq(customerPaymentBatches.organizationId, input.organizationId), eq(customerPaymentBatches.idempotencyKey, idempotencyKey),
    )).limit(1);
    if (existing) {
      if (existing.status !== "pending" || existing.stripeAccountId !== stripeAccountId ||
          JSON.stringify(existing.providerEvidence.allocations) !== JSON.stringify(allocations) ||
          existing.customerId !== input.customerId || Number(existing.amountCents) !== amountCents ||
          String(existing.currency).toUpperCase() !== currency) {
        throw new GroupedStripeInitiationError(409, "This checkout attempt no longer matches the selected invoices.");
      }
      await assertStripeClaimAvailable(tx, input.organizationId, invoiceIds, { batchId: existing.id, intentId: existing.stripePaymentIntentId });
      if (existing.stripePaymentIntentId) return existing;
      if (Date.now() - new Date(existing.createdAt).getTime() >= 23 * 60 * 60 * 1000) {
        throw new StripeInvoiceClaimError("Unresolved Stripe reservation requires processor review before retrying.", "STRIPE_RESERVATION_REVIEW_REQUIRED");
      }
      if (Date.parse(String(existing.providerEvidence.initiationLeaseUntil || "")) > Date.now()) {
        throw new StripeInvoiceClaimError("This payment is initializing. Retry the same checkout shortly.", "STRIPE_PAYMENT_INITIALIZING");
      }
      const [leased] = await tx.update(customerPaymentBatches).set({ providerEvidence: { ...existing.providerEvidence,
        initiationLeaseId: leaseId, initiationLeaseUntil: providerEvidence.initiationLeaseUntil }, updatedAt: now })
        .where(eq(customerPaymentBatches.id, existing.id)).returning();
      return leased;
    }
    await assertStripeClaimAvailable(tx, input.organizationId, invoiceIds);
    const [created] = await tx.insert(customerPaymentBatches).values({
      organizationId: input.organizationId, customerId: input.customerId, amountCents, method: "credit_card",
      allocationMode: "custom", provider: "stripe", status: "pending", currency, stripeAccountId, providerEvidence, idempotencyKey,
      notes: "Grouped Stripe payment pending", appliedAt: now, createdByUserId: input.actorUserId, createdAt: now, updatedAt: now,
    }).returning();
    return created;
  });
  const stripe = getStripeClient();
  let intent;
  if (batch.stripePaymentIntentId) {
    intent = await stripe.paymentIntents.retrieve(batch.stripePaymentIntentId, { stripeAccount: stripeAccountId });
  } else {
    try {
      intent = await resumeGroupedStripePaymentIntent(batch);
    } catch (error) {
      // A lost provider response retries this SAME batch/key. Never create a replacement.
      await db.update(customerPaymentBatches).set({
        providerEvidence: sql`jsonb_set(${customerPaymentBatches.providerEvidence}, '{initiationLeaseUntil}', 'null'::jsonb)`, updatedAt: new Date(),
      }).where(and(eq(customerPaymentBatches.id, batch.id), eq(customerPaymentBatches.status, "pending"),
        sql`${customerPaymentBatches.providerEvidence}->>'initiationLeaseId' = ${leaseId}`));
      throw error;
    }
  }
  if (intent.metadata.organizationId !== input.organizationId || intent.metadata.customerId !== input.customerId ||
      intent.metadata.customerPaymentBatchId !== batch.id || intent.amount !== amountCents || intent.currency.toUpperCase() !== currency) {
    throw new GroupedStripeInitiationError(409, "Payment billing context changed. Resolve the previous attempt first.");
  }
  if (intent.status === "succeeded") {
    await finalizeStripeCustomerPaymentBatch({ organizationId: input.organizationId, paymentIntentId: intent.id, amountCents: intent.amount_received,
      currency: intent.currency, stripeAccountId, actorUserId: input.actorUserId, source: "browser_confirmation" });
    throw new GroupedStripeInitiationError(409, "Payment was already received. Refresh the invoices to see the saved payment.");
  }
  if (["canceled", "processing", "requires_capture"].includes(intent.status) || !intent.client_secret) {
    throw new GroupedStripeInitiationError(409, "The previous payment is unavailable or processing. Reconcile it before starting another payment.");
  }
  return { clientSecret: intent.client_secret, paymentBatchId: batch.id, invoiceIds, allocations, amount: amountCents / 100, currency, stripeAccountId };
}

/** Replays the original provider request, including after a lost create response. */
export async function resumeGroupedStripePaymentIntent(batch: typeof customerPaymentBatches.$inferSelect) {
  const stripe = getStripeClient();
  const account = String(batch.stripeAccountId || "");
  if (batch.stripePaymentIntentId) return stripe.paymentIntents.retrieve(batch.stripePaymentIntentId, { stripeAccount: account });
  if (!account || Date.now() - new Date(batch.createdAt).getTime() >= 23 * 60 * 60 * 1000) {
    throw new StripeInvoiceClaimError("Unresolved Stripe reservation requires processor review before retrying.", "STRIPE_RESERVATION_REVIEW_REQUIRED");
  }
  const allocations = batch.providerEvidence.allocations as Array<{ invoiceId: string; amountCents: number }>;
  const intent = await stripe.paymentIntents.create({
    amount: batch.amountCents, currency: batch.currency.toLowerCase(),
    description: batch.providerEvidence.source === "staff" ? `${allocations.length} invoice payment` : `${allocations.length} portal invoice${allocations.length === 1 ? "" : "s"}`,
    automatic_payment_methods: { enabled: true },
    metadata: { organizationId: batch.organizationId, customerPaymentBatchId: batch.id, customerId: batch.customerId, invoiceCount: String(allocations.length) },
  }, { idempotencyKey: `portal-stripe-batch:${batch.id}`, stripeAccount: account });
  const [saved] = await db.update(customerPaymentBatches).set({ stripePaymentIntentId: intent.id, updatedAt: new Date() }).where(and(
    eq(customerPaymentBatches.id, batch.id), eq(customerPaymentBatches.organizationId, batch.organizationId), eq(customerPaymentBatches.status, "pending"),
  )).returning();
  if (!saved) throw new GroupedStripeInitiationError(409, "Payment state changed. Reconcile the original payment before retrying.");
  return intent;
}
