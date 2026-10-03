import type { Pool } from "pg";
import type { OperationContext } from "../../src/application/operation.js";
import { principalSubject } from "../../src/authorization/principals.js";
import { V2ApplicationError } from "../../src/errors/applicationError.js";
import type { BillingPaymentsApplicationService } from "../../src/modules/billing/paymentApplication.js";
import type { ProviderFinancialOperation, TransitionProviderPaymentIntentInput } from "../../src/modules/billing/contracts.js";
import { brandedId, currencyCode, money, type InvoiceId, type OrganizationId, type PaymentId } from "../../src/modules/shared/commercialValues.js";
import { V2StripeProviderAdapter } from "./stripeProviderIngress.js";
import type { PostgresStripeConnectAccounts } from "./stripeConnectAccounts.js";
import { assertStripeCardPaymentMinimum, minimumStripeCardPaymentCents, stripeRejectedBeforeCreation } from "../../src/modules/billing/stripePaymentPolicy.js";

type OperationRow = Readonly<{ provider_transaction_id: string | null; stripe_account_id:string|null; amount_cents: string; currency: string; reconciliation_state: string; initiated_principal_kind: string; initiated_principal_subject: string }>;
type StripePaymentProvider = Pick<V2StripeProviderAdapter, "createPaymentIntent" | "retrievePaymentIntent" | "createRefund">;

/**
 * Starts provider operations without materializing a V2 Payment or Refund.
 * The signed Stripe webhook remains the only path that records financial facts.
 */
export class StripePaymentInitiation {
  constructor(private readonly pool: Pool, private readonly payments: BillingPaymentsApplicationService, private readonly accounts: PostgresStripeConnectAccounts, private readonly provider: StripePaymentProvider = new V2StripeProviderAdapter()) {}

  async beginPayment(context: OperationContext, input: Readonly<{ organizationId: string; invoiceId: string; amountCents: number; currency: string; businessRequestId: string }>) {
    assertStripeCardPaymentMinimum(input.amountCents, input.currency);
    const account=await this.accounts.requireReadyAccount(input.organizationId);
    const amount = money(currencyCode(input.currency), input.amountCents);
    const allocations = [{ invoiceId: brandedId<"InvoiceId">(input.invoiceId), amount }];
    const operation = await this.payments.beginProviderOperation(context, {
      organizationId: brandedId<"OrganizationId">(input.organizationId), invoiceId: brandedId<"InvoiceId">(input.invoiceId),
      kind: "payment", amount, provider: "stripe",
      providerIdempotencyKey: `v2:stripe:payment:${input.organizationId}:${input.businessRequestId}`,
      providerAccountId: account.accountId,
      businessRequestId: brandedId<"BusinessRequestId">(input.businessRequestId),
    });
    if (!operation.ok) return operation;
    const existing = await this.assertInitiatingPrincipal(context, input.organizationId, operation.value.providerOperationId);
    const existingStripeAccountId = this.assertStripeAccount(existing, account.accountId);
    this.assertPaymentIntentMayBeResumed(existing);
    if (existing.provider_transaction_id) {
      const paymentIntent = await this.recoverClientSecret(context, input.organizationId, operation.value.providerOperationId, existing.provider_transaction_id, existingStripeAccountId, allocations);
      return { ok: true as const, value: { providerOperationId: operation.value.providerOperationId, paymentIntentId: existing.provider_transaction_id, clientSecret: paymentIntent.clientSecret, stripeAccountId: existingStripeAccountId, amountCents: Number(existing.amount_cents), currency: existing.currency } };
    }
    const createOwner = await this.assertInitiatingPrincipal(context, input.organizationId, operation.value.providerOperationId);
    this.assertStripeAccount(createOwner, account.accountId);
    this.assertPaymentIntentMayBeResumed(createOwner);
    let created: Readonly<{ providerTransactionId: string; clientSecret: string }>;
    try {
      created = await this.provider.createPaymentIntent({ amountCents: input.amountCents, currency: input.currency, organizationId: input.organizationId, invoiceId: input.invoiceId, providerOperationId: operation.value.providerOperationId, providerIdempotencyKey: operation.value.providerIdempotencyKey, stripeAccountId:account.accountId });
    } catch (cause) {
      if (stripeRejectedBeforeCreation(cause)) {
        const failed = await this.transitionProviderIntent(context, { organizationId: brandedId<"OrganizationId">(input.organizationId), providerOperationId: operation.value.providerOperationId, providerTransactionId: null, stripeAccountId: account.accountId, state: "failed", allocations });
        if (failed.reconciliationState === "succeeded") throw new V2ApplicationError("CONFLICT", "This card Payment was already confirmed in Billing; refresh the Invoice.");
        throw new V2ApplicationError("VALIDATION_ERROR", "Stripe rejected this card payment before it was created. The provider operation is terminally failed; a new request is required.");
      }
      throw cause;
    }
    const paymentIntent = await this.recoverClientSecret(context, input.organizationId, operation.value.providerOperationId, created.providerTransactionId, account.accountId, allocations);
    return { ok: true as const, value: { providerOperationId: operation.value.providerOperationId, paymentIntentId: created.providerTransactionId, clientSecret: paymentIntent.clientSecret, stripeAccountId:account.accountId, amountCents: input.amountCents, currency: input.currency } };
  }

  /** Starts exactly one Stripe PaymentIntent for a bounded, durable set of
   * Invoice allocations.  Stripe metadata identifies only the provider
   * operation; the database allocation intent remains canonical. */
  async beginPaymentAggregate(context: OperationContext, input: Readonly<{ organizationId: string; currency: string; allocations: readonly Readonly<{ invoiceId: string; amountCents: number }> []; businessRequestId: string }>) {
    if (!input.allocations.length || input.allocations.length > 25) throw new V2ApplicationError("VALIDATION_ERROR", "Choose between one and 25 Invoice allocations.");
    const requestedAmountCents = input.allocations.reduce((total, allocation) => total + allocation.amountCents, 0);
    if (!Number.isSafeInteger(requestedAmountCents) || requestedAmountCents <= 0 || input.allocations.some((allocation) => !allocation.invoiceId || !Number.isSafeInteger(allocation.amountCents) || allocation.amountCents <= 0))
      throw new V2ApplicationError("VALIDATION_ERROR", "Stripe Payment allocations must be positive exact cents.");
    const operationName = "billing.provider.payment.aggregate.begin.v1";
    const hasExistingRequest = await this.operationRequestExists(input.organizationId, operationName, input.businessRequestId);
    if (!hasExistingRequest) assertStripeCardPaymentMinimum(requestedAmountCents, input.currency);
    const account = await this.accounts.requireReadyAccount(input.organizationId);
    const operation = await this.payments.beginProviderPaymentAggregate(context, {
      organizationId: brandedId<"OrganizationId">(input.organizationId),
      allocations: input.allocations.map((allocation) => ({ invoiceId: brandedId<"InvoiceId">(allocation.invoiceId), amount: money(currencyCode(input.currency), allocation.amountCents) })),
      provider: "stripe",
      providerIdempotencyKey: `v2:stripe:payment-aggregate:${input.organizationId}:${input.businessRequestId}`,
      providerAccountId: account.accountId,
      businessRequestId: brandedId<"BusinessRequestId">(input.businessRequestId),
    });
    if (!operation.ok) return operation;
    const value = operation.value.operation;
    const existing = await this.assertInitiatingPrincipal(context, input.organizationId, value.providerOperationId);
    const existingStripeAccountId = this.assertStripeAccount(existing, account.accountId);
    this.assertPaymentIntentMayBeResumed(existing);
    if (existing.provider_transaction_id) {
      const paymentIntent = await this.recoverClientSecret(context, input.organizationId, value.providerOperationId, existing.provider_transaction_id, existingStripeAccountId, operation.value.allocations);
      return { ok: true as const, value: { providerOperationId: value.providerOperationId, paymentIntentId: existing.provider_transaction_id, clientSecret: paymentIntent.clientSecret, stripeAccountId: existingStripeAccountId, amountCents: Number(existing.amount_cents), currency: existing.currency, allocations: operation.value.allocations } };
    }
    const minimum = minimumStripeCardPaymentCents(value.amount.currency);
    if (minimum !== null && value.amount.cents < minimum) {
      if (existing.reconciliation_state !== "uncertain") throw new V2ApplicationError("CONFLICT", "Subminimum Stripe operation lacks proof that provider creation was not attempted; operator review is required.");
      // The historical aggregate path reserved the Billing operation before this check, but Stripe creation followed it.
      const failed = await this.transitionProviderIntent(context, { organizationId: brandedId<"OrganizationId">(input.organizationId), providerOperationId: value.providerOperationId, providerTransactionId: null, stripeAccountId: account.accountId, state: "failed", allocations: operation.value.allocations });
      if (failed.reconciliationState === "succeeded") throw new V2ApplicationError("CONFLICT", "This card Payment was already confirmed in Billing; refresh the Invoice.");
      throw new V2ApplicationError("VALIDATION_ERROR", "This historical subminimum Stripe request was terminally failed before provider creation; submit a new valid Payment request.");
    }
    this.assertStripeAccount(await this.assertInitiatingPrincipal(context, input.organizationId, value.providerOperationId), account.accountId);
    let created: Readonly<{ providerTransactionId: string; clientSecret: string }>;
    try {
      created = await this.provider.createPaymentIntent({ amountCents: value.amount.cents, currency: value.amount.currency, organizationId: input.organizationId, providerOperationId: value.providerOperationId, providerIdempotencyKey: value.providerIdempotencyKey, stripeAccountId: account.accountId, description: `PrintersHero payment ${value.providerOperationId}` });
    } catch (cause) {
      if (stripeRejectedBeforeCreation(cause)) {
        const failed = await this.transitionProviderIntent(context, { organizationId: brandedId<"OrganizationId">(input.organizationId), providerOperationId: value.providerOperationId, providerTransactionId: null, stripeAccountId: account.accountId, state: "failed", allocations: operation.value.allocations });
        if (failed.reconciliationState === "succeeded") throw new V2ApplicationError("CONFLICT", "This card Payment was already confirmed in Billing; refresh the Invoice.");
        throw new V2ApplicationError("VALIDATION_ERROR", "Stripe rejected this card payment before it was created. The provider operation is terminally failed; a new request is required.");
      }
      throw cause;
    }
    const paymentIntent = await this.recoverClientSecret(context, input.organizationId, value.providerOperationId, created.providerTransactionId, account.accountId, operation.value.allocations);
    return { ok: true as const, value: { providerOperationId: value.providerOperationId, paymentIntentId: created.providerTransactionId, clientSecret: paymentIntent.clientSecret, stripeAccountId: account.accountId, amountCents: value.amount.cents, currency: value.amount.currency, allocations: operation.value.allocations } };
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
    const existing = await this.assertInitiatingPrincipal(context, input.organizationId, operation.value.providerOperationId);
    this.assertStripeAccount(existing, payment.stripe_account_id);
    if (existing.provider_transaction_id) return { ok: true as const, value: { providerOperationId: operation.value.providerOperationId, refundId: existing.provider_transaction_id, confirmed: existing.reconciliation_state === "succeeded" } };
    this.assertStripeAccount(await this.assertInitiatingPrincipal(context, input.organizationId, operation.value.providerOperationId), payment.stripe_account_id);
    const created = await this.provider.createRefund({ paymentIntentId: payment.provider_transaction_id, amountCents: input.amountCents, currency:input.currency, organizationId: input.organizationId, invoiceId: input.invoiceId, paymentId: input.paymentId, providerOperationId: operation.value.providerOperationId, providerIdempotencyKey: operation.value.providerIdempotencyKey, stripeAccountId:payment.stripe_account_id });
    const binding = await this.payments.bindProviderRefund(context, { organizationId: brandedId<"OrganizationId">(input.organizationId), providerOperationId: operation.value.providerOperationId, providerTransactionId: created.providerTransactionId, stripeAccountId: payment.stripe_account_id, paymentId: brandedId<"PaymentId">(input.paymentId), invoiceId: brandedId<"InvoiceId">(input.invoiceId), amountCents: input.amountCents, currency: input.currency });
    if (!binding.ok) throw binding.error;
    if (binding.value.providerTransactionId !== created.providerTransactionId) throw new V2ApplicationError("CONFLICT", "Stripe returned a Refund that does not match the Billing operation.");
    const owner = await this.assertInitiatingPrincipal(context, input.organizationId, operation.value.providerOperationId);
    this.assertStripeAccount(owner, payment.stripe_account_id);
    return { ok: true as const, value: { providerOperationId: operation.value.providerOperationId, refundId: created.providerTransactionId, confirmed: binding.value.reconciliationState === "succeeded" } };
  }

  private async transitionProviderIntent(context: OperationContext, input: TransitionProviderPaymentIntentInput): Promise<ProviderFinancialOperation> {
    const result = await this.payments.transitionProviderPaymentIntent(context, input);
    if (!result.ok) throw result.error;
    return result.value;
  }
  private async recoverClientSecret(context: OperationContext, organizationId: string, providerOperationId: ProviderFinancialOperation["providerOperationId"], providerTransactionId: string, stripeAccountId: string, allocations: TransitionProviderPaymentIntentInput["allocations"]): Promise<Readonly<{ clientSecret: string }>> {
    const binding = { organizationId: brandedId<"OrganizationId">(organizationId), providerOperationId, providerTransactionId, stripeAccountId, state: "pending" as const, allocations };
    const attached = await this.transitionProviderIntent(context, binding);
    this.assertPaymentIntentMayBeResumed(attached);
    if (attached.providerTransactionId !== providerTransactionId) throw new V2ApplicationError("CONFLICT", "Stripe PaymentIntent does not match the Billing-owned operation.");
    const beforeRetrieve = await this.assertInitiatingPrincipal(context, organizationId, providerOperationId);
    this.assertStripeAccount(beforeRetrieve, stripeAccountId);
    this.assertPaymentIntentMayBeResumed(beforeRetrieve);
    let paymentIntent: Readonly<{ clientSecret: string }>;
    try { paymentIntent = await this.provider.retrievePaymentIntent(providerTransactionId, stripeAccountId); }
    catch (error) {
      if (error instanceof V2ApplicationError && error.code === "CONFLICT" && error.message.includes("prior Stripe payment attempt did not complete")) {
        const failed = await this.transitionProviderIntent(context, { ...binding, state: "failed" });
        if (failed.reconciliationState === "succeeded") throw new V2ApplicationError("CONFLICT", "This card Payment was already confirmed in Billing; refresh the Invoice.");
        throw new V2ApplicationError("CONFLICT", "The Stripe PaymentIntent was canceled and its Invoice reservation was released; start a new Payment request.");
      }
      throw error;
    }
    const reauthorized = await this.transitionProviderIntent(context, binding);
    this.assertPaymentIntentMayBeResumed(reauthorized);
    if (reauthorized.providerTransactionId !== providerTransactionId) throw new V2ApplicationError("CONFLICT", "Stripe PaymentIntent does not match the Billing-owned operation.");
    const current = await this.assertInitiatingPrincipal(context, organizationId, providerOperationId);
    this.assertStripeAccount(current, stripeAccountId);
    this.assertPaymentIntentMayBeResumed(current);
    return paymentIntent;
  }
  private async operation(organizationId: string, providerOperationId: string): Promise<OperationRow | null> { const result = await this.pool.query<OperationRow>("SELECT operation.provider_transaction_id,operation.stripe_account_id,operation.amount_cents,operation.currency,operation.reconciliation_state,request.initiated_principal_kind,request.initiated_principal_subject FROM v2_billing_provider_financial_operations operation JOIN v2_operation_requests request ON request.organization_id=operation.organization_id AND request.id=operation.operation_request_id WHERE operation.organization_id=$1 AND operation.id=$2", [organizationId, providerOperationId]); return result.rows[0] ?? null; }
  private async operationRequestExists(organizationId: string, operation: string, businessRequestId: string): Promise<boolean> { const result = await this.pool.query<{ id: string }>("SELECT id FROM v2_operation_requests WHERE organization_id=$1 AND operation=$2 AND business_request_id=$3", [organizationId, operation, businessRequestId]); return result.rows.length > 0; }
  private async assertInitiatingPrincipal(context: OperationContext, organizationId: string, providerOperationId: string): Promise<OperationRow> {
    const operation = await this.operation(organizationId, providerOperationId);
    if (!operation) throw new V2ApplicationError("CONFLICT", "Card operation ownership evidence is unavailable.");
    if (operation.initiated_principal_kind !== context.principal.kind || operation.initiated_principal_subject !== principalSubject(context.principal))
      throw new V2ApplicationError("FORBIDDEN", "Only the initiating principal may resume this card operation.");
    return operation;
  }
  private assertStripeAccount(operation: OperationRow, stripeAccountId: string | null | undefined): string {
    if (!stripeAccountId || operation.stripe_account_id !== stripeAccountId)
      throw new V2ApplicationError("CONFLICT", "Provider operation account does not match the currently authorized Stripe account.");
    return stripeAccountId;
  }
  private assertPaymentIntentMayBeResumed(operation: OperationRow | ProviderFinancialOperation): void {
    const state = "reconciliation_state" in operation ? operation.reconciliation_state : operation.reconciliationState;
    if (state === "succeeded") throw new V2ApplicationError("CONFLICT", "This card Payment is already confirmed in Billing; refresh the Invoice.");
    if (state === "failed") throw new V2ApplicationError("CONFLICT", "This card Payment operation is terminally failed; start a new Payment request.");
  }
}
