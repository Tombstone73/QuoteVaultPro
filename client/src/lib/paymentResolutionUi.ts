import type { PaymentResolutionStatus } from "@shared/paymentOrchestration";

export type InvoiceAutoPaymentAction = "wait" | "stripe" | "eps" | "manual" | "blocked";

export function getOrderTakePaymentLabel(input: {
  isLoading: boolean;
  isPreparing: boolean;
  resolutionStatus?: PaymentResolutionStatus | null;
}): string {
  if (input.isPreparing) return "Preparing…";
  if (input.isLoading) return "Resolving Payment…";
  if (input.resolutionStatus === "NO_INVOICE") return "Invoice & Take Payment";
  if (input.resolutionStatus === "ALREADY_PAID") return "View Payment";
  return "Take Payment";
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
