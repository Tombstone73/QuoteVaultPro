import { getStripeClient } from "../lib/stripe";
import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray } from "drizzle-orm";

import { db } from "../db";
import { stripePaymentAttempts } from "../../shared/schema";
import { assertStripeClaimAvailable, lockAndValidateStripeInvoices, recoverStripeInvoiceClaims, StripeInvoiceClaimError } from "./stripeInvoicePaymentClaims.service";

const ACTIVE_STATUSES = ["reserved", "pending"] as const;

export type StripePaymentAttemptChannel = "staff" | "portal" | "guest";

export type ReservedStripePaymentAttempt = {
  id: string;
  organizationId: string;
  invoiceId: string;
  channel: StripePaymentAttemptChannel;
  amountCents: number;
  currency: string;
  stripeAccountId: string;
  idempotencyKey: string;
  stripePaymentIntentId: string | null;
  paymentId: string | null;
  status: string;
  metadata: Record<string, any>;
  createdByUserId: string | null;
  createdAt: Date;
};

async function findActiveStripePaymentAttempt(organizationId: string, invoiceId: string, executor: Pick<typeof db, "select"> = db) {
  const attempts = await executor.select().from(stripePaymentAttempts).where(and(
    eq(stripePaymentAttempts.organizationId, organizationId),
    eq(stripePaymentAttempts.invoiceId, invoiceId),
    // A declined PaymentIntent is retryable at Stripe. Keep its identity in
    // contention until Stripe cancels it or it succeeds; never issue a second
    // collectible intent just because a payment_failed event was observed.
    inArray(stripePaymentAttempts.status, [...ACTIVE_STATUSES, "failed"]),
  )).orderBy(desc(stripePaymentAttempts.createdAt)).limit(2);
  if (attempts.length > 1) {
    throw Object.assign(new Error("Multiple unresolved Stripe attempts require processor review."), { code: "STRIPE_ATTEMPT_REVIEW_REQUIRED" });
  }
  return attempts[0] as ReservedStripePaymentAttempt | undefined;
}

/**
 * Reserve an attempt before calling Stripe. Sorted invoice locks make the check and
 * durable claim atomic across single and grouped entry points. The existing
 * partial unique index also protects active single reservations.
 */
export async function reserveStripePaymentAttempt(input: {
  organizationId: string;
  invoiceId: string;
  channel: StripePaymentAttemptChannel;
  amountCents: number;
  currency: string;
  stripeAccountId: string;
  createdByUserId?: string | null;
  metadata?: Record<string, unknown>;
  expectedCustomerId?: string | null;
  expectedInvoiceVersion?: number;
}): Promise<{ attempt: ReservedStripePaymentAttempt; reused: boolean }> {
  await recoverStripeInvoiceClaims({ organizationId: input.organizationId, invoiceIds: [input.invoiceId] });
  return db.transaction(async tx => {
    await lockAndValidateStripeInvoices(tx, input.organizationId, [{ invoiceId: input.invoiceId, remainingCents: input.amountCents,
      currency: input.currency, customerId: input.expectedCustomerId, invoiceVersion: input.expectedInvoiceVersion, allowApprovedImportedQuickBooks: input.channel === "staff" }]);
    const current = await findActiveStripePaymentAttempt(input.organizationId, input.invoiceId, tx);
    await assertStripeClaimAvailable(tx, input.organizationId, [input.invoiceId], current ? { attemptId: current.id, intentId: current.stripePaymentIntentId } : undefined);
    if (current) {
      if (current.channel !== input.channel || current.createdByUserId !== (input.createdByUserId || null) ||
          current.amountCents !== input.amountCents || current.currency !== input.currency.toUpperCase() || current.stripeAccountId !== input.stripeAccountId) {
        throw new StripeInvoiceClaimError("A different Stripe checkout is already pending for this invoice.");
      }
      // Stripe may prune idempotency keys after 24h. An old reservation whose
      // response was lost cannot safely issue another create request.
      if (!current.stripePaymentIntentId && Date.now() - new Date(current.createdAt).getTime() >= 23 * 60 * 60 * 1000) {
        throw Object.assign(new Error("Unresolved Stripe reservation requires processor review before retrying."), { code: "STRIPE_RESERVATION_REVIEW_REQUIRED" });
      }
      return { attempt: current, reused: true };
    }

    const attemptId = randomUUID();
    const idempotencyKey = `stripe-payment-attempt:${attemptId}`;
    const now = new Date();
    const [created] = await tx.insert(stripePaymentAttempts).values({
      id: attemptId,
      organizationId: input.organizationId,
      invoiceId: input.invoiceId,
      channel: input.channel,
      amountCents: input.amountCents,
      currency: input.currency.toUpperCase(),
      stripeAccountId: input.stripeAccountId,
      idempotencyKey,
      status: "reserved",
      createdByUserId: input.createdByUserId || null,
      metadata: input.metadata || {},
      createdAt: now,
      updatedAt: now,
    } as any).onConflictDoNothing().returning();

    if (created) return { attempt: created as ReservedStripePaymentAttempt, reused: false };

    const raced = await findActiveStripePaymentAttempt(input.organizationId, input.invoiceId, tx);
    if (!raced) throw new Error("Unable to reserve Stripe payment attempt");
    return { attempt: raced, reused: true };
  });
}

export async function findStripePaymentAttempt(organizationId: string, invoiceId: string, paymentIntentId: string) {
  const [attempt] = await db.select().from(stripePaymentAttempts).where(and(
    eq(stripePaymentAttempts.organizationId, organizationId),
    eq(stripePaymentAttempts.invoiceId, invoiceId),
    eq(stripePaymentAttempts.stripePaymentIntentId, paymentIntentId),
  )).limit(1);
  return attempt;
}

/** Checks the retrieved object, never the browser's claimed payment outcome. */
export function assertStripeAttemptIntent(attempt: ReservedStripePaymentAttempt, intent: {
  id: string; amount: number; currency: string; metadata: Record<string, string>;
}) {
  if ((attempt.stripePaymentIntentId && intent.id !== attempt.stripePaymentIntentId) ||
    intent.metadata.organizationId !== attempt.organizationId || intent.metadata.invoiceId !== attempt.invoiceId ||
    intent.metadata.stripePaymentAttemptId !== attempt.id || intent.metadata.stripeAccountId !== attempt.stripeAccountId || intent.amount !== Number(attempt.amountCents) ||
    intent.currency.toUpperCase() !== attempt.currency.toUpperCase()) {
    throw Object.assign(new Error("Stripe attempt identity or amount changed. Review the existing attempt."), { code: "STRIPE_ATTEMPT_MISMATCH" });
  }
}

export async function retireCanceledStripeAttempt(organizationId: string, attemptId: string) {
  // Caller has retrieved this exact intent on its recorded account as canceled.
  await db.update(stripePaymentAttempts).set({ status: "canceled", updatedAt: new Date() }).where(and(
    eq(stripePaymentAttempts.organizationId, organizationId), eq(stripePaymentAttempts.id, attemptId),
    inArray(stripePaymentAttempts.status, ["reserved", "pending", "failed"]),
  ));
}

export async function recordStripePaymentAttemptIntent(input: {
  organizationId: string;
  attemptId: string;
  stripePaymentIntentId: string;
  paymentId?: string | null;
}): Promise<void> {
  await db.update(stripePaymentAttempts).set({
    stripePaymentIntentId: input.stripePaymentIntentId,
    ...(input.paymentId ? { paymentId: input.paymentId } : {}),
    status: "pending",
    updatedAt: new Date(),
  } as any).where(and(
    eq(stripePaymentAttempts.id, input.attemptId),
    eq(stripePaymentAttempts.organizationId, input.organizationId),
    inArray(stripePaymentAttempts.status, [...ACTIVE_STATUSES, "failed"]),
  ));
}

/** Used only after Stripe has been checked server-side to be terminal. */
export async function markStripePaymentAttemptTerminalForPayment(input: {
  organizationId: string;
  paymentId: string;
  status: "failed" | "canceled";
}): Promise<void> {
  await db.update(stripePaymentAttempts).set({
    status: input.status,
    updatedAt: new Date(),
  } as any).where(and(
    eq(stripePaymentAttempts.organizationId, input.organizationId),
    eq(stripePaymentAttempts.paymentId, input.paymentId),
    inArray(stripePaymentAttempts.status, [...ACTIVE_STATUSES]),
  ));
}

/** Same request parameters and key for original checkout and interrupted-response recovery. */
export async function resumeStripePaymentAttemptIntent(attempt: ReservedStripePaymentAttempt) {
  const stripe = getStripeClient();
  if (attempt.stripePaymentIntentId) return stripe.paymentIntents.retrieve(attempt.stripePaymentIntentId, { stripeAccount: attempt.stripeAccountId });
  if (!attempt.metadata.invoiceNumber || Date.now() - new Date(attempt.createdAt).getTime() >= 23 * 60 * 60 * 1000) {
    throw new StripeInvoiceClaimError("Unresolved Stripe reservation requires processor review before retrying.", "STRIPE_RESERVATION_REVIEW_REQUIRED");
  }
  const intent = await stripe.paymentIntents.create({
    amount: attempt.amountCents, currency: attempt.currency.toLowerCase(), description: `Invoice #${attempt.metadata.invoiceNumber}`,
    automatic_payment_methods: { enabled: true },
    metadata: { organizationId: attempt.organizationId, invoiceId: attempt.invoiceId, stripeAccountId: attempt.stripeAccountId, stripePaymentAttemptId: attempt.id,
      ...(attempt.channel === "staff"
        ? { importedQuickBooksInvoice: attempt.metadata.importedQuickBooksInvoice ? "true" : "false", qbInvoiceId: attempt.metadata.qbInvoiceId || null }
        : { customerId: attempt.metadata.customerId }),
    },
  }, { idempotencyKey: attempt.idempotencyKey, stripeAccount: attempt.stripeAccountId });
  assertStripeAttemptIntent(attempt, intent);
  await recordStripePaymentAttemptIntent({ organizationId: attempt.organizationId, attemptId: attempt.id, stripePaymentIntentId: intent.id });
  return intent;
}
