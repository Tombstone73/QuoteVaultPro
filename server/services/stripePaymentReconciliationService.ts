import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "../db";
import { integrationConnections, invoices, payments, paymentWebhookEvents, stripeRefundRequests } from "../../shared/schema";
import { reconcileInvoicePaymentStateInTransaction } from "../invoicesService";

/**
 * The route boundary must verify Stripe's signature before constructing this
 * input.  This deliberately contains only payment-reconciliation data: raw
 * webhook bodies can contain billing/contact data that has no place in the
 * durable event ledger.
 */
export type StripePaymentObservationInput = {
  eventId: string;
  type: string;
  organizationId?: string | null;
  invoiceId?: string | null;
  paymentIntentId?: string | null;
  stripeAccountId?: string | null;
  amountCents?: number | null;
  currency?: string | null;
  refundId?: string | null;
  refundRequestId?: string | null;
  refundAmountCents?: number | null;
  refundStatus?: string | null;
  occurredAt?: Date | string | null;
};

type SanitizedStripeObservation = {
  schemaVersion: 1;
  provider: "stripe";
  eventId: string;
  type: string;
  organizationId: string | null;
  invoiceId: string | null;
  paymentIntentId: string | null;
  stripeAccountId: string | null;
  amountCents: number | null;
  currency: string | null;
  refundId: string | null;
  refundRequestId: string | null;
  refundAmountCents: number | null;
  refundStatus: string | null;
  occurredAt: string;
};

export type StripePaymentReconciliationResult = {
  eventId: string;
  processed: boolean;
  alreadyProcessed: boolean;
  effect: "succeeded" | "failed" | "canceled" | "refunded" | "ignored" | "missing_payment";
  paymentId: string | null;
  invoiceId: string | null;
};

function textOrNull(value: unknown): string | null {
  const valueAsText = typeof value === "string" ? value.trim() : "";
  return valueAsText ? valueAsText : null;
}

function nonNegativeCents(value: unknown): number | null {
  const cents = Number(value);
  if (!Number.isFinite(cents)) return null;
  return Math.max(0, Math.round(cents));
}

function isoOrNow(value: unknown): string {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString();
  if (typeof value === "string") {
    const parsed = new Date(value);
    if (Number.isFinite(parsed.getTime())) return parsed.toISOString();
  }
  return new Date().toISOString();
}

function sanitizeObservation(input: StripePaymentObservationInput): SanitizedStripeObservation {
  const eventId = textOrNull(input.eventId);
  const type = textOrNull(input.type);
  if (!eventId) throw Object.assign(new Error("Stripe event id is required."), { code: "STRIPE_EVENT_ID_REQUIRED" });
  if (!type) throw Object.assign(new Error("Stripe event type is required."), { code: "STRIPE_EVENT_TYPE_REQUIRED" });

  return {
    schemaVersion: 1,
    provider: "stripe",
    eventId,
    type,
    organizationId: textOrNull(input.organizationId),
    invoiceId: textOrNull(input.invoiceId),
    paymentIntentId: textOrNull(input.paymentIntentId),
    stripeAccountId: textOrNull(input.stripeAccountId),
    amountCents: nonNegativeCents(input.amountCents),
    currency: textOrNull(input.currency)?.toUpperCase().slice(0, 8) || null,
    refundId: textOrNull(input.refundId),
    refundRequestId: textOrNull(input.refundRequestId),
    refundAmountCents: nonNegativeCents(input.refundAmountCents),
    refundStatus: textOrNull(input.refundStatus)?.toLowerCase() || null,
    occurredAt: isoOrNow(input.occurredAt),
  };
}

function readStoredObservation(value: unknown): SanitizedStripeObservation {
  const payload = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  return sanitizeObservation({
    eventId: payload.eventId as string,
    type: payload.type as string,
    organizationId: payload.organizationId as string | null,
    invoiceId: payload.invoiceId as string | null,
    paymentIntentId: payload.paymentIntentId as string | null,
    stripeAccountId: payload.stripeAccountId as string | null,
    amountCents: payload.amountCents as number | null,
    currency: payload.currency as string | null,
    refundId: payload.refundId as string | null,
    refundRequestId: payload.refundRequestId as string | null,
    refundAmountCents: payload.refundAmountCents as number | null,
    refundStatus: payload.refundStatus as string | null,
    occurredAt: payload.occurredAt as string | null,
  });
}

function eventEffect(type: string): "succeeded" | "failed" | "canceled" | "refunded" | "ignored" {
  switch (type) {
    case "payment_intent.succeeded": return "succeeded";
    case "payment_intent.payment_failed": return "failed";
    case "payment_intent.canceled": return "canceled";
    case "refund.created":
    case "refund.updated":
      return "refunded";
    default:
      return "ignored";
  }
}

function required(value: string | null, code: string, message: string): string {
  if (!value) throw Object.assign(new Error(message), { code });
  return value;
}

async function lock(tx: any, key: string): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${key}))`);
}

async function findPaymentByIntent(tx: any, organizationId: string, paymentIntentId: string) {
  const [payment] = await tx.select().from(payments).where(and(
    eq(payments.organizationId, organizationId),
    eq(payments.provider, "stripe"),
    eq(payments.stripePaymentIntentId, paymentIntentId),
  )).limit(1);
  return payment as any | undefined;
}

async function markProcessed(tx: any, eventId: string, now: Date): Promise<void> {
  await tx.update(paymentWebhookEvents).set({
    status: "processed",
    processedAt: now,
    error: null,
  } as any).where(and(
    eq(paymentWebhookEvents.provider, "stripe"),
    eq(paymentWebhookEvents.eventId, eventId),
  ));
}

/**
 * Capture a safe, minimal observation exactly once, then apply its local
 * financial effect. Capture is intentionally outside the processing
 * transaction so a transient processing failure remains recoverable.
 */
export async function captureAndApply(input: StripePaymentObservationInput): Promise<StripePaymentReconciliationResult> {
  const observation = sanitizeObservation(input);
  await db.insert(paymentWebhookEvents).values({
    provider: "stripe",
    eventId: observation.eventId,
    type: observation.type,
    organizationId: observation.organizationId,
    status: "received",
    receivedAt: new Date(),
    payload: observation as any,
  } as any).onConflictDoNothing({
    target: [paymentWebhookEvents.provider, paymentWebhookEvents.eventId],
  });

  const [stored] = await db.select({ payload: paymentWebhookEvents.payload, status: paymentWebhookEvents.status }).from(paymentWebhookEvents).where(and(
    eq(paymentWebhookEvents.provider, "stripe"),
    eq(paymentWebhookEvents.eventId, observation.eventId),
  )).limit(1);
  const rawPayload = stored?.payload as any;
  if (stored && rawPayload?.schemaVersion !== 1 && String(stored.status || "").toLowerCase() !== "processed") {
    await db.update(paymentWebhookEvents).set({
      type: observation.type,
      organizationId: observation.organizationId,
      payload: observation as any,
      error: null,
      status: "received",
      processedAt: null,
    } as any).where(and(eq(paymentWebhookEvents.provider, "stripe"), eq(paymentWebhookEvents.eventId, observation.eventId)));
  }
  const existing = stored ? (rawPayload?.schemaVersion === 1 ? readStoredObservation(stored.payload) : observation) : null;
  if (!existing || existing.type !== observation.type || existing.organizationId !== observation.organizationId ||
    existing.invoiceId !== observation.invoiceId || existing.paymentIntentId !== observation.paymentIntentId ||
    existing.stripeAccountId !== observation.stripeAccountId || existing.amountCents !== observation.amountCents ||
    existing.currency !== observation.currency || existing.refundId !== observation.refundId || existing.refundRequestId !== observation.refundRequestId ||
    existing.refundAmountCents !== observation.refundAmountCents || existing.refundStatus !== observation.refundStatus) {
    throw Object.assign(new Error("Stripe event identity was reused with a conflicting payment observation."), { code: "STRIPE_EVENT_CONFLICT" });
  }

  return retryByEvent(observation.eventId);
}

/** Reapply a captured observation. Safe for Stripe retries and recovery jobs. */
export async function retryByEvent(eventId: string): Promise<StripePaymentReconciliationResult> {
  const normalizedEventId = required(textOrNull(eventId), "STRIPE_EVENT_ID_REQUIRED", "Stripe event id is required.");
  try {
    return await db.transaction(async (tx) => {
      await lock(tx, `stripe-webhook:${normalizedEventId}`);
      const [event] = await tx.select().from(paymentWebhookEvents).where(and(
        eq(paymentWebhookEvents.provider, "stripe"),
        eq(paymentWebhookEvents.eventId, normalizedEventId),
      )).limit(1);
      if (!event) throw Object.assign(new Error("Stripe webhook event not found."), { code: "STRIPE_EVENT_NOT_FOUND" });

      const observation = readStoredObservation((event as any).payload);
      if (String((event as any).status).toLowerCase() === "processed" && (event as any).processedAt) {
        return {
          eventId: normalizedEventId, processed: true, alreadyProcessed: true,
          effect: eventEffect(observation.type), paymentId: null, invoiceId: observation.invoiceId,
        };
      }

      const effect = eventEffect(observation.type);
      const now = new Date();
      if (effect === "ignored") {
        await markProcessed(tx, normalizedEventId, now);
        return { eventId: normalizedEventId, processed: true, alreadyProcessed: false, effect, paymentId: null, invoiceId: observation.invoiceId };
      }

      const organizationId = required(observation.organizationId, "STRIPE_EVENT_ORGANIZATION_REQUIRED", "Stripe observation is missing its organization.");
      const paymentIntentId = required(observation.paymentIntentId, "STRIPE_EVENT_PAYMENT_INTENT_REQUIRED", "Stripe observation is missing its PaymentIntent id.");
      // Multiple Stripe event ids may describe the same PaymentIntent. Serialize
      // those separately from the per-event lock before reading or mutating it.
      await lock(tx, `stripe-payment:${organizationId}:${paymentIntentId}`);

      let payment = await findPaymentByIntent(tx, organizationId, paymentIntentId);
      if (!payment && effect !== "succeeded") {
        await markProcessed(tx, normalizedEventId, now);
        return { eventId: normalizedEventId, processed: true, alreadyProcessed: false, effect: "missing_payment", paymentId: null, invoiceId: observation.invoiceId };
      }

      if (payment && observation.invoiceId && String(payment.invoiceId) !== observation.invoiceId) {
        throw Object.assign(new Error("Stripe observation invoice does not match the local payment."), { code: "STRIPE_EVENT_INVOICE_MISMATCH" });
      }

      const invoiceId = payment ? String(payment.invoiceId) : required(observation.invoiceId, "STRIPE_EVENT_INVOICE_REQUIRED", "Stripe success observation is missing its invoice.");
      const stripeAccountId = observation.stripeAccountId || textOrNull((payment as any)?.metadata?.stripeAccountId);
      const requiredStripeAccountId = required(stripeAccountId, "STRIPE_EVENT_ACCOUNT_REQUIRED", "Stripe observation is missing its connected-account identity.");
      const [connection] = await tx.select({ organizationId: integrationConnections.organizationId }).from(integrationConnections).where(and(
        eq(integrationConnections.provider, "stripe"),
        eq(integrationConnections.externalAccountId, requiredStripeAccountId),
      )).limit(1);
      if (!connection || String(connection.organizationId) !== organizationId) {
        throw Object.assign(new Error("Stripe connected account does not belong to the observation organization."), { code: "STRIPE_EVENT_ACCOUNT_MISMATCH" });
      }
      await lock(tx, `invoice-rollup:${invoiceId}`);
      const [invoice] = await tx.select({ id: invoices.id }).from(invoices).where(and(
        eq(invoices.id, invoiceId), eq(invoices.organizationId, organizationId),
      )).limit(1);
      if (!invoice) throw Object.assign(new Error("Invoice not found for Stripe observation."), { code: "STRIPE_EVENT_INVOICE_NOT_FOUND" });

      if (effect === "succeeded") {
        const amountCents = observation.amountCents ?? 0;
        if (!payment) {
          const [inserted] = await tx.insert(payments).values({
            organizationId,
            invoiceId,
            provider: "stripe",
            status: "succeeded",
            amount: (amountCents / 100).toFixed(2),
            amountCents,
            currency: observation.currency || "USD",
            stripePaymentIntentId: paymentIntentId,
            method: "credit_card",
            paidAt: now,
            succeededAt: now,
            metadata: { stripePaymentIntentId: paymentIntentId, stripeAccountId: observation.stripeAccountId } as any,
            createdByUserId: null,
            syncStatus: "pending",
            createdAt: now,
            updatedAt: now,
          } as any).returning();
          payment = inserted as any;
        } else if (Number(payment.amountCents || 0) !== amountCents) {
          throw Object.assign(new Error("Stripe observation amount does not match the local payment."), { code: "STRIPE_EVENT_AMOUNT_MISMATCH" });
        } else if (String(payment.status).toLowerCase() !== "succeeded") {
          const [updated] = await tx.update(payments).set({
            status: "succeeded",
            amount: (amountCents / 100).toFixed(2),
            amountCents,
            currency: observation.currency || String(payment.currency || "USD"),
            paidAt: now,
            succeededAt: now,
            failedAt: null,
            canceledAt: null,
            updatedAt: now,
          } as any).where(and(eq(payments.id, payment.id), eq(payments.organizationId, organizationId))).returning();
          payment = updated as any;
        }
      } else if (effect === "failed" || effect === "canceled") {
        const targetStatus = effect;
        const currentStatus = String(payment.status).toLowerCase();
        // Terminal failure events can arrive after a successful event. They
        // describe an older attempt and must never undo collected money.
        if (currentStatus !== "succeeded" && currentStatus !== "captured" && currentStatus !== targetStatus) {
          const [updated] = await tx.update(payments).set({
            status: targetStatus,
            ...(targetStatus === "failed" ? { failedAt: now, canceledAt: null } : { canceledAt: now, failedAt: null }),
            updatedAt: now,
          } as any).where(and(eq(payments.id, payment.id), eq(payments.organizationId, organizationId))).returning();
          payment = updated as any;
        }
      } else {
        // Store refunds as immutable negative payment effects. Flipping the
        // original succeeded payment to refunded loses the original collection
        // and cannot represent a partial refund in the v1 payments schema.
        const isRefundSucceeded = observation.refundStatus === "succeeded";
        const refundRequestId = textOrNull(observation.refundRequestId);
        const refundId = textOrNull(observation.refundId);
        // Prefer our metadata correlation, but also correlate by Stripe's
        // refund id when a previously submitted request is revisited.
        if (refundRequestId || refundId) {
          const [refundRequest] = await tx.select().from(stripeRefundRequests).where(and(
            eq(stripeRefundRequests.organizationId, organizationId),
            refundRequestId ? eq(stripeRefundRequests.id, refundRequestId) : eq(stripeRefundRequests.stripeRefundId, refundId!),
          )).limit(1);
          if (refundRequestId && (!refundRequest || String(refundRequest.paymentId) !== String(payment.id) ||
            String(refundRequest.stripePaymentIntentId) !== paymentIntentId || String(refundRequest.stripeAccountId) !== requiredStripeAccountId ||
            Number(refundRequest.amountCents) !== Number(observation.refundAmountCents ?? observation.amountCents ?? 0))) {
            throw Object.assign(new Error("Stripe refund does not match its durable initiation request."), { code: "STRIPE_REFUND_REQUEST_MISMATCH" });
          }
          if (refundRequest) await tx.update(stripeRefundRequests).set({
            stripeRefundId: refundId || null,
            status: isRefundSucceeded ? "succeeded" : ['failed', 'canceled'].includes(String(observation.refundStatus || '').toLowerCase()) ? "failed" : "submitted",
            updatedAt: now,
          } as any).where(and(eq(stripeRefundRequests.id, refundRequest.id), eq(stripeRefundRequests.organizationId, organizationId)));
        }
        if (isRefundSucceeded) {
          const refundAmountCents = observation.refundAmountCents ?? observation.amountCents ?? 0;
          const refundTransactionId = observation.refundId || `stripe-refund-event:${normalizedEventId}`;
          const [existingRefund] = await tx.select().from(payments).where(and(
            eq(payments.organizationId, organizationId),
            eq(payments.provider, "stripe"),
            eq(payments.providerTransactionId, refundTransactionId),
          )).limit(1);
          if (!existingRefund && refundAmountCents > 0) {
            const existingRefunds = await tx.select({ amountCents: payments.amountCents, metadata: payments.metadata }).from(payments).where(and(
              eq(payments.organizationId, organizationId), eq(payments.invoiceId, invoiceId), eq(payments.provider, "stripe"), eq(payments.status, "refunded"),
            ));
            const alreadyRefundedCents = existingRefunds.reduce((total: number, row: any) => (
              row?.metadata?.stripeRefund?.originalPaymentId === payment.id ? total + Math.max(0, Number(row.amountCents || 0)) : total
            ), 0);
            const remainingCents = Math.max(0, Number(payment.amountCents || 0) - alreadyRefundedCents);
            const effectiveRefundCents = Math.min(refundAmountCents, remainingCents);
            if (effectiveRefundCents > 0) {
              await tx.insert(payments).values({
                organizationId,
                invoiceId,
                provider: "stripe",
                status: "refunded",
                amount: (effectiveRefundCents / 100).toFixed(2),
                amountCents: effectiveRefundCents,
                currency: observation.currency || String(payment.currency || "USD"),
                providerTransactionId: refundTransactionId,
                method: String(payment.method || "credit_card"),
                refundedAt: now,
                metadata: { stripeRefund: { id: observation.refundId, originalPaymentId: payment.id, paymentIntentId } } as any,
                createdByUserId: null,
                syncStatus: "pending",
                createdAt: now,
                updatedAt: now,
              } as any);
            }
          }
        }
      }

      const reconciled = await reconcileInvoicePaymentStateInTransaction({ tx, organizationId, invoiceId });
      await markProcessed(tx, normalizedEventId, now);
      return {
        eventId: normalizedEventId, processed: true, alreadyProcessed: false, effect,
        paymentId: payment?.id ? String(payment.id) : null,
        invoiceId: reconciled?.updated?.id ? String(reconciled.updated.id) : invoiceId,
      };
    });
  } catch (error: any) {
    // Keep the captured observation retryable. The error update is intentionally
    // outside the failed transaction, while the financial effect itself never is.
    await db.update(paymentWebhookEvents).set({
      status: "error",
      error: String(error?.message || error).slice(0, 2000),
      processedAt: null,
    } as any).where(and(
      eq(paymentWebhookEvents.provider, "stripe"), eq(paymentWebhookEvents.eventId, normalizedEventId),
    ));
    throw error;
  }
}

/**
 * Local-only recovery sweep. It processes observations already captured in
 * PostgreSQL and never asks Stripe to create, confirm, refund, or retry money.
 */
export async function reconcilePendingStripeObservations(limit = 50): Promise<{ processed: number; failed: number }> {
  const rows = await db.select({ eventId: paymentWebhookEvents.eventId })
    .from(paymentWebhookEvents)
    .where(and(
      eq(paymentWebhookEvents.provider, "stripe"),
      inArray(paymentWebhookEvents.status, ["received", "error"]),
    ))
    .orderBy(paymentWebhookEvents.receivedAt)
    .limit(Math.max(1, Math.min(200, Math.floor(limit))));
  let processed = 0;
  let failed = 0;
  for (const row of rows) {
    try {
      await retryByEvent(row.eventId);
      processed++;
    } catch {
      failed++;
    }
  }
  return { processed, failed };
}
