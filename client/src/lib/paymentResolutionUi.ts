import type { PaymentResolutionStatus } from "@shared/paymentOrchestration";

export type InvoiceAutoPaymentAction = "wait" | "stripe" | "eps" | "manual" | "blocked";

export function getOrderBillingActionState(input: {
  billingReady: boolean;
  hasExistingInvoice: boolean;
  orderCanceled: boolean;
  isLoading: boolean;
  isPreparing: boolean;
  resolutionStatus?: PaymentResolutionStatus | null;
  blockedReason?: string | null;
}): {
  canCreateInvoice: boolean;
  canTakePayment: boolean;
  canInvoiceAndTakePayment: boolean;
  takePaymentLabel: string;
  takePaymentHelp: string | null;
  invoiceAndTakePaymentLabel: string;
} {
  const busy = input.isLoading || input.isPreparing;
  const noInvoice = !input.hasExistingInvoice
    && (input.resolutionStatus === "NO_INVOICE" || !input.resolutionStatus);
  const payable = input.resolutionStatus === "SINGLE_PAYABLE_INVOICE" || input.resolutionStatus === "MULTIPLE_PAYABLE_INVOICES";
  const alreadyPaid = input.resolutionStatus === "ALREADY_PAID";
  const canCreateInvoice = !busy && !input.orderCanceled && input.billingReady && noInvoice;

  if (alreadyPaid) {
    return {
      canCreateInvoice: false,
      canTakePayment: !busy,
      canInvoiceAndTakePayment: false,
      takePaymentLabel: "View Invoice",
      takePaymentHelp: "Invoice already paid",
      invoiceAndTakePaymentLabel: "Invoice already paid",
    };
  }

  if (payable) {
    return {
      canCreateInvoice: false,
      canTakePayment: !busy && !input.orderCanceled,
      canInvoiceAndTakePayment: !busy && !input.orderCanceled,
      takePaymentLabel: "Take Payment",
      takePaymentHelp: null,
      invoiceAndTakePaymentLabel: "Invoice & Take Payment",
    };
  }

  const blockedHelp = noInvoice
    ? "Create an invoice first"
    : input.blockedReason || "No payable invoice is available.";
  return {
    canCreateInvoice,
    canTakePayment: false,
    canInvoiceAndTakePayment: canCreateInvoice,
    takePaymentLabel: "Take Payment",
    takePaymentHelp: blockedHelp,
    invoiceAndTakePaymentLabel: "Invoice & Take Payment",
  };
}

export function resolveInvoiceAutoPaymentAction(input: {
  invoiceReady: boolean;
  dependenciesLoading: boolean;
  invoiceStatus: string;
  remainingCents: number;
  canPayInvoice: boolean;
  epsHostedEnabled: boolean;
  canRecordPayment: boolean;
}): {
  action: InvoiceAutoPaymentAction;
  message?: string;
} {
  if (!input.invoiceReady || input.dependenciesLoading) return { action: "wait" };

  const status = String(input.invoiceStatus || "").trim().toLowerCase();
  const remainingCents = Math.max(0, Math.round(Number(input.remainingCents || 0)));

  if (status === "draft") {
    return { action: "blocked", message: "Draft invoices must be finalized before payment can be collected." };
  }
  if (status === "void") {
    return { action: "blocked", message: "Void invoices cannot accept payment." };
  }
  if (status === "paid" || remainingCents <= 0) {
    return { action: "blocked", message: "This invoice is already paid." };
  }
  if (input.canPayInvoice) return { action: "stripe" };
  if (input.epsHostedEnabled) return { action: "eps" };
  if (input.canRecordPayment) return { action: "manual" };
  return { action: "blocked", message: "No configured payment method is currently available for this invoice." };
}
