import { createHash } from "node:crypto";
import { getStripeClient, getStripeWebhookSecret } from "../../../server/lib/stripe.js";
import type { OperationContext } from "../../src/application/operation.js";
import { V2ApplicationError } from "../../src/errors/applicationError.js";
import type { BillingPaymentsApplicationService } from "../../src/modules/billing/paymentApplication.js";
import { brandedId } from "../../src/modules/shared/commercialValues.js";

/**
 * The small provider boundary shared with the former application.  Stripe SDK
 * construction and signature verification are provider plumbing only; no
 * legacy payment table or invoice state is reachable through this adapter.
 */
export type VerifiedStripeEvent = Readonly<{
  id: string;
  type: string;
  created?: number;
  data: Readonly<{ object: Record<string, unknown> }>;
}>;

export type StripeWebhookVerifier = Readonly<{
  constructEvent(payload: Buffer, signature: string): VerifiedStripeEvent;
}>;

export const productionStripeWebhookVerifier = (): StripeWebhookVerifier => ({
  constructEvent: (payload, signature) => getStripeClient().webhooks.constructEvent(payload, signature, getStripeWebhookSecret()) as unknown as VerifiedStripeEvent,
});

/**
 * Provider calls are intentionally separate from the V2 ledger. Callers first
 * create a durable V2 provider operation, then use its idempotency key here.
 * Stripe metadata makes the signed callback attributable to that exact V2
 * operation; it never names a legacy invoice or payment record.
 */
export class V2StripeProviderAdapter {
  async createPaymentIntent(input: Readonly<{ amountCents: number; currency: string; organizationId: string; invoiceId: string; providerOperationId: string; providerIdempotencyKey: string; description?: string }>): Promise<Readonly<{ providerTransactionId: string; clientSecret: string }>> {
    if (!Number.isSafeInteger(input.amountCents) || input.amountCents <= 0) throw new V2ApplicationError("VALIDATION_ERROR", "Stripe payment amount must be positive exact cents.");
    const paymentIntent = await getStripeClient().paymentIntents.create({
      amount: input.amountCents,
      currency: input.currency.toLowerCase(),
      ...(input.description ? { description: input.description } : {}),
      automatic_payment_methods: { enabled: true },
      metadata: {
        v2ProviderOperationId: input.providerOperationId,
        v2OrganizationId: input.organizationId,
        v2InvoiceId: input.invoiceId,
      },
    }, { idempotencyKey: input.providerIdempotencyKey });
    if (!paymentIntent.client_secret) throw new V2ApplicationError("RETRYABLE_FAILURE", "Stripe did not return a client payment secret.");
    return { providerTransactionId: paymentIntent.id, clientSecret: paymentIntent.client_secret };
  }

  async retrievePaymentIntent(paymentIntentId: string): Promise<Readonly<{ clientSecret: string }>> {
    const paymentIntent = await getStripeClient().paymentIntents.retrieve(paymentIntentId);
    if (paymentIntent.status === "succeeded") throw new V2ApplicationError("CONFLICT", "Stripe accepted this payment; waiting for its signed confirmation.");
    if (paymentIntent.status === "canceled") throw new V2ApplicationError("CONFLICT", "The prior Stripe payment attempt did not complete. Start a new payment attempt to retry.");
    if (!paymentIntent.client_secret) throw new V2ApplicationError("RETRYABLE_FAILURE", "Stripe payment confirmation details are unavailable.");
    return { clientSecret: paymentIntent.client_secret };
  }

  async createRefund(input: Readonly<{ paymentIntentId: string; amountCents: number; organizationId: string; invoiceId: string; paymentId: string; providerOperationId: string; providerIdempotencyKey: string }>): Promise<Readonly<{ providerTransactionId: string }>> {
    if (!Number.isSafeInteger(input.amountCents) || input.amountCents <= 0) throw new V2ApplicationError("VALIDATION_ERROR", "Stripe refund amount must be positive exact cents.");
    const refund = await getStripeClient().refunds.create({
      payment_intent: input.paymentIntentId,
      amount: input.amountCents,
      metadata: {
        v2ProviderOperationId: input.providerOperationId,
        v2OrganizationId: input.organizationId,
        v2InvoiceId: input.invoiceId,
        v2PaymentId: input.paymentId,
      },
    }, { idempotencyKey: input.providerIdempotencyKey });
    return { providerTransactionId: refund.id };
  }
}

type ProviderPayments = Pick<BillingPaymentsApplicationService, "confirmProviderPayment" | "confirmProviderRefund">;

type StripeIngressResult = Readonly<{
  disposition: "applied" | "replayed" | "ignored";
  eventId: string;
  kind?: "payment" | "refund";
  resourceId?: string;
}>;

type V2StripeMetadata = Readonly<{
  operationId: string;
  organizationId: string;
  invoiceId: string;
  paymentId?: string;
}>;

const stringValue = (value: unknown): string | undefined => typeof value === "string" && value.trim() ? value.trim() : undefined;
const metadata = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const occurredAt = (event: VerifiedStripeEvent): string => Number.isFinite(event.created) ? new Date(Number(event.created) * 1000).toISOString() : new Date().toISOString();

/** Metadata is written by the V2 payment/refund creation adapter, never accepted from a browser request. */
export const v2StripeMetadata = (value: unknown, requirePaymentId = false): V2StripeMetadata | null => {
  const source = metadata(value);
  const operationId = stringValue(source.v2ProviderOperationId);
  const organizationId = stringValue(source.v2OrganizationId);
  const invoiceId = stringValue(source.v2InvoiceId);
  const paymentId = stringValue(source.v2PaymentId);
  if (!operationId || !organizationId || !invoiceId || (requirePaymentId && !paymentId)) return null;
  return { operationId, organizationId, invoiceId, ...(paymentId ? { paymentId } : {}) };
};

const serviceContext = (organizationId: string, eventId: string, operation: string): OperationContext => ({
  organizationId,
  operationId: `stripe.webhook.${operation}.v2`,
  businessRequest: { id: `stripe-webhook:${eventId}`, payloadFingerprint: `sha256:${createHash("sha256").update(`${operation}:${eventId}`).digest("hex")}` },
  principal: { kind: "service", organizationId, clientId: "stripe-webhook", capabilities: ["payment.record", "refund.issue"] },
});

/**
 * Canonical V2 Stripe ingress. A signed event can only materialize a V2
 * provider operation that was created before Stripe was called. It deliberately
 * has no import of the legacy `payments`, `invoices`, or webhook-event stores.
 */
export class StripeProviderIngress {
  constructor(private readonly verifier: StripeWebhookVerifier, private readonly payments: ProviderPayments) {}

  async receive(payload: Buffer, signature: string | undefined): Promise<StripeIngressResult> {
    if (!signature) throw new V2ApplicationError("VALIDATION_ERROR", "Stripe signature is required.");
    const event = this.verifier.constructEvent(payload, signature);
    if (!stringValue(event.id) || !stringValue(event.type)) throw new V2ApplicationError("VALIDATION_ERROR", "Stripe event identity is required.");
    if (event.type === "payment_intent.succeeded") return this.applyPayment(event);
    if ((event.type === "refund.created" || event.type === "refund.updated") && stringValue(event.data.object.status) === "succeeded") return this.applyRefund(event);
    return { disposition: "ignored", eventId: event.id };
  }

  private async applyPayment(event: VerifiedStripeEvent): Promise<StripeIngressResult> {
    const paymentIntentId = stringValue(event.data.object.id);
    const contextMetadata = v2StripeMetadata(event.data.object.metadata);
    if (!paymentIntentId || !contextMetadata) return { disposition: "ignored", eventId: event.id };
    const result = await this.payments.confirmProviderPayment(
      serviceContext(contextMetadata.organizationId, event.id, "payment"),
      {
        organizationId: brandedId<"OrganizationId">(contextMetadata.organizationId),
        invoiceId: brandedId<"InvoiceId">(contextMetadata.invoiceId),
        providerOperationId: brandedId<"ProviderFinancialOperationId">(contextMetadata.operationId),
        providerEventId: event.id,
        providerTransactionId: paymentIntentId,
        occurredAt: occurredAt(event),
        businessRequestId: brandedId<"BusinessRequestId">(`stripe-webhook:${event.id}`),
      },
    );
    if (!result.ok) throw result.error;
    // The application service's durable operation request absorbs exact-event
    // replay before a second immutable payment can be appended.
    return { disposition: "applied", eventId: event.id, kind: "payment", resourceId: result.value.paymentId };
  }

  private async applyRefund(event: VerifiedStripeEvent): Promise<StripeIngressResult> {
    const refundId = stringValue(event.data.object.id);
    const contextMetadata = v2StripeMetadata(event.data.object.metadata, true);
    if (!refundId || !contextMetadata?.paymentId) return { disposition: "ignored", eventId: event.id };
    const result = await this.payments.confirmProviderRefund(
      serviceContext(contextMetadata.organizationId, event.id, "refund"),
      {
        organizationId: brandedId<"OrganizationId">(contextMetadata.organizationId),
        invoiceId: brandedId<"InvoiceId">(contextMetadata.invoiceId),
        paymentId: brandedId<"PaymentId">(contextMetadata.paymentId),
        providerOperationId: brandedId<"ProviderFinancialOperationId">(contextMetadata.operationId),
        providerEventId: event.id,
        providerTransactionId: refundId,
        occurredAt: occurredAt(event),
        businessRequestId: brandedId<"BusinessRequestId">(`stripe-webhook:${event.id}`),
      },
    );
    if (!result.ok) throw result.error;
    return { disposition: "applied", eventId: event.id, kind: "refund", resourceId: result.value.refundId };
  }
}
