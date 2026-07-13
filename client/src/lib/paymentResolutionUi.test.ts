import { describe, expect, test } from "@jest/globals";
import { getOrderTakePaymentLabel, resolveInvoiceAutoPaymentAction } from "@/lib/paymentResolutionUi";

describe("payment resolution UI helpers", () => {
  test("labels the order payment action from resolution state", () => {
    expect(getOrderTakePaymentLabel({ isLoading: true, isPreparing: false })).toBe("Resolving Payment…");
    expect(getOrderTakePaymentLabel({ isLoading: false, isPreparing: true })).toBe("Preparing…");
    expect(getOrderTakePaymentLabel({ isLoading: false, isPreparing: false, resolutionStatus: "NO_INVOICE" })).toBe("Invoice & Take Payment");
    expect(getOrderTakePaymentLabel({ isLoading: false, isPreparing: false, resolutionStatus: "ALREADY_PAID" })).toBe("View Payment");
    expect(getOrderTakePaymentLabel({ isLoading: false, isPreparing: false, resolutionStatus: "SINGLE_PAYABLE_INVOICE" })).toBe("Take Payment");
  });

  test("waits while invoice or provider state is still loading", () => {
    expect(resolveInvoiceAutoPaymentAction({
      invoiceReady: false,
      dependenciesLoading: false,
      invoiceStatus: "billed",
      remainingCents: 1000,
      canPayInvoice: true,
      epsHostedEnabled: false,
      canRecordPayment: true,
    }).action).toBe("wait");

    expect(resolveInvoiceAutoPaymentAction({
      invoiceReady: true,
      dependenciesLoading: true,
      invoiceStatus: "billed",
      remainingCents: 1000,
      canPayInvoice: true,
      epsHostedEnabled: false,
      canRecordPayment: true,
    }).action).toBe("wait");
  });

  test("blocks draft, void, and paid invoices", () => {
    expect(resolveInvoiceAutoPaymentAction({
      invoiceReady: true,
      dependenciesLoading: false,
      invoiceStatus: "draft",
      remainingCents: 1000,
      canPayInvoice: false,
      epsHostedEnabled: false,
      canRecordPayment: false,
    })).toMatchObject({ action: "blocked", message: "Draft invoices must be finalized before payment can be collected." });

    expect(resolveInvoiceAutoPaymentAction({
      invoiceReady: true,
      dependenciesLoading: false,
      invoiceStatus: "void",
      remainingCents: 1000,
      canPayInvoice: false,
      epsHostedEnabled: false,
      canRecordPayment: false,
    }).message).toBe("Void invoices cannot accept payment.");

    expect(resolveInvoiceAutoPaymentAction({
      invoiceReady: true,
      dependenciesLoading: false,
      invoiceStatus: "paid",
      remainingCents: 0,
      canPayInvoice: false,
      epsHostedEnabled: false,
      canRecordPayment: false,
    }).message).toBe("This invoice is already paid.");
  });

  test("chooses hosted provider before manual record payment", () => {
    expect(resolveInvoiceAutoPaymentAction({
      invoiceReady: true,
      dependenciesLoading: false,
      invoiceStatus: "billed",
      remainingCents: 1000,
      canPayInvoice: true,
      epsHostedEnabled: false,
      canRecordPayment: true,
    }).action).toBe("stripe");

    expect(resolveInvoiceAutoPaymentAction({
      invoiceReady: true,
      dependenciesLoading: false,
      invoiceStatus: "billed",
      remainingCents: 1000,
      canPayInvoice: false,
      epsHostedEnabled: true,
      canRecordPayment: true,
    }).action).toBe("eps");

    expect(resolveInvoiceAutoPaymentAction({
      invoiceReady: true,
      dependenciesLoading: false,
      invoiceStatus: "billed",
      remainingCents: 1000,
      canPayInvoice: false,
      epsHostedEnabled: false,
      canRecordPayment: true,
    }).action).toBe("manual");
  });
});
