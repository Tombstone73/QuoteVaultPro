import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";

import { db } from "../db";
import { stripePaymentAttempts } from "../../shared/schema";

const ACTIVE_STATUSES = ["reserved", "pending"] as const;

export type StripePaymentAttemptChannel = "staff" | "portal";

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
};

async function findActiveStripePaymentAttempt(organizationId: string, invoiceId: string) {
  const [attempt] = await db.select().from(stripePaymentAttempts).where(and(
    eq(stripePaymentAttempts.organizationId, organizationId),
    eq(stripePaymentAttempts.invoiceId, invoiceId),
    inArray(stripePaymentAttempts.status, [...ACTIVE_STATUSES]),
  )).limit(1);
  return attempt as ReservedStripePaymentAttempt | undefined;
}

/**
 * Reserve an attempt before calling Stripe. The partial unique index is the
 * concurrency authority: callers racing for the same invoice receive the
 * durable active row and therefore share its Stripe idempotency identity.
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
}): Promise<{ attempt: ReservedStripePaymentAttempt; reused: boolean }> {
  const current = await findActiveStripePaymentAttempt(input.organizationId, input.invoiceId);
  if (current) return { attempt: current, reused: true };

  const attemptId = randomUUID();
  const idempotencyKey = `stripe-payment-attempt:${attemptId}`;
  const now = new Date();
  const [created] = await db.insert(stripePaymentAttempts).values({
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

  const raced = await findActiveStripePaymentAttempt(input.organizationId, input.invoiceId);
  if (!raced) throw new Error("Unable to reserve Stripe payment attempt");
  return { attempt: raced, reused: true };
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
    inArray(stripePaymentAttempts.status, [...ACTIVE_STATUSES]),
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
