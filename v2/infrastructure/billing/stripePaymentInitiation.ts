import type { Pool } from "pg";
import type { OperationContext } from "../../src/application/operation.js";
import { V2ApplicationError } from "../../src/errors/applicationError.js";
import type { BillingPaymentsApplicationService } from "../../src/modules/billing/paymentApplication.js";
import { brandedId, currencyCode, money, type InvoiceId, type OrganizationId, type PaymentId } from "../../src/modules/shared/commercialValues.js";
import { V2StripeProviderAdapter } from "./stripeProviderIngress.js";
import type { PostgresStripeConnectAccounts } from "./stripeConnectAccounts.js";
import { assertStripeCardPaymentMinimum, stripeRejectedBeforeCreation } from "../../src/modules/billing/stripePaymentPolicy.js";

type OperationRow = Readonly<{ provider_transaction_id: string | null; stripe_account_id:string|null; amount_cents: string; currency: string }>;

/**
 * Starts provider operations without materializing a V2 Payment or Refund.
 * The signed Stripe webhook remains the only path that records financial facts.
 */
export class StripePaymentInitiation {
  private readonly provider = new V2StripeProviderAdapter();
  constructor(private readonly pool: Pool, private readonly payments: BillingPaymentsApplicationService, private readonly accounts: PostgresStripeConnectAccounts) {}

  async beginPayment(context: OperationContext, input: Readonly<{ organizationId: string; invoiceId: string; amountCents: number; currency: string; businessRequestId: string }>) {
    assertStripeCardPaymentMinimum(input.amountCents, input.currency);
    const account=await this.accounts.requireReadyAccount(input.organizationId);
    const operation = await this.payments.beginProviderOperation(context, {
      organizationId: brandedId<"OrganizationId">(input.organizationId), invoiceId: brandedId<"InvoiceId">(input.invoiceId),
      kind: "payment", amount: money(currencyCode(input.currency), input.amountCents), provider: "stripe",
      providerIdempotencyKey: `v2:stripe:payment:${input.organizationId}:${input.businessRequestId}`,
      providerAccountId: account.accountId,
      businessRequestId: brandedId<"BusinessRequestId">(input.businessRequestId),
    });
    if (!operation.ok) return operation;
    const existing = await this.operation(input.organizationId, operation.value.providerOperationId);
    if (existing?.provider_transaction_id) {
      if (!existing.stripe_account_id) throw new V2ApplicationError("CONFLICT","This provider operation predates tenant Stripe Connect.");
      const paymentIntent = await this.provider.retrievePaymentIntent(existing.provider_transaction_id, existing.stripe_account_id);
      return { ok: true as const, value: { providerOperationId: operation.value.providerOperationId, paymentIntentId: existing.provider_transaction_id, clientSecret: paymentIntent.clientSecret, stripeAccountId:existing.stripe_account_id, amountCents: Number(existing.amount_cents), currency: existing.currency } };
    }
    let created: Readonly<{ providerTransactionId: string; clientSecret: string }>;
    try {
      created = await this.provider.createPaymentIntent({ amountCents: input.amountCents, currency: input.currency, organizationId: input.organizationId, invoiceId: input.invoiceId, providerOperationId: operation.value.providerOperationId, providerIdempotencyKey: operation.value.providerIdempotencyKey, stripeAccountId:account.accountId });
    } catch (cause) {
      if (stripeRejectedBeforeCreation(cause)) {
        await this.markRejectedBeforeCreation(input.organizationId, operation.value.providerOperationId);
        throw new V2ApplicationError("VALIDATION_ERROR", "Stripe rejected this card payment before it was created. The Invoice remains unpaid; correct the issue and try again.");
      }
      throw cause;
    }
    const paymentIntentId = await this.persist(input.organizationId, operation.value.providerOperationId, created.providerTransactionId);
    if (paymentIntentId !== created.providerTransactionId) {
      const paymentIntent = await this.provider.retrievePaymentIntent(paymentIntentId, account.accountId);
      return { ok: true as const, value: { providerOperationId: operation.value.providerOperationId, paymentIntentId, clientSecret: paymentIntent.clientSecret, stripeAccountId:account.accountId, amountCents: input.amountCents, currency: input.currency } };
    }
    return { ok: true as const, value: { providerOperationId: operation.value.providerOperationId, paymentIntentId, clientSecret: created.clientSecret, stripeAccountId:account.accountId, amountCents: input.amountCents, currency: input.currency } };
  }

  async beginRefund(context: OperationContext, input: Readonly<{ organizationId: string; invoiceId: string; paymentId: string; amountCents: number; currency: string; businessRequestId: string }>) {
    const original = await this.pool.query<{ provider_transaction_id: string | null; stripe_account_id:string|null; source: string }>("SELECT provider_transaction_id,stripe_account_id,source FROM v2_billing_payments WHERE organization_id=$1 AND id=$2 AND invoice_id=$3", [input.organizationId, input.paymentId, input.invoiceId]);
    const payment = original.rows[0];
    if (!payment?.provider_transaction_id || !payment.stripe_account_id || payment.source !== "provider") throw new V2ApplicationError("CONFLICT", "Only a Stripe Connect-originated V2 Payment can be refunded through Stripe.");
    await this.accounts.assertOperationAccount(input.organizationId, (await this.pool.query<{provider_operation_id:string}>("SELECT provider_operation_id FROM v2_billing_payments WHERE organization_id=$1 AND id=$2",[input.organizationId,input.paymentId])).rows[0]?.provider_operation_id ?? "", payment.stripe_account_id);
    const operation = await this.payments.beginProviderOperation(context, {
      organizationId: brandedId<"OrganizationId">(input.organizationId), invoiceId: brandedId<"InvoiceId">(input.invoiceId), paymentId: brandedId<"PaymentId">(input.paymentId),
      kind: "refund", amount: money(currencyCode(input.currency), input.amountCents), provider: "stripe",
      providerIdempotencyKey: `v2:stripe:refund:${input.organizationId}:${input.businessRequestId}`,
      providerAccountId: payment.stripe_account_id,
      businessRequestId: brandedId<"BusinessRequestId">(input.businessRequestId),
    });
    if (!operation.ok) return operation;
    const existing = await this.operation(input.organizationId, operation.value.providerOperationId);
    if (existing?.provider_transaction_id) return { ok: true as const, value: { providerOperationId: operation.value.providerOperationId, refundId: existing.provider_transaction_id } };
    const created = await this.provider.createRefund({ paymentIntentId: payment.provider_transaction_id, amountCents: input.amountCents, currency:input.currency, organizationId: input.organizationId, invoiceId: input.invoiceId, paymentId: input.paymentId, providerOperationId: operation.value.providerOperationId, providerIdempotencyKey: operation.value.providerIdempotencyKey, stripeAccountId:payment.stripe_account_id });
    return { ok: true as const, value: { providerOperationId: operation.value.providerOperationId, refundId: await this.persist(input.organizationId, operation.value.providerOperationId, created.providerTransactionId) } };
  }

  private async operation(organizationId: string, providerOperationId: string): Promise<OperationRow | null> { const result = await this.pool.query<OperationRow>("SELECT provider_transaction_id,stripe_account_id,amount_cents,currency FROM v2_billing_provider_financial_operations WHERE organization_id=$1 AND id=$2", [organizationId, providerOperationId]); return result.rows[0] ?? null; }
  private async persist(organizationId: string, providerOperationId: string, providerTransactionId: string): Promise<string> { const result = await this.pool.query<{ provider_transaction_id: string }>("UPDATE v2_billing_provider_financial_operations SET provider_transaction_id=COALESCE(provider_transaction_id,$3),reconciliation_state='pending',updated_at=now() WHERE organization_id=$1 AND id=$2 RETURNING provider_transaction_id", [organizationId, providerOperationId, providerTransactionId]); const value = result.rows[0]?.provider_transaction_id; if (!value) throw new V2ApplicationError("RETRYABLE_FAILURE", "Stripe initiation state could not be persisted."); return value; }
  private async markRejectedBeforeCreation(organizationId: string, providerOperationId: string): Promise<void> {
    await this.pool.query("UPDATE v2_billing_provider_financial_operations SET reconciliation_state='failed',updated_at=now() WHERE organization_id=$1 AND id=$2 AND operation_kind='payment' AND reconciliation_state='uncertain' AND provider_transaction_id IS NULL", [organizationId, providerOperationId]);
  }
}
