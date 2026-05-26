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
  displayNumber: string;
  numberCore: number | null;
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

export type PortalFileDto = {
  id: string;
  displayName: string;
  description: string | null;
  fileTypeLabel: string;
  uploadedAt: string | null;
  fileSize: number | null;
  categoryLabel: string;
  previewAvailable: boolean;
  downloadAvailable: boolean;
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
  displayNumber: string;
  numberCore: number | null;
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
  canDecline: boolean;
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
  displayNumber: string | null;
  numberCore: number | null;
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

export type PortalQuoteAction = "approve" | "decline" | "request_revision";

export type PortalQuoteActionResultDto = {
  quote: PortalQuoteDetailDto;
  order?: {
    id: string;
    orderNumber: string;
    displayNumber: string;
    displayStatus: string;
  };
  message: string;
};

export type PortalDashboardFileDto = PortalFileDto & {
  entityType: "invoice" | "order" | "quote";
  entityId: string;
  sourceLabel: string;
};

export type PortalDashboardActivityDto = {
  id: string;
  type: "invoice" | "quote" | "order" | "file" | "proof";
  label: string;
  occurredAt: string | null;
  targetType: "invoice" | "quote" | "order" | "file" | "proof";
  targetId: string;
};

export type PortalDashboardDto = {
  summary: {
    openInvoiceCount: number;
    outstandingBalance: number;
    activeOrderCount: number;
    quotesNeedingAction: number;
    proofsAwaitingApproval: number;
  };
  invoices: PortalInvoiceDto[];
  quotes: PortalQuoteListDto[];
  activeOrders: PortalOrderListDto[];
  proofs: PortalProofDto[];
  recentFiles: PortalDashboardFileDto[];
  recentActivity: PortalDashboardActivityDto[];
};

export type PortalProofStatus =
  | "awaiting_customer"
  | "approved"
  | "rejected"
  | "revision_requested"
  | "superseded"
  | "unavailable"
  | "under_review";

export type PortalProofAction = "approve" | "reject" | "request_revision";

export type PortalProofDto = {
  id: string;
  versionNumber: number;
  status: PortalProofStatus;
  displayStatus: string;
  createdAt: string | null;
  updatedAt: string | null;
  previewAvailable: boolean;
  proofFileAvailable: boolean;
  proofNotes: string | null;
  lineItemSummary: {
    id: string;
    name: string;
    quantity: number;
    dimensions: { width: number | null; height: number | null };
  };
  orderSummary: {
    id: string;
    orderNumber: string;
    displayNumber: string;
    displayStatus: string;
  };
  customerActionRequired: boolean;
  history?: Array<{
    id: string;
    versionNumber: number;
    displayStatus: string;
    createdAt: string | null;
    respondedAt: string | null;
  }>;
};

export type PortalProofActionResultDto = {
  proof: PortalProofDto;
  message: string;
};

export const portalDashboardKeys = {
  all: ["portal", "dashboard"] as const,
};

export const portalInvoiceKeys = {
  all: ["portal", "invoices"] as const,
  detail: (invoiceId: string | undefined) => ["portal", "invoices", invoiceId] as const,
  payments: (invoiceId: string | undefined) => ["portal", "invoices", invoiceId, "payments"] as const,
  files: (invoiceId: string | undefined) => ["portal", "invoices", invoiceId, "files"] as const,
};

export const portalOrderKeys = {
  all: ["portal", "orders"] as const,
  detail: (orderId: string | undefined) => ["portal", "orders", orderId] as const,
  files: (orderId: string | undefined) => ["portal", "orders", orderId, "files"] as const,
};

export const portalQuoteKeys = {
  all: ["portal", "quotes"] as const,
  detail: (quoteId: string | undefined) => ["portal", "quotes", quoteId] as const,
  files: (quoteId: string | undefined) => ["portal", "quotes", quoteId, "files"] as const,
};

export const portalProofKeys = {
  all: ["portal", "proofs"] as const,
  detail: (proofId: string | undefined) => ["portal", "proofs", proofId] as const,
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

export function portalFileDownloadUrl(entity: "invoices" | "orders" | "quotes", entityId: string, fileId: string) {
  return `/api/portal/${entity}/${encodeURIComponent(entityId)}/files/${encodeURIComponent(fileId)}`;
}

export function portalProofFileUrl(proofId: string) {
  return `/api/portal/proofs/${encodeURIComponent(proofId)}/file`;
}

export function usePortalSession() {
  return useQuery({
    queryKey: ["portal", "me"],
    queryFn: () => portalFetch<PortalSessionDto>("/api/portal/me"),
    staleTime: 30000,
  });
}

export function usePortalDashboard() {
  return useQuery({
    queryKey: portalDashboardKeys.all,
    queryFn: () => portalFetch<PortalDashboardDto>("/api/portal/dashboard"),
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

export function usePortalInvoiceFiles(invoiceId: string | undefined) {
  return useQuery({
    queryKey: portalInvoiceKeys.files(invoiceId),
    queryFn: () => {
      if (!invoiceId) throw new Error("Invoice ID required");
      return portalFetch<PortalFileDto[]>(`/api/portal/invoices/${encodeURIComponent(invoiceId)}/files`);
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

export function usePortalOrderFiles(orderId: string | undefined) {
  return useQuery({
    queryKey: portalOrderKeys.files(orderId),
    queryFn: () => {
      if (!orderId) throw new Error("Order ID required");
      return portalFetch<PortalFileDto[]>(`/api/portal/orders/${encodeURIComponent(orderId)}/files`);
    },
    enabled: !!orderId,
  });
}

export function usePortalQuoteFiles(quoteId: string | undefined) {
  return useQuery({
    queryKey: portalQuoteKeys.files(quoteId),
    queryFn: () => {
      if (!quoteId) throw new Error("Quote ID required");
      return portalFetch<PortalFileDto[]>(`/api/portal/quotes/${encodeURIComponent(quoteId)}/files`);
    },
    enabled: !!quoteId,
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

export function usePortalQuoteAction(quoteId: string | undefined) {
  return useMutation({
    mutationFn: async ({ action, note }: { action: PortalQuoteAction; note?: string | null }) => {
      if (!quoteId) throw new Error("Quote ID required");
      const actionPath =
        action === "approve"
          ? "approve"
          : action === "decline"
            ? "decline"
            : "request-revision";

      return portalFetch<PortalQuoteActionResultDto>(`/api/portal/quotes/${encodeURIComponent(quoteId)}/${actionPath}`, {
        method: "POST",
        body: JSON.stringify(note ? { note } : {}),
      });
    },
  });
}

export function usePortalProofs() {
  return useQuery({
    queryKey: portalProofKeys.all,
    queryFn: () => portalFetch<PortalProofDto[]>("/api/portal/proofs"),
  });
}

export function usePortalProof(proofId: string | undefined) {
  return useQuery({
    queryKey: portalProofKeys.detail(proofId),
    queryFn: () => {
      if (!proofId) throw new Error("Proof ID required");
      return portalFetch<PortalProofDto>(`/api/portal/proofs/${encodeURIComponent(proofId)}`);
    },
    enabled: !!proofId,
  });
}

export function usePortalProofAction(proofId: string | undefined) {
  return useMutation({
    mutationFn: async ({ action, note }: { action: PortalProofAction; note?: string | null }) => {
      if (!proofId) throw new Error("Proof ID required");
      const actionPath =
        action === "approve"
          ? "approve"
          : action === "reject"
            ? "reject"
            : "request-revision";

      return portalFetch<PortalProofActionResultDto>(`/api/portal/proofs/${encodeURIComponent(proofId)}/${actionPath}`, {
        method: "POST",
        body: JSON.stringify(note ? { note } : {}),
      });
    },
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
    queryKey: portalOrderKeys.files(orderId),
    queryFn: () => {
      if (!orderId) throw new Error("Order ID required");
      return portalFetch<PortalFileDto[]>(`/api/portal/orders/${encodeURIComponent(orderId)}/files`);
    },
    enabled: !!orderId,
  });
}
