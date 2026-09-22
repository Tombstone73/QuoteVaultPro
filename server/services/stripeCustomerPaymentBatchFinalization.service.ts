import { and, eq, sql } from "drizzle-orm";

import { customerPaymentBatches, integrationConnections, payments } from "../../shared/schema";
import { db } from "../db";
import { recordCustomerPayment } from "./billing/customerPaymentOperations";
import { resolveStripePaymentLineage } from "./stripePaymentLineage.service";

export class StripeCustomerPaymentBatchFinalizationError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
  }
}

type ProviderSuccessInput = {
  organizationId: string;
  paymentIntentId: string;
  amountCents: number;
  currency: string;
  stripeAccountId: string | null;
  occurredAt?: Date;
  actorUserId?: string | null;
  source: "browser_confirmation" | "stripe_webhook";
};

type StoredAllocation = { invoiceId: string; amountCents: number };

function failure(code: string, message: string): never {
  throw new StripeCustomerPaymentBatchFinalizationError(code, message);
}

function allocationsFromEvidence(value: unknown): StoredAllocation[] {
  const allocations = (value && typeof value === "object" ? (value as any).allocations : null);
  if (!Array.isArray(allocations) || allocations.length === 0) {
    failure("STRIPE_BATCH_ALLOCATIONS_MISSING", "The pending Stripe payment batch is missing its intended allocations.");
  }
  const normalized = allocations.map((allocation: any) => ({
    invoiceId: typeof allocation?.invoiceId === "string" ? allocation.invoiceId.trim() : "",
    amountCents: Number(allocation?.amountCents),
  }));
  if (normalized.some((allocation) => !allocation.invoiceId || !Number.isInteger(allocation.amountCents) || allocation.amountCents <= 0) ||
    new Set(normalized.map((allocation) => allocation.invoiceId)).size !== normalized.length) {
    failure("STRIPE_BATCH_ALLOCATIONS_INVALID", "The pending Stripe payment batch has invalid intended allocations.");
  }
  return normalized;
}

/**
 * Applies a successful provider payment through the staff-owned allocator.
 * This command intentionally creates no child payments itself. It first writes
 * provider success evidence durably, so a later retry can safely finish local
 * allocation without issuing another provider charge.
 */
export async function finalizeStripeCustomerPaymentBatch(input: ProviderSuccessInput) {
  const now = input.occurredAt || new Date();
  const currency = String(input.currency || "").toUpperCase();
  if (!input.organizationId || !input.paymentIntentId || !Number.isInteger(input.amountCents) || input.amountCents <= 0 || !currency) {
    failure("STRIPE_BATCH_PROVIDER_EVIDENCE_INVALID", "Stripe success evidence is incomplete.");
  }

  const prepared = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`stripe-batch:${input.organizationId}:${input.paymentIntentId}`}))`);
    const lineage = await resolveStripePaymentLineage(tx, {
      organizationId: input.organizationId,
      stripePaymentIntentId: input.paymentIntentId,
    });
    if (lineage?.source !== "customer_payment_batch" || !lineage.batch) {
      failure("STRIPE_BATCH_NOT_FOUND", "No pending customer payment batch owns this Stripe PaymentIntent.");
    }
    const batch: any = lineage.batch;
    if (String(batch.provider) !== "stripe" || String(batch.stripePaymentIntentId) !== input.paymentIntentId) {
      failure("STRIPE_BATCH_LINEAGE_MISMATCH", "Stripe PaymentIntent does not match its payment batch.");
    }
    if (input.stripeAccountId && batch.stripeAccountId && String(batch.stripeAccountId) !== input.stripeAccountId) {
      failure("STRIPE_BATCH_ACCOUNT_MISMATCH", "Stripe account does not match the payment batch.");
    }
    const stripeAccountId = input.stripeAccountId || batch.stripeAccountId || null;
    if (!stripeAccountId) failure("STRIPE_BATCH_ACCOUNT_MISSING", "Stripe account identity is missing for the payment batch.");
    const [connection] = await tx.select({ organizationId: integrationConnections.organizationId }).from(integrationConnections).where(and(
      eq(integrationConnections.provider, "stripe"),
      eq(integrationConnections.externalAccountId, String(stripeAccountId)),
    )).limit(1);
    if (!connection || String(connection.organizationId) !== input.organizationId) {
      failure("STRIPE_BATCH_ACCOUNT_MISMATCH", "Stripe account does not belong to the payment batch organization.");
    }
    const allocations = allocationsFromEvidence(batch.providerEvidence);
    if (allocations.reduce((total, allocation) => total + allocation.amountCents, 0) !== Number(batch.amountCents)) {
      failure("STRIPE_BATCH_ALLOCATION_TOTAL_MISMATCH", "The payment batch allocations do not equal the provider amount.");
    }
    const discrepancy = Number(batch.amountCents) !== input.amountCents
      ? { code: "STRIPE_BATCH_AMOUNT_MISMATCH", message: "Stripe amount does not match the pending payment batch." }
      : String(batch.currency || "USD").toUpperCase() !== currency
        ? { code: "STRIPE_BATCH_CURRENCY_MISMATCH", message: "Stripe currency does not match the pending payment batch." }
        : null;
    if (discrepancy) return { batch, allocations, alreadyFinalized: false, discrepancy };
    if (String(batch.status) === "succeeded") {
      return { batch, allocations, alreadyFinalized: true };
    }
    if (String(batch.status) !== "pending") {
      failure("STRIPE_BATCH_UNAVAILABLE", "The payment batch is not pending.");
    }
    const providerEvidence = {
      ...(batch.providerEvidence as Record<string, unknown>),
      stripeSuccess: {
        paymentIntentId: input.paymentIntentId,
        amountCents: input.amountCents,
        currency,
        stripeAccountId,
        occurredAt: now.toISOString(),
        source: input.source,
      },
    };
    const [updated] = await tx.update(customerPaymentBatches).set({
      providerEvidence,
      stripeAccountId,
      updatedAt: new Date(),
    } as any).where(and(
      eq(customerPaymentBatches.id, batch.id),
      eq(customerPaymentBatches.organizationId, input.organizationId),
      eq(customerPaymentBatches.status, "pending"),
    )).returning();
    if (!updated) failure("STRIPE_BATCH_RACE", "The payment batch changed while provider success was being recorded.");
    return { batch: updated, allocations, alreadyFinalized: false };
  });

  if (prepared.discrepancy) {
    await db.update(customerPaymentBatches).set({
      providerEvidence: {
        ...(prepared.batch.providerEvidence as Record<string, unknown>),
        stripeSuccessMismatch: {
          paymentIntentId: input.paymentIntentId,
          amountCents: input.amountCents,
          currency,
          occurredAt: now.toISOString(),
          code: prepared.discrepancy.code,
        },
        reconciliationRequired: true,
      },
      updatedAt: new Date(),
    } as any).where(and(
      eq(customerPaymentBatches.id, prepared.batch.id),
      eq(customerPaymentBatches.organizationId, input.organizationId),
    ));
    failure(prepared.discrepancy.code, prepared.discrepancy.message);
  }

  if (prepared.alreadyFinalized) {
    const children = await db.select().from(payments).where(and(
      eq(payments.organizationId, input.organizationId),
      eq(payments.customerPaymentBatchId, prepared.batch.id),
    ));
    return { batch: prepared.batch, payments: children, reused: true };
  }

  try {
    return await recordCustomerPayment({
      organizationId: input.organizationId,
      // Browser and webhook must attribute the payment to the original actor,
      // not whichever observer won the confirmation race.
      actorUserId: prepared.batch.createdByUserId || input.actorUserId || null,
      invoiceIds: prepared.allocations.map((allocation) => allocation.invoiceId),
      amountCents: input.amountCents,
      allocationMode: "custom",
      customAllocations: prepared.allocations,
      expectedRemainingCents: Object.fromEntries(prepared.allocations.map((allocation) => [allocation.invoiceId, allocation.amountCents])),
      method: "credit_card",
      appliedAt: now,
      idempotencyKey: String(prepared.batch.idempotencyKey),
      provider: "stripe",
      stripePaymentIntentId: input.paymentIntentId,
      stripeAccountId: input.stripeAccountId || prepared.batch.stripeAccountId || undefined,
      existingBatchId: prepared.batch.id,
      reference: input.paymentIntentId,
      notes: "Portal Stripe payment",
    });
  } catch (error: any) {
    // This runs after the provider-success evidence transaction, preserving a
    // retryable pending batch even if the allocator's transaction rolls back.
    await db.update(customerPaymentBatches).set({
      providerEvidence: {
        ...(prepared.batch.providerEvidence as Record<string, unknown>),
        reconciliationRequired: true,
        localFinalizationError: String(error?.message || error).slice(0, 500),
        localFinalizationFailedAt: new Date().toISOString(),
      },
      updatedAt: new Date(),
    } as any).where(and(
      eq(customerPaymentBatches.id, prepared.batch.id),
      eq(customerPaymentBatches.organizationId, input.organizationId),
      eq(customerPaymentBatches.status, "pending"),
    ));
    throw error;
  }
}
