import type { ConfiguredPaymentProvider, HostedPaymentProvider, HostedPaymentProviderResolution } from "./paymentProviderResolution";

export const paymentResolutionStatuses = [
  "NO_INVOICE",
  "SINGLE_PAYABLE_INVOICE",
  "MULTIPLE_PAYABLE_INVOICES",
  "ALREADY_PAID",
  "BLOCKED",
  "INVOICE_READY",
] as const;

export type PaymentResolutionStatus = (typeof paymentResolutionStatuses)[number];

export const paymentRecommendedActions = [
  "GENERATE_INVOICE",
  "OPEN_INVOICE",
  "SELECT_INVOICE",
  "TAKE_PAYMENT",
  "VIEW_PAID_INVOICE",
  "BLOCKED",
] as const;

export type PaymentRecommendedAction = (typeof paymentRecommendedActions)[number];

export const payableInvoiceStatuses = ["finalized", "billed", "sent", "partially_paid", "overdue"] as const;
export const blockedInvoiceStatuses = ["draft", "paid", "void"] as const;

export type PayableInvoiceStatus = (typeof payableInvoiceStatuses)[number];
export type BlockedInvoiceStatus = (typeof blockedInvoiceStatuses)[number];

export type AvailablePaymentMethod = "hosted_card" | "manual";

export type PaymentInvoiceCandidate = {
  id: string;
  invoiceNumber: number | null;
  displayNumber: string | null;
  numberCore: number | null;
  status: string;
  totalCents: number;
  amountPaidCents: number;
  remainingBalanceCents: number;
  payable: boolean;
  blockedReason: string | null;
};

export type PaymentProviderSummary = {
  configuredProvider: ConfiguredPaymentProvider;
  hostedProvider: HostedPaymentProvider | null;
  hostedResolution: HostedPaymentProviderResolution;
  epsReady: boolean;
  stripeEnabled: boolean;
  stripeConnected: boolean;
};

export type PaymentResolution = {
  entityType: "order" | "invoice";
  orderId?: string | null;
  requestedInvoiceId?: string | null;
  resolutionStatus: PaymentResolutionStatus;
  payable: boolean;
  blockedReason: string | null;
  invoiceCandidates: PaymentInvoiceCandidate[];
  selectedInvoice: PaymentInvoiceCandidate | null;
  amountDueCents: number;
  provider: PaymentProviderSummary;
  availablePaymentMethods: AvailablePaymentMethod[];
  recommendedAction: PaymentRecommendedAction;
  redirectTarget: string | null;
};

export function isPayableInvoiceStatus(status: string | null | undefined): boolean {
  return (payableInvoiceStatuses as readonly string[]).includes(String(status || "").trim().toLowerCase());
}

export function isBlockedInvoiceStatus(status: string | null | undefined): boolean {
  return (blockedInvoiceStatuses as readonly string[]).includes(String(status || "").trim().toLowerCase());
}
