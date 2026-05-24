import { useMutation, useQuery } from "@tanstack/react-query";

type PortalEnvelope<T> = {
  success: boolean;
  data?: T;
  message?: string;
  error?: string;
};

export type PortalSessionDto = {
  userId: string;
  customerId: string;
  customerName: string;
  portalContactName: string | null;
  portalEmail: string | null;
  permissions: {
    canViewInvoices: boolean;
    canPayInvoices: boolean;
    canViewOrders: boolean;
    canViewQuotes: boolean;
  };
};

export type PortalInvoiceDto = {
  id: string;
  invoiceNumber: number;
  status: string;
  issueDate: string | null;
  dueDate: string | null;
  subtotal: number;
  tax: number;
  total: number;
  amountPaid: number;
  amountDue: number;
  currency: string;
  pdfAvailable: boolean;
  paymentStatusLabel: string;
};

export type PortalInvoicePaymentDto = {
  id: string;
  amount: number;
  currency: string;
  status: string;
  paidAt: string | null;
  methodLabel: string;
  referenceNumber: string | null;
};

export type PortalOrderProofSummaryDto = {
  proofRequired: boolean;
  statusLabel: string;
  actionRequired: boolean;
  latestVersionNumber: number | null;
  proofLinkAvailable: boolean;
  requiredCount: number;
  approvedCount: number;
  pendingCount: number;
  revisionRequestedCount: number;
};

export type PortalOrderFulfillmentSummaryDto = {
  methodLabel: string | null;
  statusLabel: string;
  trackingNumber: string | null;
  trackingUrl: string | null;
  shippedAt: string | null;
  pickupReadyAt: string | null;
};

export type PortalOrderInvoiceSummaryDto = {
  invoiceCount: number;
  openInvoiceCount: number;
  paidInvoiceCount: number;
  amountDue: number;
  total: number;
  currency: string;
};

export type PortalOrderListDto = {
  id: string;
  orderNumber: string;
  customerPoNumber: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  displayStatus: string;
  rawStatus: string | null;
  total: number;
  itemCount: number;
  proofStatusSummary: PortalOrderProofSummaryDto;
  fulfillmentSummary: PortalOrderFulfillmentSummaryDto;
};

export type PortalOrderDetailDto = PortalOrderListDto & {
  lineItems: Array<{
    id: string;
    name: string;
    description: string | null;
    quantity: number;
    dimensions: { width: number | null; height: number | null };
    displayStatus: string;
    proofStatus: string | null;
    fulfillmentStatusLabel: string | null;
  }>;
  invoiceSummary: PortalOrderInvoiceSummaryDto | null;
};

export type PortalQuoteActionsDto = {
  canView: boolean;
  canApprove: boolean;
  canRequestRevision: boolean;
  disabledReason: string | null;
};

export type PortalQuoteExpirationSummaryDto = {
  expired: boolean;
  expirationLabel: string;
  validUntil: string | null;
};

export type PortalQuoteListDto = {
  id: string;
  quoteNumber: number | null;
  createdAt: string | null;
  validUntil: string | null;
  displayStatus: string;
  total: number;
  itemCount: number;
  customerVisibleActions: PortalQuoteActionsDto;
};

export type PortalQuoteDetailDto = PortalQuoteListDto & {
  subtotal: number;
  tax: number;
  lineItems: Array<{
    id: string;
    name: string;
    description: string | null;
    quantity: number;
    dimensions: { width: number | null; height: number | null };
    unitPrice: number;
    lineTotal: number;
    displayOptions: string[];
  }>;
  expirationSummary: PortalQuoteExpirationSummaryDto;
};

export const portalInvoiceKeys = {
  all: ["portal", "invoices"] as const,
  detail: (invoiceId: string | undefined) => ["portal", "invoices", invoiceId] as const,
  payments: (invoiceId: string | undefined) => ["portal", "invoices", invoiceId, "payments"] as const,
};

export const portalOrderKeys = {
  all: ["portal", "orders"] as const,
  detail: (orderId: string | undefined) => ["portal", "orders", orderId] as const,
};

export const portalQuoteKeys = {
  all: ["portal", "quotes"] as const,
  detail: (quoteId: string | undefined) => ["portal", "quotes", quoteId] as const,
};

async function portalFetch<T>(path: string, init?: RequestInit): Promise<T> {
  if (!path.startsWith("/api/portal/")) {
    throw new Error("Portal requests must use the portal API boundary");
  }

  const response = await fetch(path, {
    ...init,
    credentials: "include",
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(init?.headers || {}),
    },
  });

  const payload = (await response.json().catch(() => ({}))) as PortalEnvelope<T>;
  if (!response.ok || payload.success === false) {
    throw new Error(payload.message || payload.error || "Portal request failed");
  }
  return (payload.data ?? ([] as T)) as T;
}

export function portalInvoicePdfUrl(invoiceId: string, download = false) {
  return `/api/portal/invoices/${encodeURIComponent(invoiceId)}/pdf${download ? "?download=1" : ""}`;
}

export function usePortalSession() {
  return useQuery({
    queryKey: ["portal", "me"],
    queryFn: () => portalFetch<PortalSessionDto>("/api/portal/me"),
    staleTime: 30000,
  });
}

export function usePortalInvoices() {
  return useQuery({
    queryKey: portalInvoiceKeys.all,
    queryFn: () => portalFetch<PortalInvoiceDto[]>("/api/portal/invoices"),
  });
}

export function usePortalInvoice(invoiceId: string | undefined) {
  return useQuery({
    queryKey: portalInvoiceKeys.detail(invoiceId),
    queryFn: () => {
      if (!invoiceId) throw new Error("Invoice ID required");
      return portalFetch<PortalInvoiceDto>(`/api/portal/invoices/${encodeURIComponent(invoiceId)}`);
    },
    enabled: !!invoiceId,
  });
}

export function usePortalInvoicePayments(invoiceId: string | undefined) {
  return useQuery({
    queryKey: portalInvoiceKeys.payments(invoiceId),
    queryFn: () => {
      if (!invoiceId) throw new Error("Invoice ID required");
      return portalFetch<PortalInvoicePaymentDto[]>(`/api/portal/invoices/${encodeURIComponent(invoiceId)}/payments`);
    },
    enabled: !!invoiceId,
  });
}

export function useMyQuotes() {
  return useQuery({
    queryKey: portalQuoteKeys.all,
    queryFn: () => portalFetch<PortalQuoteListDto[]>("/api/portal/quotes"),
  });
}

export function useMyOrders() {
  return useQuery({
    queryKey: portalOrderKeys.all,
    queryFn: () => portalFetch<PortalOrderListDto[]>("/api/portal/orders"),
  });
}

export function usePortalOrder(orderId: string | undefined) {
  return useQuery({
    queryKey: portalOrderKeys.detail(orderId),
    queryFn: () => {
      if (!orderId) throw new Error("Order ID required");
      return portalFetch<PortalOrderDetailDto>(`/api/portal/orders/${encodeURIComponent(orderId)}`);
    },
    enabled: !!orderId,
  });
}

export function useQuoteCheckout(quoteId: string | undefined) {
  return useQuery({
    queryKey: portalQuoteKeys.detail(quoteId),
    queryFn: () => {
      if (!quoteId) throw new Error("Quote ID required");
      return portalFetch<PortalQuoteDetailDto>(`/api/portal/quotes/${encodeURIComponent(quoteId)}`);
    },
    enabled: !!quoteId,
  });
}

export function useUploadOrderFile(_orderId: string) {
  return useMutation({
    mutationFn: async () => {
      throw new Error("Portal uploads are not available yet");
    },
  });
}

export function useOrderFiles(orderId: string | undefined) {
  return useQuery({
    queryKey: ["portal", "orders", orderId, "files"],
    queryFn: async () => [],
    enabled: !!orderId,
  });
}
