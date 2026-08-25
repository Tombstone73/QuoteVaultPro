import { describe, expect, test } from "@jest/globals";
import {
  buildOrderPaymentResolutionFromCandidates,
  getInvoicePaymentEligibility,
} from "../services/payments/paymentOrchestrator.service";
import type { PaymentInvoiceCandidate, PaymentProviderSummary } from "../../shared/paymentOrchestration";

const provider = (hostedProvider: "stripe" | "eps" | null = "stripe"): PaymentProviderSummary => ({
  configuredProvider: hostedProvider ?? "none",
  hostedProvider,
  hostedResolution: hostedProvider
    ? { provider: hostedProvider, reason: "configured_default", availableProviders: [hostedProvider] }
    : { provider: null, reason: "none_available", availableProviders: [] },
  epsReady: hostedProvider === "eps",
  stripeEnabled: hostedProvider === "stripe",
  stripeConnected: hostedProvider === "stripe",
});

const invoice = (overrides: Partial<PaymentInvoiceCandidate> = {}): PaymentInvoiceCandidate => ({
  id: overrides.id ?? "invoice_1",
  invoiceNumber: overrides.invoiceNumber ?? 101,
  displayNumber: overrides.displayNumber ?? "INV-101",
  numberCore: overrides.numberCore ?? 101,
  status: overrides.status ?? "billed",
  totalCents: overrides.totalCents ?? 10_000,
  amountPaidCents: overrides.amountPaidCents ?? 0,
  remainingBalanceCents: overrides.remainingBalanceCents ?? 10_000,
  payable: overrides.payable ?? true,
  blockedReason: overrides.blockedReason ?? null,
});

describe("payment orchestrator order resolution", () => {
  test("no invoice requires invoice generation", () => {
    const result = buildOrderPaymentResolutionFromCandidates({
      orderId: "order_1",
      provider: provider("stripe"),
      invoiceCandidates: [],
    });

    expect(result.resolutionStatus).toBe("NO_INVOICE");
    expect(result.recommendedAction).toBe("GENERATE_INVOICE");
    expect(result.payable).toBe(false);
  });

  test("one payable invoice navigates to take payment", () => {
    const result = buildOrderPaymentResolutionFromCandidates({
      orderId: "order_1",
      provider: provider("stripe"),
      invoiceCandidates: [invoice()],
    });

    expect(result.resolutionStatus).toBe("SINGLE_PAYABLE_INVOICE");
    expect(result.selectedInvoice?.id).toBe("invoice_1");
    expect(result.redirectTarget).toBe("/invoices/invoice_1?takePayment=1");
    expect(result.availablePaymentMethods).toContain("hosted_card");
  });

  test("paid invoice opens invoice without launching payment", () => {
    const result = buildOrderPaymentResolutionFromCandidates({
      orderId: "order_1",
      provider: provider("stripe"),
      invoiceCandidates: [
        invoice({ status: "paid", amountPaidCents: 10_000, remainingBalanceCents: 0, payable: false, blockedReason: "Invoice is already paid." }),
      ],
    });

    expect(result.resolutionStatus).toBe("ALREADY_PAID");
    expect(result.recommendedAction).toBe("VIEW_PAID_INVOICE");
    expect(result.redirectTarget).toBe("/invoices/invoice_1");
  });

  test.each([
    ["draft", "Draft invoices must be finalized before payment can be collected."],
    ["void", "Void invoices cannot accept payment."],
  ])("%s invoice blocks payment", (status, reason) => {
    const result = buildOrderPaymentResolutionFromCandidates({
      orderId: "order_1",
      provider: provider("stripe"),
      invoiceCandidates: [invoice({ status, payable: false, blockedReason: reason })],
    });

    expect(result.resolutionStatus).toBe("BLOCKED");
    expect(result.blockedReason).toBe(reason);
    expect(result.recommendedAction).toBe("BLOCKED");
  });

  test("multiple payable invoices require selection", () => {
    const result = buildOrderPaymentResolutionFromCandidates({
      orderId: "order_1",
      provider: provider("eps"),
      invoiceCandidates: [invoice({ id: "invoice_1" }), invoice({ id: "invoice_2", remainingBalanceCents: 2500 })],
    });

    expect(result.resolutionStatus).toBe("MULTIPLE_PAYABLE_INVOICES");
    expect(result.recommendedAction).toBe("SELECT_INVOICE");
    expect(result.amountDueCents).toBe(12_500);
    expect(result.provider.hostedProvider).toBe("eps");
  });

  test("multiple non-payable invoices do not generate a new invoice", () => {
    const result = buildOrderPaymentResolutionFromCandidates({
      orderId: "order_1",
      provider: provider(null),
      invoiceCandidates: [
        invoice({ id: "invoice_1", status: "draft", payable: false, blockedReason: "Draft invoices must be finalized before payment can be collected." }),
        invoice({ id: "invoice_2", status: "void", payable: false, blockedReason: "Void invoices cannot accept payment." }),
      ],
    });

    expect(result.resolutionStatus).toBe("BLOCKED");
    expect(result.recommendedAction).toBe("BLOCKED");
    expect(result.invoiceCandidates).toHaveLength(2);
  });

  test("partial payment leaves remaining balance payable", () => {
    const result = buildOrderPaymentResolutionFromCandidates({
      orderId: "order_1",
      provider: provider("stripe"),
      invoiceCandidates: [invoice({ status: "partially_paid", amountPaidCents: 4500, remainingBalanceCents: 5500 })],
    });

    expect(result.resolutionStatus).toBe("SINGLE_PAYABLE_INVOICE");
    expect(result.amountDueCents).toBe(5500);
  });
});

describe("invoice payment eligibility", () => {
  test("finalized invoice with remaining balance is payable", () => {
    const result = getInvoicePaymentEligibility({
      invoice: { id: "invoice_1", status: "finalized", totalCents: 10_000 },
      payments: [],
    });

    expect(result.payable).toBe(true);
    expect(result.remainingBalanceCents).toBe(10_000);
  });

  test("draft, void, and zero-balance invoices are blocked", () => {
    expect(getInvoicePaymentEligibility({ invoice: { status: "draft", totalCents: 10_000 }, payments: [] }).payable).toBe(false);
    expect(getInvoicePaymentEligibility({ invoice: { status: "void", totalCents: 10_000 }, payments: [] }).payable).toBe(false);
    expect(getInvoicePaymentEligibility({ invoice: { status: "paid", totalCents: 10_000 }, payments: [{ status: "succeeded", amountCents: 10_000 }] }).payable).toBe(false);
  });

  test("a full Stripe refund reopens an invoice whose historical status is paid", () => {
    const result = getInvoicePaymentEligibility({
      invoice: { id: "invoice_1", status: "paid", totalCents: 750 },
      payments: [
        { id: "payment_1", status: "succeeded", amountCents: 750 },
        { id: "refund_1", status: "refunded", amountCents: 750 },
      ],
    });

    expect(result).toMatchObject({ payable: true, amountPaidCents: 0, remainingBalanceCents: 750 });
  });

  test("a partial Stripe refund reopens only the refunded balance", () => {
    const result = getInvoicePaymentEligibility({
      invoice: { id: "invoice_1", status: "paid", totalCents: 1_000 },
      payments: [
        { id: "payment_1", status: "succeeded", amountCents: 1_000 },
        { id: "refund_1", status: "refunded", amountCents: 250 },
      ],
    });

    expect(result).toMatchObject({ payable: true, amountPaidCents: 750, remainingBalanceCents: 250 });
  });
});
