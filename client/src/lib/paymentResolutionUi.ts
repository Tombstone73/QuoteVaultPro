import { getInvoiceFinancialPaymentEligibility, type PaymentProviderSummary, type PaymentResolutionStatus } from "@shared/paymentOrchestration";

export type InvoiceAutoPaymentAction = "wait" | "stripe" | "eps" | "blocked";

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
      invoiceAndTakePaymentLabel: "Take Payment",
    };
  }

  if (payable) {
    return {
      canCreateInvoice: false,
      canTakePayment: !busy && !input.orderCanceled,
      canInvoiceAndTakePayment: false,
      takePaymentLabel: "Take Payment",
      takePaymentHelp: null,
      invoiceAndTakePaymentLabel: "Take Payment",
    };
  }

  const blockedHelp = noInvoice
    ? (canCreateInvoice ? null : "Create an invoice first")
    : input.blockedReason || "No payable invoice is available.";
  return {
    canCreateInvoice,
    canTakePayment: canCreateInvoice,
    canInvoiceAndTakePayment: false,
    takePaymentLabel: "Take Payment",
    takePaymentHelp: blockedHelp,
    invoiceAndTakePaymentLabel: "Take Payment",
  };
}

export function getHostedCardUnavailableReason(input: {
  provider?: PaymentProviderSummary | null;
  paymentSettingsMissing?: readonly string[] | null;
  paymentSettingsProvider?: string | null;
  epsEnabled?: boolean | null;
  epsReady?: boolean | null;
  stripeEnabled?: boolean | null;
  stripeConnected?: boolean | null;
  stripeChargesEnabled?: boolean | null;
}): string {
  const configuredProvider = String(input.provider?.configuredProvider ?? input.paymentSettingsProvider ?? "none").trim().toLowerCase();
  const missing = input.paymentSettingsMissing?.filter(Boolean) ?? [];

  if (configuredProvider === "eps") {
    if (input.epsEnabled === false) return "EPS is selected but not enabled in Settings.";
    if (input.epsReady === false || input.provider?.epsReady === false) {
      return missing.length
        ? `EPS setup is incomplete: ${missing.join(", ")}.`
        : "EPS setup is incomplete. Save the required EPS settings before taking card payments.";
    }
    return "EPS is selected but hosted card payments are not currently available.";
  }

  if (configuredProvider === "stripe") {
    if (input.stripeEnabled === false) return "Stripe is selected but disabled in Settings.";
    if (input.stripeConnected === false) return "Stripe is selected but not connected.";
    if (input.stripeChargesEnabled === false) return "Stripe is connected but charges are not enabled.";
    return "Stripe card payments are not currently available.";
  }

  if (input.provider?.hostedResolution.reason === "multiple_available_no_default") {
    return "Choose a default card processor in Settings before taking card payments.";
  }

  return "Configure a card processor in Settings.";
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

  const remainingCents = Math.max(0, Math.round(Number(input.remainingCents || 0)));
  const financialEligibility = getInvoiceFinancialPaymentEligibility({ invoiceStatus: input.invoiceStatus, remainingCents });
  if (!financialEligibility.payable) return { action: "blocked", message: financialEligibility.blockedReason || "This invoice cannot accept payment." };
  if (input.canPayInvoice) return { action: "stripe" };
  if (input.epsHostedEnabled) return { action: "eps" };
  return { action: "blocked", message: "No configured card processor is currently available for this invoice." };
}
