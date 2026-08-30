import type { Pool } from "pg";
import type { OperationContext } from "../../src/application/operation.js";
import { V2ApplicationError } from "../../src/errors/applicationError.js";
import type { BillingPaymentsApplicationService } from "../../src/modules/billing/paymentApplication.js";
import { brandedId, currencyCode, money, type InvoiceId, type OrganizationId, type PaymentId } from "../../src/modules/shared/commercialValues.js";
import { V2StripeProviderAdapter } from "./stripeProviderIngress.js";

type OperationRow = Readonly<{ provider_transaction_id: string | null; amount_cents: string; currency: string }>;

/**
 * Starts provider operations without materializing a V2 Payment or Refund.
 * The signed Stripe webhook remains the only path that records financial facts.
 */
export class StripePaymentInitiation {
  private readonly provider = new V2StripeProviderAdapter();
  constructor(private readonly pool: Pool, private readonly payments: BillingPaymentsApplicationService) {}

  async beginPayment(context: OperationContext, input: Readonly<{ organizationId: string; invoiceId: string; amountCents: number; currency: string; businessRequestId: string }>) {
    const operation = await this.payments.beginProviderOperation(context, {
      organizationId: brandedId<"OrganizationId">(input.organizationId), invoiceId: brandedId<"InvoiceId">(input.invoiceId),
      kind: "payment", amount: money(currencyCode(input.currency), input.amountCents), provider: "stripe",
      providerIdempotencyKey: `v2:stripe:payment:${input.organizationId}:${input.businessRequestId}`,
      businessRequestId: brandedId<"BusinessRequestId">(input.businessRequestId),
    });
    if (!operation.ok) return operation;
    const existing = await this.operation(input.organizationId, operation.value.providerOperationId);
    if (existing?.provider_transaction_id) {
      const paymentIntent = await this.provider.retrievePaymentIntent(existing.provider_transaction_id);
      return { ok: true as const, value: { providerOperationId: operation.value.providerOperationId, paymentIntentId: existing.provider_transaction_id, clientSecret: paymentIntent.clientSecret, amountCents: Number(existing.amount_cents), currency: existing.currency } };
    }
    const created = await this.provider.createPaymentIntent({ amountCents: input.amountCents, currency: input.currency, organizationId: input.organizationId, invoiceId: input.invoiceId, providerOperationId: operation.value.providerOperationId, providerIdempotencyKey: operation.value.providerIdempotencyKey });
    const paymentIntentId = await this.persist(input.organizationId, operation.value.providerOperationId, created.providerTransactionId);
    if (paymentIntentId !== created.providerTransactionId) {
      const paymentIntent = await this.provider.retrievePaymentIntent(paymentIntentId);
      return { ok: true as const, value: { providerOperationId: operation.value.providerOperationId, paymentIntentId, clientSecret: paymentIntent.clientSecret, amountCents: input.amountCents, currency: input.currency } };
    }
    return { ok: true as const, value: { providerOperationId: operation.value.providerOperationId, paymentIntentId, clientSecret: created.clientSecret, amountCents: input.amountCents, currency: input.currency } };
  }

  async beginRefund(context: OperationContext, input: Readonly<{ organizationId: string; invoiceId: string; paymentId: string; amountCents: number; currency: string; businessRequestId: string }>) {
    const original = await this.pool.query<{ provider_transaction_id: string | null; source: string }>("SELECT provider_transaction_id,source FROM v2_billing_payments WHERE organization_id=$1 AND id=$2 AND invoice_id=$3", [input.organizationId, input.paymentId, input.invoiceId]);
    const payment = original.rows[0];
    if (!payment?.provider_transaction_id || payment.source !== "provider") throw new V2ApplicationError("CONFLICT", "Only a Stripe-originated V2 Payment can be refunded through Stripe.");
    const operation = await this.payments.beginProviderOperation(context, {
      organizationId: brandedId<"OrganizationId">(input.organizationId), invoiceId: brandedId<"InvoiceId">(input.invoiceId), paymentId: brandedId<"PaymentId">(input.paymentId),
      kind: "refund", amount: money(currencyCode(input.currency), input.amountCents), provider: "stripe",
      providerIdempotencyKey: `v2:stripe:refund:${input.organizationId}:${input.businessRequestId}`,
      businessRequestId: brandedId<"BusinessRequestId">(input.businessRequestId),
    });
    if (!operation.ok) return operation;
    const existing = await this.operation(input.organizationId, operation.value.providerOperationId);
    if (existing?.provider_transaction_id) return { ok: true as const, value: { providerOperationId: operation.value.providerOperationId, refundId: existing.provider_transaction_id } };
    const created = await this.provider.createRefund({ paymentIntentId: payment.provider_transaction_id, amountCents: input.amountCents, organizationId: input.organizationId, invoiceId: input.invoiceId, paymentId: input.paymentId, providerOperationId: operation.value.providerOperationId, providerIdempotencyKey: operation.value.providerIdempotencyKey });
    return { ok: true as const, value: { providerOperationId: operation.value.providerOperationId, refundId: await this.persist(input.organizationId, operation.value.providerOperationId, created.providerTransactionId) } };
  }

  private async operation(organizationId: string, providerOperationId: string): Promise<OperationRow | null> { const result = await this.pool.query<OperationRow>("SELECT provider_transaction_id,amount_cents,currency FROM v2_billing_provider_financial_operations WHERE organization_id=$1 AND id=$2", [organizationId, providerOperationId]); return result.rows[0] ?? null; }
  private async persist(organizationId: string, providerOperationId: string, providerTransactionId: string): Promise<string> { const result = await this.pool.query<{ provider_transaction_id: string }>("UPDATE v2_billing_provider_financial_operations SET provider_transaction_id=COALESCE(provider_transaction_id,$3),reconciliation_state='pending',updated_at=now() WHERE organization_id=$1 AND id=$2 RETURNING provider_transaction_id", [organizationId, providerOperationId, providerTransactionId]); const value = result.rows[0]?.provider_transaction_id; if (!value) throw new V2ApplicationError("RETRYABLE_FAILURE", "Stripe initiation state could not be persisted."); return value; }
}
