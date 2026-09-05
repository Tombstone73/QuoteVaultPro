import { describe, expect, test } from "@jest/globals";
import type { OperationContext } from "../../src/application/operation";
import { V2ApplicationError } from "../../src/errors/applicationError";
import type { BillingFinancialTransaction, ProviderPaymentConfirmation, ProviderRefundConfirmation } from "../../src/modules/billing/paymentApplication";
import { BillingPaymentsApplicationService } from "../../src/modules/billing/paymentApplication";
import type { InvoiceSettlement, PaymentFact, ProviderFinancialOperation, RefundFact } from "../../src/modules/billing/contracts";
import { brandedId, currencyCode, money, type InvoiceId, type OrganizationId, type PaymentId, type ProviderFinancialOperationId } from "../../src/modules/shared/commercialValues";
import { compareParity, requireParity } from "./harness";

const organizationId = brandedId<"OrganizationId">("m5-financial-org");
const otherOrganizationId = brandedId<"OrganizationId">("m5-financial-other-org");
const invoiceId = brandedId<"InvoiceId">("m5-financial-invoice");
const usd = currencyCode("USD");
const financialCapabilities = ["payment.record", "refund.issue"] as const;
const principal = { kind: "staff" as const, organizationId, userId: "billing-alex", authority: { membershipId: "billing-membership", capabilities: financialCapabilities } };
const context = (request: string, override: Partial<OperationContext> = {}): OperationContext => ({
  principal,
  organizationId,
  operationId: `m5-financial-${request}`,
  businessRequest: { id: request, payloadFingerprint: `fixture-${request}` },
  ...override,
});

type Reservation = Readonly<{ kind: "new" | "resumed" | "replay"; request: Readonly<{ id: string; resultJson: unknown | null }> }>;

/** Isolated ledger adapter: facts are append-only and settlement is derived from them. */
class FinancialFixture implements BillingFinancialTransaction {
  readonly payments: PaymentFact[] = [];
  readonly refunds: RefundFact[] = [];
  readonly providerOperations = new Map<string, ProviderFinancialOperation>();
  readonly auditEvents: string[] = [];
  readonly outboxEvents: string[] = [];
  totalCents = 100_000;
  lifecycle: "draft" | "issued" | "void" = "issued";
  private readonly reservations = new Map<string, { requestId: string; result: unknown | null }>();
  private requestSequence = 0;

  async reserve(input: Readonly<{ organizationId: string; operation: string; businessRequestId: string }>): Promise<Reservation> {
    const key = `${input.organizationId}|${input.operation}|${input.businessRequestId}`;
    const existing = this.reservations.get(key);
    if (existing) return { kind: existing.result === null ? "resumed" : "replay", request: { id: existing.requestId, resultJson: existing.result } };
    const requestId = `financial-request-${++this.requestSequence}`;
    this.reservations.set(key, { requestId, result: null });
    return { kind: "new", request: { id: requestId, resultJson: null } };
  }

  async lockInvoice(org: OrganizationId, id: InvoiceId) {
    if (org !== organizationId || id !== invoiceId) return null;
    return { invoiceId, customerId: "customer-acme", currency: usd, totalCents: this.totalCents, lifecycle: this.lifecycle };
  }

  async settlement(org: OrganizationId, id: InvoiceId, currency: string, grossCents: number): Promise<InvoiceSettlement> {
    if (org !== organizationId || id !== invoiceId || currency !== usd || grossCents !== this.totalCents) throw new Error("Unexpected financial fixture scope.");
    const successfulPayments = this.payments.reduce((total, payment) => total + payment.amount.cents, 0);
    const successfulRefunds = this.refunds.reduce((total, refund) => total + refund.amount.cents, 0);
    return { invoiceId, gross: money(usd, grossCents), successfulPayments: money(usd, successfulPayments), successfulRefunds: money(usd, successfulRefunds), collectibleBalance: money(usd, grossCents - successfulPayments + successfulRefunds) };
  }

  async recordPayment(input: Readonly<{ invoiceId: InvoiceId; amountCents: number; currency: string; method: string; occurredAt: string }>): Promise<PaymentFact> {
    const payment = Object.freeze({ paymentId: brandedId<"PaymentId">(`payment-${this.payments.length + 1}`), invoiceId: input.invoiceId, amount: money(usd, input.amountCents), method: input.method as PaymentFact["method"], source: "manual" as const, occurredAt: input.occurredAt });
    this.payments.push(payment);
    return payment;
  }

  async recordRefund(input: Readonly<{ invoiceId: InvoiceId; paymentId: PaymentId; amountCents: number; occurredAt: string }>): Promise<RefundFact> {
    const payment = this.payments.find((candidate) => candidate.paymentId === input.paymentId);
    if (!payment) throw new V2ApplicationError("NOT_FOUND", "Payment was not found.");
    const alreadyRefunded = this.refunds.filter((refund) => refund.paymentId === input.paymentId).reduce((total, refund) => total + refund.amount.cents, 0);
    if (alreadyRefunded + input.amountCents > payment.amount.cents) throw new V2ApplicationError("CONFLICT", "Refund exceeds immutable payment allocation.");
    const refund = Object.freeze({ refundId: brandedId<"RefundId">(`refund-${this.refunds.length + 1}`), invoiceId: input.invoiceId, paymentId: input.paymentId, amount: money(usd, input.amountCents), source: "manual" as const, occurredAt: input.occurredAt });
    this.refunds.push(refund);
    return refund;
  }

  async beginProvider(input: Readonly<{ invoiceId: InvoiceId; kind: "payment" | "refund"; paymentId?: PaymentId; amountCents: number; provider: string; providerIdempotencyKey: string }>): Promise<ProviderFinancialOperation> {
    const operation = Object.freeze({ providerOperationId: brandedId<"ProviderFinancialOperationId">(`provider-operation-${this.providerOperations.size + 1}`), invoiceId: input.invoiceId, kind: input.kind, ...(input.paymentId ? { paymentId: input.paymentId } : {}), amount: money(usd, input.amountCents), provider: input.provider, providerIdempotencyKey: input.providerIdempotencyKey, reconciliationState: "uncertain" as const });
    this.providerOperations.set(operation.providerOperationId, operation);
    return operation;
  }

  async confirmProviderPayment(input: Readonly<{ providerOperationId: ProviderFinancialOperationId; providerTransactionId: string; occurredAt: string }>): Promise<ProviderPaymentConfirmation> {
    const operation = this.providerOperations.get(input.providerOperationId);
    if (!operation || operation.kind !== "payment") throw new V2ApplicationError("NOT_FOUND", "Provider payment operation was not found.");
    const existing = this.payments.find((payment) => payment.providerOperationId === input.providerOperationId);
    if (existing) return { payment: existing, materialized: false };
    const payment = Object.freeze({ paymentId: brandedId<"PaymentId">(`provider-payment-${this.payments.length + 1}`), invoiceId, amount: operation.amount, method: "card" as const, source: "provider" as const, providerOperationId: operation.providerOperationId, providerTransactionId: input.providerTransactionId, occurredAt: input.occurredAt });
    this.payments.push(payment);
    this.providerOperations.set(operation.providerOperationId, { ...operation, providerTransactionId: input.providerTransactionId, reconciliationState: "succeeded" });
    return { payment, materialized: true };
  }

  async confirmProviderRefund(input: Readonly<{ paymentId: PaymentId; providerOperationId: ProviderFinancialOperationId; providerTransactionId: string; occurredAt: string }>): Promise<ProviderRefundConfirmation> {
    const operation = this.providerOperations.get(input.providerOperationId);
    if (!operation || operation.kind !== "refund") throw new V2ApplicationError("NOT_FOUND", "Provider refund operation was not found.");
    const existing = this.refunds.find((refund) => refund.providerOperationId === input.providerOperationId);
    if (existing) return { refund: existing, materialized: false };
    const refund = Object.freeze({ refundId: brandedId<"RefundId">(`provider-refund-${this.refunds.length + 1}`), invoiceId, paymentId: input.paymentId, amount: operation.amount, source: "provider" as const, providerOperationId: operation.providerOperationId, providerTransactionId: input.providerTransactionId, occurredAt: input.occurredAt });
    this.refunds.push(refund);
    this.providerOperations.set(operation.providerOperationId, { ...operation, providerTransactionId: input.providerTransactionId, reconciliationState: "succeeded" });
    return { refund, materialized: true };
  }

  async attribute(): Promise<void> {}
  async audit(input: Readonly<{ eventType: string }>): Promise<void> { this.auditEvents.push(input.eventType); }
  async enqueue(input: Readonly<{ eventType: string }>): Promise<void> { this.outboxEvents.push(input.eventType); }
  async succeed(_org: string, requestId: string, _resourceType: string, _resourceId: string, result: unknown): Promise<void> {
    const reservation = [...this.reservations.values()].find((candidate) => candidate.requestId === requestId);
    if (!reservation) throw new Error("Missing idempotency reservation.");
    reservation.result = result;
  }
}

const createRuntime = () => {
  const fixture = new FinancialFixture();
  return { fixture, service: new BillingPaymentsApplicationService({ transaction: async (work) => work(fixture) }) };
};

const resultValue = <T>(result: Readonly<{ ok: true; value: T }> | Readonly<{ ok: false; error: Error }>): T => {
  if (!result.ok) throw result.error;
  return result.value;
};

describe("M5 financial spine parity baseline", () => {
  test("leaves commercial tax evidence explicitly insufficient while preserving cents", () => {
    const taxEvidence = compareParity({
      domain: "Tax behavior",
      fixture: "commercial-tax-evidence-status",
      v1: { status: "no-safe-v1-tax-capture" },
      v2: { status: "no-safe-v1-tax-capture" },
      classificationWhenEqual: "INSUFFICIENT_EVIDENCE",
    });
    expect(taxEvidence.classification).toBe("INSUFFICIENT_EVIDENCE");
    const issuedProjection = compareParity({
      domain: "Draft to issued invoice",
      fixture: "zero-tax-exact-cents",
      v1: { lifecycle: "issued", subtotalCents: 100_000, taxCents: 0, totalCents: 100_000, paymentLifecycle: "derived-settlement" },
      v2: { lifecycle: "issued", subtotalCents: 100_000, taxCents: 0, totalCents: 100_000, paymentLifecycle: "derived-settlement" },
      classificationWhenEqual: "SEMANTICALLY_EQUIVALENT",
    });
    requireParity(issuedProjection);
    expect(issuedProjection.classification).toBe("SEMANTICALLY_EQUIVALENT");
  });

  test("records immutable payments and refunds with exact derived settlement, retry, and allocation limits", async () => {
    const { fixture, service } = createRuntime();
    const first = resultValue(await service.recordManualPayment(context("payment-1"), { organizationId, invoiceId, amount: money(usd, 25_000), method: "cash", occurredAt: "2026-08-17T10:00:00.000Z", businessRequestId: brandedId<"BusinessRequestId">("payment-1") }));
    const retry = resultValue(await service.recordManualPayment(context("payment-1"), { organizationId, invoiceId, amount: money(usd, 25_000), method: "cash", occurredAt: "2026-08-17T10:00:00.000Z", businessRequestId: brandedId<"BusinessRequestId">("payment-1") }));
    expect(retry.payment.paymentId).toBe(first.payment.paymentId);
    expect(fixture.payments).toHaveLength(1);
    const second = resultValue(await service.recordManualPayment(context("payment-2"), { organizationId, invoiceId, amount: money(usd, 75_000), method: "check", occurredAt: "2026-08-17T10:01:00.000Z", businessRequestId: brandedId<"BusinessRequestId">("payment-2") }));
    expect(second.settlement.collectibleBalance.cents).toBe(0);
    const overPayment = await service.recordManualPayment(context("payment-over"), { organizationId, invoiceId, amount: money(usd, 1), method: "cash", occurredAt: "2026-08-17T10:02:00.000Z", businessRequestId: brandedId<"BusinessRequestId">("payment-over") });
    expect(overPayment).toMatchObject({ ok: false, error: { code: "CONFLICT" } });

    const firstRefund = resultValue(await service.recordRefund(context("refund-1"), { organizationId, invoiceId, paymentId: first.payment.paymentId, amount: money(usd, 10_000), occurredAt: "2026-08-17T10:03:00.000Z", businessRequestId: brandedId<"BusinessRequestId">("refund-1") }));
    expect(firstRefund.settlement.collectibleBalance.cents).toBe(10_000);
    const secondRefund = resultValue(await service.recordRefund(context("refund-2"), { organizationId, invoiceId, paymentId: first.payment.paymentId, amount: money(usd, 15_000), occurredAt: "2026-08-17T10:04:00.000Z", businessRequestId: brandedId<"BusinessRequestId">("refund-2") }));
    expect(secondRefund.settlement.collectibleBalance.cents).toBe(25_000);
    const overRefund = await service.recordRefund(context("refund-over"), { organizationId, invoiceId, paymentId: first.payment.paymentId, amount: money(usd, 1), occurredAt: "2026-08-17T10:05:00.000Z", businessRequestId: brandedId<"BusinessRequestId">("refund-over") });
    expect(overRefund).toMatchObject({ ok: false, error: { code: "CONFLICT" } });
    const restored = resultValue(await service.recordManualPayment(context("payment-3"), { organizationId, invoiceId, amount: money(usd, 25_000), method: "other", occurredAt: "2026-08-17T10:06:00.000Z", businessRequestId: brandedId<"BusinessRequestId">("payment-3") }));
    expect(restored.settlement.collectibleBalance.cents).toBe(0);
    expect(fixture.payments[0]).toMatchObject({ amount: { cents: 25_000 }, source: "manual" });
    expect(fixture.refunds.map((refund) => ({ paymentId: refund.paymentId, cents: refund.amount.cents }))).toEqual([{ paymentId: first.payment.paymentId, cents: 10_000 }, { paymentId: first.payment.paymentId, cents: 15_000 }]);

    const parity = compareParity({
      domain: "Settlement, payment, and refund",
      fixture: "partial-full-refund-retry-allocation",
      v1: { grossCents: 100_000, collectedCents: 125_000, refundedCents: 25_000, retainedCents: 100_000, balanceCents: 0, paymentCount: 3, refundAllocations: [{ paymentOrdinal: 1, cents: 10_000 }, { paymentOrdinal: 1, cents: 15_000 }] },
      v2: { grossCents: 100_000, collectedCents: fixture.payments.reduce((total, payment) => total + payment.amount.cents, 0), refundedCents: fixture.refunds.reduce((total, refund) => total + refund.amount.cents, 0), retainedCents: fixture.payments.reduce((total, payment) => total + payment.amount.cents, 0) - fixture.refunds.reduce((total, refund) => total + refund.amount.cents, 0), balanceCents: restored.settlement.collectibleBalance.cents, paymentCount: fixture.payments.length, refundAllocations: fixture.refunds.map((refund) => ({ paymentOrdinal: refund.paymentId === first.payment.paymentId ? 1 : 0, cents: refund.amount.cents })) },
      classificationWhenEqual: "SEMANTICALLY_EQUIVALENT",
    });
    requireParity(parity);
    expect(parity.classification).toBe("SEMANTICALLY_EQUIVALENT");
    expect(fixture.auditEvents).toContain("payment_recorded");
    expect(fixture.auditEvents).toContain("refund_recorded");
  });

  test("keeps an Order-backed Invoice payable without issuance while totals change around immutable facts", async () => {
    const { fixture, service } = createRuntime();
    fixture.lifecycle = "draft";
    fixture.totalCents = 50_000;

    const first = resultValue(await service.recordManualPayment(context("live-payment-1"), { organizationId, invoiceId, amount: money(usd, 20_000), method: "check", occurredAt: "2026-08-18T10:00:00.000Z", businessRequestId: brandedId<"BusinessRequestId">("live-payment-1") }));
    expect(first.settlement.collectibleBalance.cents).toBe(30_000);
    const second = resultValue(await service.recordManualPayment(context("live-payment-2"), { organizationId, invoiceId, amount: money(usd, 30_000), method: "check", occurredAt: "2026-08-18T10:01:00.000Z", businessRequestId: brandedId<"BusinessRequestId">("live-payment-2") }));
    expect(second.settlement.collectibleBalance.cents).toBe(0);
    const originalFacts = fixture.payments.map((payment) => ({ ...payment }));

    fixture.totalCents = 60_000;
    const provider = resultValue(await service.beginProviderOperation(context("live-provider-payment"), { organizationId, invoiceId, kind: "payment", amount: money(usd, 10_000), provider: "stripe", providerIdempotencyKey: "live-balance", businessRequestId: brandedId<"BusinessRequestId">("live-provider-payment") }));
    expect(provider.kind).toBe("payment");
    expect((await fixture.settlement(organizationId, invoiceId, usd, fixture.totalCents)).collectibleBalance.cents).toBe(10_000);
    expect(fixture.payments).toEqual(originalFacts);

    fixture.totalCents = 45_000;
    const creditDue = await fixture.settlement(organizationId, invoiceId, usd, fixture.totalCents);
    expect(creditDue.collectibleBalance.cents).toBe(-5_000);
    const blocked = await service.recordManualPayment(context("live-credit-payment"), { organizationId, invoiceId, amount: money(usd, 1), method: "cash", occurredAt: "2026-08-18T10:02:00.000Z", businessRequestId: brandedId<"BusinessRequestId">("live-credit-payment") });
    expect(blocked).toMatchObject({ ok: false, error: { code: "CONFLICT" } });
    expect(fixture.payments).toEqual(originalFacts);

    const refund = resultValue(await service.recordRefund(context("live-credit-refund"), { organizationId, invoiceId, paymentId: first.payment.paymentId, amount: money(usd, 5_000), occurredAt: "2026-08-18T10:03:00.000Z", businessRequestId: brandedId<"BusinessRequestId">("live-credit-refund") }));
    expect(refund.settlement.collectibleBalance.cents).toBe(0);
    expect(fixture.payments).toEqual(originalFacts);
    expect(fixture.refunds).toHaveLength(1);
  });

  test("preserves provider uncertainty and reconciles one immutable provider payment exactly once", async () => {
    const { fixture, service } = createRuntime();
    const begun = resultValue(await service.beginProviderOperation(context("provider-begin"), { organizationId, invoiceId, kind: "payment", amount: money(usd, 100_000), provider: "fixture-pay", providerIdempotencyKey: "provider-key-1", businessRequestId: brandedId<"BusinessRequestId">("provider-begin") }));
    expect(begun.reconciliationState).toBe("uncertain");
    expect(fixture.payments).toHaveLength(0);
    const confirmed = resultValue(await service.confirmProviderPayment(context("provider-confirm"), { organizationId, invoiceId, providerOperationId: begun.providerOperationId, providerEventId: "provider-event-1", providerTransactionId: "provider-transaction-1", occurredAt: "2026-08-17T11:00:00.000Z", businessRequestId: brandedId<"BusinessRequestId">("provider-confirm") }));
    const replay = resultValue(await service.confirmProviderPayment(context("provider-confirm"), { organizationId, invoiceId, providerOperationId: begun.providerOperationId, providerEventId: "provider-event-1", providerTransactionId: "provider-transaction-1", occurredAt: "2026-08-17T11:00:00.000Z", businessRequestId: brandedId<"BusinessRequestId">("provider-confirm") }));
    expect(replay.paymentId).toBe(confirmed.paymentId);
    expect(fixture.payments).toHaveLength(1);
    expect(fixture.providerOperations.get(begun.providerOperationId)).toMatchObject({ reconciliationState: "succeeded", providerTransactionId: "provider-transaction-1" });
    const overpayment = await service.beginProviderOperation(context("provider-overpayment"), { organizationId, invoiceId, kind: "payment", amount: money(usd, 1), provider: "fixture-pay", providerIdempotencyKey: "provider-key-overpayment", businessRequestId: brandedId<"BusinessRequestId">("provider-overpayment") });
    expect(overpayment).toMatchObject({ ok: false, error: { code: "CONFLICT" } });
    expect(fixture.providerOperations.size).toBe(1);
    const providerArchitecture = compareParity({
      domain: "Provider recovery",
      fixture: "uncertain-then-reconciled-payment",
      v1: { recoveryRepresentation: "provider-specific-opaque" },
      v2: { recoveryRepresentation: "durable-uncertain-operation-plus-immutable-payment" },
      classificationWhenDrift: "NOT_COMPARABLE",
    });
    expect(providerArchitecture.classification).toBe("NOT_COMPARABLE");
    expect(providerArchitecture.drifts).toHaveLength(1);
  });

  test("rejects cross-tenant and unauthorized financial requests before ledger mutation", async () => {
    const { fixture, service } = createRuntime();
    const wrongTenant = await service.recordManualPayment(context("wrong-tenant", { organizationId: otherOrganizationId }), { organizationId, invoiceId, amount: money(usd, 100), method: "cash", occurredAt: "2026-08-17T12:00:00.000Z", businessRequestId: brandedId<"BusinessRequestId">("wrong-tenant") });
    expect(wrongTenant).toMatchObject({ ok: false, error: { code: "WRONG_TENANT" } });
    const unauthorizedPrincipal = { ...principal, authority: { ...principal.authority, capabilities: [] as const } };
    const unauthorized = await service.recordManualPayment(context("unauthorized", { principal: unauthorizedPrincipal }), { organizationId, invoiceId, amount: money(usd, 100), method: "cash", occurredAt: "2026-08-17T12:01:00.000Z", businessRequestId: brandedId<"BusinessRequestId">("unauthorized") });
    expect(unauthorized).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
    expect(fixture.payments).toHaveLength(0);
  });
});
