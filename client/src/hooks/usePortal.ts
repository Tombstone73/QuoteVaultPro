import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

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

export type PortalOrderDto = {
  id: string;
  orderNumber: string;
  customerPoNumber: string | null;
  createdAt: string | null;
  status: string;
  displayStatus: string;
  lineItems: Array<{
    id: string;
    itemName: string;
    quantity: number;
    dimensions: { width: number | null; height: number | null };
    status: string;
  }>;
  shipmentSummary?: {
    fulfillmentStatus: string | null;
    shippingMethod: string | null;
    shippedAt: string | null;
    trackingNumbers: string[];
  };
  proofStatusSummary?: {
    status: string;
    requiredCount: number;
    approvedCount: number;
    pendingCount: number;
    revisionRequestedCount: number;
  };
};

export type PortalQuoteDto = {
  id: string;
  quoteNumber: number | null;
  createdAt: string | null;
  validUntil: string | null;
  status: string;
  subtotal: number;
  tax: number;
  total: number;
  lineItems: Array<{
    id: string;
    itemName: string;
    quantity: number;
    dimensions: { width: number | null; height: number | null };
    total: number;
  }>;
  customerVisibleActions: {
    canView: boolean;
    canApprove: boolean;
    canRequestRevision: boolean;
  };
};

export const portalInvoiceKeys = {
  all: ["portal", "invoices"] as const,
  detail: (invoiceId: string | undefined) => ["portal", "invoices", invoiceId] as const,
  payments: (invoiceId: string | undefined) => ["portal", "invoices", invoiceId, "payments"] as const,
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

export function usePortalProducts() {
  return useQuery({
    queryKey: ["portal", "products"],
    queryFn: () => portalFetch<any[]>("/api/portal/products"),
    retry: false,
  });
}

export function useMyQuotes() {
  return useQuery({
    queryKey: ["portal", "my-quotes"],
    queryFn: () => portalFetch<PortalQuoteDto[]>("/api/portal/my-quotes"),
  });
}

export function useMyOrders() {
  return useQuery({
    queryKey: ["portal", "my-orders"],
    queryFn: () => portalFetch<PortalOrderDto[]>("/api/portal/my-orders"),
  });
}

export function useQuoteCheckout(quoteId: string | undefined) {
  return useQuery({
    queryKey: ["portal", "quotes", quoteId],
    queryFn: () => {
      if (!quoteId) throw new Error("Quote ID required");
      return portalFetch<PortalQuoteDto>(`/api/portal/quotes/${encodeURIComponent(quoteId)}`);
    },
    enabled: !!quoteId,
  });
}

export function useConvertPortalQuoteToOrder() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({
      quoteId,
      priority,
      customerNotes,
      dueDate,
    }: {
      quoteId: string;
      priority?: string;
      customerNotes?: string;
      dueDate?: string;
    }) => {
      return portalFetch<any>(`/api/portal/convert-quote/${encodeURIComponent(quoteId)}`, {
        method: "POST",
        body: JSON.stringify({ priority, customerNotes, dueDate }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["portal", "my-quotes"] });
      queryClient.invalidateQueries({ queryKey: ["portal", "my-orders"] });
      toast({
        title: "Success",
        description: "Quote converted to order successfully",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Not available",
        description: error.message,
        variant: "destructive",
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
    queryKey: ["portal", "orders", orderId, "files"],
    queryFn: async () => [],
    enabled: !!orderId,
  });
}

