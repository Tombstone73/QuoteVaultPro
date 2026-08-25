import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "node:fs";
import path from "node:path";
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
      canTakePayment: true,
      canInvoiceAndTakePayment: false,
      takePaymentLabel: "Take Payment",
      takePaymentHelp: null,
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
    })).toMatchObject({
      canTakePayment: true,
      canInvoiceAndTakePayment: false,
      takePaymentLabel: "Take Payment",
    });

    expect(getOrderBillingActionState({
      billingReady: true,
      hasExistingInvoice: true,
      orderCanceled: false,
      isLoading: false,
      isPreparing: false,
      resolutionStatus: "MULTIPLE_PAYABLE_INVOICES",
    })).toMatchObject({ canTakePayment: true, canInvoiceAndTakePayment: false, takePaymentLabel: "Take Payment" });
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

  test("blocks draft, void, and zero-balance invoices", () => {
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
    }).message).toBe("Invoice is already paid.");
  });

  test("allows staff card payment when a refund reopens a historically paid invoice", () => {
    expect(resolveInvoiceAutoPaymentAction({
      invoiceReady: true,
      dependenciesLoading: false,
      invoiceStatus: "paid",
      remainingCents: 750,
      canPayInvoice: true,
      epsHostedEnabled: false,
      canRecordPayment: true,
    })).toMatchObject({ action: "stripe" });
  });

  test("chooses hosted provider and never falls back to manual record payment", () => {
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
    })).toMatchObject({
      action: "blocked",
      message: "No configured card processor is currently available for this invoice.",
    });
  });

  test("mounted staff pages expose one Take Payment entry and the unified method dialog", () => {
    const invoiceDetailSource = readFileSync(path.resolve(process.cwd(), "client/src/pages/invoice-detail.tsx"), "utf8");
    const orderDetailSource = readFileSync(path.resolve(process.cwd(), "client/src/pages/order-detail.tsx"), "utf8");

    expect(invoiceDetailSource).toContain("<DialogTitle>Take Payment</DialogTitle>");
    expect(invoiceDetailSource).toContain('<SelectItem value="credit_card">Credit Card</SelectItem>');
    expect(invoiceDetailSource).toContain('<SelectItem value="cash">Cash</SelectItem>');
    expect(invoiceDetailSource).toContain('<SelectItem value="check">Check</SelectItem>');
    expect(invoiceDetailSource).toContain('<SelectItem value="bank_transfer">ACH / Bank Transfer</SelectItem>');
    expect(invoiceDetailSource).toContain('<SelectItem value="other">Other</SelectItem>');
    expect(invoiceDetailSource).toContain("openTakePayment('credit_card');");
    expect(invoiceDetailSource).not.toContain("Take Card Payment");
    expect(invoiceDetailSource).not.toContain("Invoice & Take Payment");
    expect(invoiceDetailSource).not.toContain("Pay Invoice");
    expect(invoiceDetailSource).not.toContain("shouldTakeCardPayment");

    expect(orderDetailSource).toContain("Take Payment");
    expect(orderDetailSource).not.toContain("Take Card Payment");
    expect(orderDetailSource).not.toContain("Invoice & Take Payment");
  });
});
