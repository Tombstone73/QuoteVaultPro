import { createHash, randomUUID } from "node:crypto";
import type { OperationContext } from "../../application/operation.js";
import { requireOperationPrincipalScope } from "../../application/operation.js";
import { AuthorityPolicy } from "../../authorization/authorityPolicy.js";
import { principalSubject, staffActorId } from "../../authorization/principals.js";
import { failure, success, type ApplicationResult, V2ApplicationError } from "../../errors/applicationError.js";
import { brandedId, canonicalJson, money, type InvoiceId, type OrganizationId, type PaymentId, type ProviderFinancialOperationId } from "../shared/commercialValues.js";
import type { OrderAutomaticLifecycle } from "../sales/orderAutomaticLifecycle.js";
import type { BeginProviderFinancialOperationInput, BeginProviderPaymentAggregateInput, ConfirmProviderPaymentAggregateInput, ConfirmProviderPaymentInput, ConfirmProviderRefundInput, InvoiceSettlement, PaymentAggregateFact, PaymentAllocationFact, PaymentAllocationInput, PaymentFact, ProviderFinancialOperation, ProviderPaymentAggregateConfirmation, ProviderPaymentAggregateOperation, RecordManualPaymentAllocationsInput, RecordManualPaymentInput, RecordRefundAllocationsInput, RecordRefundInput, RefundAggregateFact, RefundAllocationFact, RefundAllocationInput, RefundFact } from "./contracts.js";

type Actor = Readonly<{ principalKind: OperationContext["principal"]["kind"]; principalSubject: string; staffActorUserId?: string }>;
type Reservation = Readonly<{ kind: "new" | "resumed" | "replay"; request: Readonly<{ id: string; resultJson: unknown | null }> }>;
export type FinancialLockedInvoice = Readonly<{ invoiceId: InvoiceId; customerId?: string; currency: string; totalCents: number; lifecycle: "draft" | "issued" | "void" }>;
/** A locked, server-derived payment allocation that can safely be reversed. */
export type FinancialLockedRefundAllocation = Readonly<{
  paymentAllocationId: string;
  paymentId: PaymentId;
  invoice: FinancialLockedInvoice;
  allocatedCents: number;
  alreadyRefundedCents: number;
  remainingRefundableCents: number;
}>;
export type ProviderPaymentConfirmation = Readonly<{ payment: PaymentFact; materialized: boolean }>;
export type ProviderRefundConfirmation = Readonly<{ refund: RefundFact; materialized: boolean }>;
export interface BillingFinancialTransaction {
  reserve(input: Readonly<{ organizationId: string; operation: string; businessRequestId: string; payloadFingerprint: string }> & Actor): Promise<Reservation>;
  lockInvoice(organizationId: OrganizationId, invoiceId: InvoiceId): Promise<FinancialLockedInvoice | null>;
  /** Locks all supplied Invoices in deterministic order for one Payment aggregate. */
  lockInvoices?(organizationId: OrganizationId, invoiceIds: readonly InvoiceId[]): Promise<readonly FinancialLockedInvoice[]>;
  settlement(organizationId: OrganizationId, invoiceId: InvoiceId, currency: string, grossCents: number): Promise<InvoiceSettlement>;
  /** Pending provider operations reserve their durable allocation intent so a
   * second checkout cannot spend the same mutable Invoice balance. */
  pendingProviderPaymentCents?(organizationId: OrganizationId, invoiceId: InvoiceId): Promise<number>;
  recordPayment(input: Readonly<{ organizationId: OrganizationId; invoiceId: InvoiceId; amountCents: number; currency: string; method: string; occurredAt: string; operationRequestId: string }> & Actor): Promise<PaymentFact>;
  /** One immutable Payment plus one-or-many immutable Invoice allocations. */
  recordPaymentAggregate?(input: Readonly<{ organizationId: OrganizationId; allocations: readonly PaymentAllocationFact[]; currency: string; method: string; occurredAt: string; operationRequestId: string }> & Actor): Promise<PaymentAggregateFact>;
  recordRefund(input: Readonly<{ organizationId: OrganizationId; invoiceId: InvoiceId; paymentId: PaymentId; amountCents: number; currency: string; occurredAt: string; operationRequestId: string }> & Actor): Promise<RefundFact>;
  /** Locks allocation facts and their Invoice rows in deterministic order. */
  lockRefundAllocations?(input: Readonly<{ organizationId: OrganizationId; paymentId: PaymentId; paymentAllocationIds: readonly string[] }>): Promise<readonly FinancialLockedRefundAllocation[]>;
  /** One Refund may reverse several allocations of its original Payment. */
  recordRefundAggregate?(input: Readonly<{ organizationId: OrganizationId; paymentId: PaymentId; allocations: readonly RefundAllocationFact[]; currency: string; occurredAt: string; operationRequestId: string }> & Actor): Promise<RefundAggregateFact>;
  beginProvider(input: Readonly<{ organizationId: OrganizationId; invoiceId: InvoiceId; kind: "payment" | "refund"; paymentId?: PaymentId; amountCents: number; currency: string; provider: string; providerIdempotencyKey: string; providerAccountId?: string; operationRequestId: string }>): Promise<ProviderFinancialOperation>;
  beginProviderPaymentAggregate?(input: Readonly<{ organizationId: OrganizationId; allocations: readonly PaymentAllocationFact[]; currency: string; provider: string; providerIdempotencyKey: string; providerAccountId?: string; operationRequestId: string }>): Promise<ProviderPaymentAggregateOperation>;
  loadProviderPaymentAggregate?(input: Readonly<{ organizationId: OrganizationId; providerOperationId: ProviderFinancialOperationId }>): Promise<ProviderPaymentAggregateOperation | null>;
  confirmProviderPaymentAggregate?(input: Readonly<{ organizationId: OrganizationId; providerOperationId: ProviderFinancialOperationId; providerEventId: string; providerTransactionId: string; occurredAt: string; operationRequestId: string }> & Actor): Promise<ProviderPaymentAggregateConfirmation>;
  confirmProviderPayment(input: Readonly<{ organizationId: OrganizationId; invoiceId: InvoiceId; providerOperationId: ProviderFinancialOperationId; providerEventId: string; providerTransactionId: string; occurredAt: string; operationRequestId: string }> & Actor): Promise<ProviderPaymentConfirmation>;
  confirmProviderRefund(input: Readonly<{ organizationId: OrganizationId; invoiceId: InvoiceId; paymentId: PaymentId; providerOperationId: ProviderFinancialOperationId; providerEventId: string; providerTransactionId: string; occurredAt: string; operationRequestId: string }> & Actor): Promise<ProviderRefundConfirmation>;
  attribute(input: Readonly<{ organizationId: string; operationRequestId: string; operation: string; resourceType: string; resourceId: string }> & Actor): Promise<void>;
  audit(input: Readonly<{ organizationId: string; operationRequestId: string; operation: string; eventType: string; resourceType: string; resourceId: string; changes: unknown }> & Actor): Promise<void>;
  enqueue(input: Readonly<{ organizationId: string; eventType: string; aggregateType: string; aggregateId: string; idempotencyKey: string; payload: unknown }>): Promise<void>;
  succeed(organizationId: string, requestId: string, resourceType: string, resourceId: string, result: unknown): Promise<void>;
}
export interface BillingFinancialTransactionRunner { transaction<T>(action: (transaction: BillingFinancialTransaction) => Promise<T>): Promise<T>; }
const actor = (context: OperationContext): Actor => ({ principalKind: context.principal.kind, principalSubject: principalSubject(context.principal), ...(staffActorId(context.principal) ? { staffActorUserId: staffActorId(context.principal) } : {}) });
const fingerprint = (value: unknown) => `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
const assertMoney = (amount: { cents: number; currency: string }) => { if (!Number.isSafeInteger(amount.cents) || amount.cents <= 0) throw new V2ApplicationError("VALIDATION_ERROR", "Financial amounts must be positive exact integer cents."); };

/** Billing financial facts are append-only; provider uncertainty is a recovery record, not a payment. */
export class BillingPaymentsApplicationService {
  constructor(private readonly runner: BillingFinancialTransactionRunner, private readonly authority = new AuthorityPolicy(), private readonly orderLifecycle?: OrderAutomaticLifecycle) {}
  async recordManualPayment(context: OperationContext, input: RecordManualPaymentInput): Promise<ApplicationResult<Readonly<{ payment: PaymentFact; settlement: InvoiceSettlement }>>>
  { return this.withSettlementReconciliation(input, this.withInvoice(context, input, "billing.payment.record.v1", "payment.record", async (tx, invoice, requestId) => { this.assertFinanciallyActive(invoice, input.amount); const before = await tx.settlement(input.organizationId, input.invoiceId, invoice.currency, invoice.totalCents); if (input.amount.cents > before.collectibleBalance.cents) throw new V2ApplicationError("CONFLICT", "Payment exceeds the collectible Invoice balance."); const payment = await tx.recordPayment({ organizationId: input.organizationId, invoiceId: input.invoiceId, amountCents: input.amount.cents, currency: input.amount.currency, method: input.method, occurredAt: input.occurredAt, operationRequestId: requestId, ...actor(context) }); const settlement = await tx.settlement(input.organizationId, input.invoiceId, invoice.currency, invoice.totalCents); await this.finish(tx, context, requestId, "billing.payment.record.v1", "payment_recorded", "payment", payment.paymentId, { invoiceId: input.invoiceId, amountCents: input.amount.cents, source: "manual" }, { payment, settlement }); return { payment, settlement }; })); }
  /**
   * Records one actual tender across one or more invoices. The aggregate is
   * intentionally separate from the legacy one-invoice API so callers cannot
   * accidentally turn a multi-invoice checkout into several Payments.
   */
  async recordManualPaymentAllocations(context: OperationContext, input: RecordManualPaymentAllocationsInput): Promise<ApplicationResult<Readonly<{ payment: PaymentAggregateFact; settlements: readonly InvoiceSettlement[] }>>> {
    try {
      const allocations = this.normalizeAllocations(input.allocations);
      const result = await this.withInvoices(context, { ...input, allocations }, "billing.payment.aggregate.record.v1", "payment.record", async (tx, invoices, requestId) => {
        const recorder = tx.recordPaymentAggregate;
        if (!recorder) throw new V2ApplicationError("CONFLICT", "This billing persistence runtime does not support payment allocation aggregates.");
        const byInvoice = new Map(invoices.map((invoice) => [invoice.invoiceId, invoice]));
        for (const allocation of allocations) {
          const invoice = byInvoice.get(allocation.invoiceId)!;
          this.assertFinanciallyActive(invoice, allocation.amount);
          const before = await tx.settlement(input.organizationId, allocation.invoiceId, invoice.currency, invoice.totalCents);
          if (allocation.amount.cents > before.collectibleBalance.cents) throw new V2ApplicationError("CONFLICT", "Payment allocation exceeds the collectible Invoice balance.");
        }
        const currency = invoices[0]!.currency;
        const payment = await recorder({ organizationId: input.organizationId, allocations, currency, method: input.method, occurredAt: input.occurredAt, operationRequestId: requestId, ...actor(context) });
        const settlements = await Promise.all(allocations.map(async (allocation) => {
          const invoice = byInvoice.get(allocation.invoiceId)!;
          return tx.settlement(input.organizationId, allocation.invoiceId, invoice.currency, invoice.totalCents);
        }));
        await this.finish(tx, context, requestId, "billing.payment.aggregate.record.v1", "payment_aggregate_recorded", "payment", payment.payment.paymentId, { source: "manual", allocationCount: allocations.length, allocations: allocations.map((allocation) => ({ invoiceId: allocation.invoiceId, amountCents: allocation.amount.cents })) }, { payment, settlements });
        return { payment, settlements };
      });
      if (result.ok) await Promise.all(result.value.payment.allocations.map((allocation: PaymentAllocationFact) => this.orderLifecycle?.reconcileInvoice(input.organizationId, allocation.invoiceId)));
      return result;
    } catch (error) {
      return failure(error instanceof V2ApplicationError ? error : new V2ApplicationError("CONFLICT", "Financial operation conflicts with the immutable ledger."));
    }
  }
  /** Reserves one provider operation whose durable allocation intent totals one PaymentIntent. */
  async beginProviderPaymentAggregate(context: OperationContext, input: BeginProviderPaymentAggregateInput): Promise<ApplicationResult<ProviderPaymentAggregateOperation>> {
    try {
      const allocations = this.normalizeAllocations(input.allocations);
      return await this.withInvoices(context, { ...input, allocations }, "billing.provider.payment.aggregate.begin.v1", "payment.record", async (tx, invoices, requestId) => {
        const begin = tx.beginProviderPaymentAggregate;
        if (!begin) throw new V2ApplicationError("CONFLICT", "This billing persistence runtime does not support provider payment aggregates.");
        const byInvoice = new Map(invoices.map((invoice) => [invoice.invoiceId, invoice]));
        for (const allocation of allocations) {
          const invoice = byInvoice.get(allocation.invoiceId)!;
          this.assertFinanciallyActive(invoice, allocation.amount);
          const settlement = await tx.settlement(input.organizationId, allocation.invoiceId, invoice.currency, invoice.totalCents);
          const reserved = tx.pendingProviderPaymentCents ? await tx.pendingProviderPaymentCents(input.organizationId, allocation.invoiceId) : 0;
          if (allocation.amount.cents > settlement.collectibleBalance.cents - reserved) throw new V2ApplicationError("CONFLICT", "Payment allocation exceeds the current available Invoice balance.");
        }
        const operation = await begin({ organizationId: input.organizationId, allocations, currency: invoices[0]!.currency, provider: input.provider, providerIdempotencyKey: input.providerIdempotencyKey, ...(input.providerAccountId ? { providerAccountId: input.providerAccountId } : {}), operationRequestId: requestId });
        await this.finish(tx, context, requestId, "billing.provider.payment.aggregate.begin.v1", "provider_payment_aggregate_reconciliation_required", "provider_financial_operation", operation.operation.providerOperationId, { provider: input.provider, allocationCount: allocations.length, amountCents: operation.operation.amount.cents }, operation);
        return operation;
      });
    } catch (error) {
      return failure(error instanceof V2ApplicationError ? error : new V2ApplicationError("CONFLICT", "Financial operation conflicts with the immutable ledger."));
    }
  }
  /** Materializes one provider-settled Payment and all of its previously durable allocations atomically. */
  async confirmProviderPaymentAggregate(context: OperationContext, input: ConfirmProviderPaymentAggregateInput): Promise<ApplicationResult<PaymentAggregateFact>> {
    try {
      requireOperationPrincipalScope(context);
      if (!context.businessRequest || context.businessRequest.id !== input.businessRequestId) throw new V2ApplicationError("VALIDATION_ERROR", "A matching business request identity is required.");
      const preview = await this.runner.transaction(async (tx) => {
        const loader = tx.loadProviderPaymentAggregate;
        return loader ? loader({ organizationId: input.organizationId, providerOperationId: input.providerOperationId }) : null;
      });
      if (!preview) throw new V2ApplicationError("NOT_FOUND", "Provider Payment aggregate operation was not found.");
      const result = await this.withInvoices(context, { ...input, allocations: preview.allocations }, "billing.provider.payment.aggregate.confirm.v1", "payment.record", async (tx, _invoices, requestId) => {
        const confirm = tx.confirmProviderPaymentAggregate;
        if (!confirm) throw new V2ApplicationError("CONFLICT", "This billing persistence runtime does not support provider payment aggregates.");
        const confirmation = await confirm({ organizationId: input.organizationId, providerOperationId: input.providerOperationId, providerEventId: input.providerEventId, providerTransactionId: input.providerTransactionId, occurredAt: input.occurredAt, operationRequestId: requestId, ...actor(context) });
        if (confirmation.materialized) await this.finish(tx, context, requestId, "billing.provider.payment.aggregate.confirm.v1", "provider_payment_aggregate_succeeded", "payment", confirmation.payment.payment.paymentId, { providerOperationId: input.providerOperationId, allocationCount: confirmation.payment.allocations.length }, confirmation.payment);
        else await tx.succeed(input.organizationId, requestId, "payment", confirmation.payment.payment.paymentId, confirmation.payment);
        return confirmation.payment;
      });
      if (result.ok) await Promise.all(result.value.allocations.map((allocation: PaymentAllocationFact) => this.orderLifecycle?.reconcileInvoice(input.organizationId, allocation.invoiceId)));
      return result;
    } catch (error) {
      return failure(error instanceof V2ApplicationError ? error : new V2ApplicationError("CONFLICT", "Financial operation conflicts with the immutable ledger."));
    }
  }
  async recordRefund(context: OperationContext, input: RecordRefundInput): Promise<ApplicationResult<Readonly<{ refund: RefundFact; settlement: InvoiceSettlement }>>>
  { return this.withSettlementReconciliation(input, this.withInvoice(context, input, "billing.refund.record.v1", "refund.issue", async (tx, invoice, requestId) => { this.assertFinanciallyActive(invoice, input.amount); const refund = await tx.recordRefund({ organizationId: input.organizationId, invoiceId: input.invoiceId, paymentId: input.paymentId, amountCents: input.amount.cents, currency: input.amount.currency, occurredAt: input.occurredAt, operationRequestId: requestId, ...actor(context) }); const settlement = await tx.settlement(input.organizationId, input.invoiceId, invoice.currency, invoice.totalCents); await this.finish(tx, context, requestId, "billing.refund.record.v1", "refund_recorded", "refund", refund.refundId, { paymentId: input.paymentId, amountCents: input.amount.cents }, { refund, settlement }); return { refund, settlement }; })); }
  /**
   * Reverses one real Payment across one-or-many of its immutable allocations.
   * Invoice identity, currency, and refundable capacity are loaded while the
   * allocation rows are locked; a caller cannot redirect a refund by posting
   * an Invoice id alongside an allocation id.
   */
  async recordRefundAllocations(context: OperationContext, input: RecordRefundAllocationsInput): Promise<ApplicationResult<RefundAggregateFact>> {
    try {
      requireOperationPrincipalScope(context);
      if (!context.businessRequest || context.businessRequest.id !== input.businessRequestId) throw new V2ApplicationError("VALIDATION_ERROR", "A matching business request identity is required.");
      const requested = this.normalizeRefundAllocations(input.allocations);
      const result = await this.runner.transaction(async (tx) => {
        const lock = tx.lockRefundAllocations;
        const record = tx.recordRefundAggregate;
        if (!lock || !record) throw new V2ApplicationError("CONFLICT", "This billing persistence runtime does not support allocation-aware refunds.");
        const locked = await lock({ organizationId: input.organizationId, paymentId: input.paymentId, paymentAllocationIds: requested.map((allocation) => allocation.paymentAllocationId) });
        if (locked.length !== requested.length || new Set(locked.map((allocation) => allocation.paymentAllocationId)).size !== requested.length) throw new V2ApplicationError("NOT_FOUND", "One or more Payment allocations were not found.");
        const firstCustomerId = locked[0]?.invoice.customerId;
        const currency = locked[0]?.invoice.currency;
        if (!firstCustomerId || !currency || locked.some((allocation) => allocation.paymentId !== input.paymentId || allocation.invoice.customerId !== firstCustomerId)) throw new V2ApplicationError("CONFLICT", "All Refund allocations must belong to one Customer account.");
        if (locked.some((allocation) => allocation.invoice.currency !== currency || allocation.invoice.lifecycle === "void")) throw new V2ApplicationError("CONFLICT", "A Refund allocation references an inactive or currency-incompatible Invoice.");
        const byId = new Map(locked.map((allocation) => [allocation.paymentAllocationId, allocation]));
        const allocations = requested.map((allocation): RefundAllocationFact => {
          const source = byId.get(allocation.paymentAllocationId);
          if (!source) throw new V2ApplicationError("NOT_FOUND", "Payment allocation was not found.");
          if (allocation.amount.cents > source.remainingRefundableCents) throw new V2ApplicationError("CONFLICT", "Refund exceeds the remaining refundable Payment allocation.");
          const decision = this.authority.decide(context.principal, { capability: "refund.issue", resource: { organizationId: context.organizationId, customerId: source.invoice.customerId } });
          if (!decision.allowed) throw new V2ApplicationError("FORBIDDEN", "The principal is not authorized for this financial operation.");
          return Object.freeze({ paymentAllocationId: source.paymentAllocationId, paymentId: source.paymentId, invoiceId: source.invoice.invoiceId, amount: allocation.amount });
        });
        const reservation = await tx.reserve({ organizationId: input.organizationId, operation: "billing.refund.aggregate.record.v1", businessRequestId: input.businessRequestId, payloadFingerprint: fingerprint(input), ...actor(context) });
        if (reservation.kind === "replay") return reservation.request.resultJson as RefundAggregateFact;
        const refund = await record({ organizationId: input.organizationId, paymentId: input.paymentId, allocations, currency, occurredAt: input.occurredAt, operationRequestId: reservation.request.id, ...actor(context) });
        await this.finish(tx, context, reservation.request.id, "billing.refund.aggregate.record.v1", "refund_aggregate_recorded", "refund", refund.refund.refundId, { paymentId: input.paymentId, allocationCount: refund.allocations.length, amountCents: refund.refund.amount.cents }, refund);
        return refund;
      });
      await Promise.all(result.allocations.map((allocation) => this.orderLifecycle?.reconcileInvoice(input.organizationId, allocation.invoiceId)));
      return success(result);
    } catch (error) {
      return failure(error instanceof V2ApplicationError ? error : new V2ApplicationError("CONFLICT", "Financial operation conflicts with the immutable ledger."));
    }
  }
  async beginProviderOperation(context: OperationContext, input: BeginProviderFinancialOperationInput): Promise<ApplicationResult<ProviderFinancialOperation>>
  { return this.withInvoice(context, input, `billing.provider.${input.kind}.begin.v1`, input.kind === "payment" ? "payment.record" : "refund.issue", async (tx, invoice, requestId) => { this.assertFinanciallyActive(invoice, input.amount); if (input.kind === "payment") { const settlement = await tx.settlement(input.organizationId, input.invoiceId, invoice.currency, invoice.totalCents); if (input.amount.cents > settlement.collectibleBalance.cents) throw new V2ApplicationError("CONFLICT", "Payment exceeds the collectible Invoice balance."); } const operation = await tx.beginProvider({ organizationId: input.organizationId, invoiceId: input.invoiceId, kind: input.kind, ...(input.paymentId ? { paymentId: input.paymentId } : {}), amountCents: input.amount.cents, currency: input.amount.currency, provider: input.provider, providerIdempotencyKey: input.providerIdempotencyKey, ...(input.providerAccountId ? { providerAccountId: input.providerAccountId } : {}), operationRequestId: requestId }); await tx.attribute({ organizationId: input.organizationId, operationRequestId: requestId, operation: `billing.provider.${input.kind}.begin.v1`, resourceType: "provider_financial_operation", resourceId: operation.providerOperationId, ...actor(context) }); await tx.audit({ organizationId: input.organizationId, operationRequestId: requestId, operation: `billing.provider.${input.kind}.begin.v1`, eventType: "provider_financial_reconciliation_required", resourceType: "provider_financial_operation", resourceId: operation.providerOperationId, changes: [{ kind: input.kind, provider: input.provider, reconciliationState: "pending" }], ...actor(context) }); await tx.succeed(input.organizationId, requestId, "provider_financial_operation", operation.providerOperationId, operation); return operation; }); }
  async confirmProviderPayment(context: OperationContext, input: ConfirmProviderPaymentInput): Promise<ApplicationResult<PaymentFact>> { return this.withSettlementReconciliation(input, this.withInvoice(context, input, "billing.provider.payment.confirm.v1", "payment.record", async (tx, invoice, requestId) => { const confirmation = await tx.confirmProviderPayment({ organizationId: input.organizationId, invoiceId: input.invoiceId, providerOperationId: input.providerOperationId, providerEventId: input.providerEventId, providerTransactionId: input.providerTransactionId, occurredAt: input.occurredAt, operationRequestId: requestId, ...actor(context) }); if (confirmation.materialized) await this.finish(tx, context, requestId, "billing.provider.payment.confirm.v1", "provider_payment_succeeded", "payment", confirmation.payment.paymentId, { providerOperationId: input.providerOperationId }, confirmation.payment); else await tx.succeed(context.organizationId, requestId, "payment", confirmation.payment.paymentId, confirmation.payment); return confirmation.payment; })); }
  async confirmProviderRefund(context: OperationContext, input: ConfirmProviderRefundInput): Promise<ApplicationResult<RefundFact>> { return this.withSettlementReconciliation(input, this.withInvoice(context, input, "billing.provider.refund.confirm.v1", "refund.issue", async (tx, invoice, requestId) => { const confirmation = await tx.confirmProviderRefund({ organizationId: input.organizationId, invoiceId: input.invoiceId, paymentId: input.paymentId, providerOperationId: input.providerOperationId, providerEventId: input.providerEventId, providerTransactionId: input.providerTransactionId, occurredAt: input.occurredAt, operationRequestId: requestId, ...actor(context) }); if (confirmation.materialized) await this.finish(tx, context, requestId, "billing.provider.refund.confirm.v1", "provider_refund_succeeded", "refund", confirmation.refund.refundId, { providerOperationId: input.providerOperationId, paymentId: input.paymentId }, confirmation.refund); else await tx.succeed(context.organizationId, requestId, "refund", confirmation.refund.refundId, confirmation.refund); return confirmation.refund; })); }
  /** The mutable Order-backed Invoice is payable before any external accounting
   * posting. "issued" remains a compatibility/checkpoint lifecycle; it is not
   * the authority for whether V2 may record a financial fact. */
  private assertFinanciallyActive(invoice: FinancialLockedInvoice, amount: { currency: string; cents: number }) { assertMoney(amount); if (invoice.lifecycle === "void") throw new V2ApplicationError("CONFLICT", "A void Invoice may not accept financial transactions."); if (invoice.currency !== amount.currency) throw new V2ApplicationError("VALIDATION_ERROR", "Financial transaction currency must equal the Invoice currency."); }
  private async withInvoice<T extends { businessRequestId: string; organizationId: OrganizationId; invoiceId: InvoiceId }>(context: OperationContext, input: T, operation: string, capability: "payment.record" | "refund.issue", action: (tx: BillingFinancialTransaction, invoice: FinancialLockedInvoice, requestId: string) => Promise<unknown>): Promise<ApplicationResult<any>> {
    try {
      requireOperationPrincipalScope(context);
      if (!context.businessRequest || context.businessRequest.id !== input.businessRequestId) throw new V2ApplicationError("VALIDATION_ERROR", "A matching business request identity is required.");
      const result = await this.runner.transaction(async (tx) => {
        const locked = await tx.lockInvoice(input.organizationId, input.invoiceId);
        if (!locked) throw new V2ApplicationError("NOT_FOUND", "Invoice was not found.");
        const decision = this.authority.decide(context.principal, { capability, resource: { organizationId: context.organizationId, customerId: locked.customerId } });
        if (!decision.allowed) throw new V2ApplicationError("FORBIDDEN", "The principal is not authorized for this financial operation.");
        const reservation = await tx.reserve({ organizationId: input.organizationId, operation, businessRequestId: input.businessRequestId, payloadFingerprint: fingerprint(input), ...actor(context) });
        if (reservation.kind === "replay") return reservation.request.resultJson;
        return action(tx, locked, reservation.request.id);
      });
      return success(result);
    } catch (error) {
      return failure(error instanceof V2ApplicationError ? error : new V2ApplicationError("CONFLICT", "Financial operation conflicts with the immutable ledger."));
    }
  }
  private normalizeAllocations(input: readonly PaymentAllocationInput[]): readonly PaymentAllocationFact[] {
    if (!Array.isArray(input) || input.length === 0 || input.length > 25) throw new V2ApplicationError("VALIDATION_ERROR", "A Payment must contain between one and 25 Invoice allocations.");
    const seen = new Set<string>();
    const allocations = input.map((allocation) => {
      if (!allocation?.invoiceId || seen.has(allocation.invoiceId)) throw new V2ApplicationError("VALIDATION_ERROR", "A Payment may allocate to an Invoice only once.");
      seen.add(allocation.invoiceId);
      assertMoney(allocation.amount);
      return Object.freeze({ invoiceId: allocation.invoiceId, amount: allocation.amount });
    });
    return Object.freeze(allocations.sort((left, right) => left.invoiceId.localeCompare(right.invoiceId)));
  }
  private normalizeRefundAllocations(input: readonly RefundAllocationInput[]): readonly RefundAllocationInput[] {
    if (!Array.isArray(input) || input.length === 0 || input.length > 25) throw new V2ApplicationError("VALIDATION_ERROR", "A Refund must contain between one and 25 Payment allocations.");
    const seen = new Set<string>();
    const allocations = input.map((allocation) => {
      if (!allocation?.paymentAllocationId || seen.has(allocation.paymentAllocationId)) throw new V2ApplicationError("VALIDATION_ERROR", "A Refund may reverse a Payment allocation only once.");
      seen.add(allocation.paymentAllocationId);
      assertMoney(allocation.amount);
      return Object.freeze({ paymentAllocationId: allocation.paymentAllocationId, amount: allocation.amount });
    });
    return Object.freeze(allocations.sort((left, right) => left.paymentAllocationId.localeCompare(right.paymentAllocationId)));
  }
  private async withInvoices<T extends { businessRequestId: string; organizationId: OrganizationId; allocations: readonly PaymentAllocationFact[] }>(context: OperationContext, input: T, operation: string, capability: "payment.record", action: (tx: BillingFinancialTransaction, invoices: readonly FinancialLockedInvoice[], requestId: string) => Promise<any>): Promise<ApplicationResult<any>> {
    try {
      requireOperationPrincipalScope(context);
      if (!context.businessRequest || context.businessRequest.id !== input.businessRequestId) throw new V2ApplicationError("VALIDATION_ERROR", "A matching business request identity is required.");
      return await this.runner.transaction(async (tx) => {
        const ids = input.allocations.map((allocation) => allocation.invoiceId);
        const locked = tx.lockInvoices ? await tx.lockInvoices(input.organizationId, ids) : await Promise.all(ids.map((invoiceId) => tx.lockInvoice(input.organizationId, invoiceId))).then((invoices) => invoices.filter((invoice): invoice is FinancialLockedInvoice => invoice !== null));
        if (locked.length !== ids.length || new Set(locked.map((invoice) => invoice.invoiceId)).size !== ids.length) throw new V2ApplicationError("NOT_FOUND", "One or more Invoices were not found.");
        const firstCustomerId = locked[0]!.customerId;
        if (!firstCustomerId || locked.some((invoice) => invoice.customerId !== firstCustomerId)) throw new V2ApplicationError("CONFLICT", "All Payment allocations must belong to one Customer account.");
        const currency = locked[0]!.currency;
        if (locked.some((invoice) => invoice.currency !== currency)) throw new V2ApplicationError("VALIDATION_ERROR", "All Payment allocations must use one currency.");
        for (const invoice of locked) {
          const decision = this.authority.decide(context.principal, { capability, resource: { organizationId: context.organizationId, customerId: invoice.customerId } });
          if (!decision.allowed) throw new V2ApplicationError("FORBIDDEN", "The principal is not authorized for this financial operation.");
        }
        const reservation = await tx.reserve({ organizationId: input.organizationId, operation, businessRequestId: input.businessRequestId, payloadFingerprint: fingerprint(input), ...actor(context) });
        if (reservation.kind === "replay") return reservation.request.resultJson;
        return action(tx, locked, reservation.request.id);
      });
    } catch (error) {
      return failure(error instanceof V2ApplicationError ? error : new V2ApplicationError("CONFLICT", "Financial operation conflicts with the immutable ledger."));
    }
  }
  private async withSettlementReconciliation<T extends { organizationId: OrganizationId; invoiceId: InvoiceId }>(input: T, operation: Promise<ApplicationResult<any>>): Promise<ApplicationResult<any>> {
    const result = await operation;
    if (result.ok) await this.orderLifecycle?.reconcileInvoice(input.organizationId, input.invoiceId);
    return result;
  }
  private async finish(tx: BillingFinancialTransaction, context: OperationContext, requestId: string, operation: string, eventType: string, resourceType: string, resourceId: string, changes: unknown, result: unknown) { await tx.attribute({ organizationId: context.organizationId, operationRequestId: requestId, operation, resourceType, resourceId, ...actor(context) }); await tx.audit({ organizationId: context.organizationId, operationRequestId: requestId, operation, eventType, resourceType, resourceId, changes, ...actor(context) }); await tx.enqueue({ organizationId: context.organizationId, eventType: `billing.${eventType}.v1`, aggregateType: resourceType, aggregateId: resourceId, idempotencyKey: requestId, payload: { resourceId } }); await tx.succeed(context.organizationId, requestId, resourceType, resourceId, result); }
}
