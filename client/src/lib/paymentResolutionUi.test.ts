import { describe, expect, test } from "@jest/globals";
import { getOrderBillingActionState, resolveInvoiceAutoPaymentAction } from "@/lib/paymentResolutionUi";

describe("payment resolution UI helpers", () => {
  test("keeps Create Invoice separate from Take Payment when no invoice exists", () => {
    const actions = getOrderBillingActionState({
      billingReady: true,
      hasExistingInvoice: false,
      orderCanceled: false,
      isLoading: false,
      isPreparing: false,
      resolutionStatus: "NO_INVOICE",
    });

    expect(actions).toMatchObject({
      canCreateInvoice: true,
      canTakePayment: false,
      canInvoiceAndTakePayment: true,
      takePaymentHelp: "Create an invoice first",
    });

    expect(getOrderBillingActionState({
      billingReady: false,
      hasExistingInvoice: false,
      orderCanceled: false,
      isLoading: false,
      isPreparing: false,
      resolutionStatus: "NO_INVOICE",
    })).toMatchObject({ canCreateInvoice: false, canInvoiceAndTakePayment: false, canTakePayment: false });

    expect(getOrderBillingActionState({
      billingReady: true,
      hasExistingInvoice: true,
      orderCanceled: false,
      isLoading: false,
      isPreparing: false,
      resolutionStatus: "NO_INVOICE",
    })).toMatchObject({ canCreateInvoice: false, canInvoiceAndTakePayment: false });
  });

  test("enables direct payment only for an existing payable invoice and preserves multi-invoice selection", () => {
    expect(getOrderBillingActionState({
      billingReady: true,
      hasExistingInvoice: true,
      orderCanceled: false,
      isLoading: false,
      isPreparing: false,
      resolutionStatus: "SINGLE_PAYABLE_INVOICE",
    })).toMatchObject({ canTakePayment: true, canInvoiceAndTakePayment: true, takePaymentLabel: "Take Payment" });

    expect(getOrderBillingActionState({
      billingReady: true,
      hasExistingInvoice: true,
      orderCanceled: false,
      isLoading: false,
      isPreparing: false,
      resolutionStatus: "MULTIPLE_PAYABLE_INVOICES",
    })).toMatchObject({ canTakePayment: true, canInvoiceAndTakePayment: true });
  });

  test("opens an already paid invoice without launching payment", () => {
    expect(getOrderBillingActionState({
      billingReady: true,
      hasExistingInvoice: true,
      orderCanceled: false,
      isLoading: false,
      isPreparing: false,
      resolutionStatus: "ALREADY_PAID",
    })).toMatchObject({
      canTakePayment: true,
      canInvoiceAndTakePayment: false,
      takePaymentLabel: "View Invoice",
      takePaymentHelp: "Invoice already paid",
    });
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
