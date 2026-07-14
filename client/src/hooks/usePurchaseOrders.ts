import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

export interface PurchaseOrderLineItem {
  id: string;
  purchaseOrderId: string;
  materialId?: string | null;
  description: string;
  vendorSku?: string | null;
  quantityOrdered: string; // stored as decimal
  quantityReceived: string;
  unitCost: string; // decimal
  lineTotal: string; // decimal
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PurchaseOrder {
  id: string;
  poNumber: string;
  relatedOrderId?: string | null;
  vendorId: string;
  status: string;
  issueDate: string;
  expectedDate?: string | null;
  receivedDate?: string | null;
  notes?: string | null;
  subtotal: string;
  taxTotal: string;
  shippingTotal: string;
  grandTotal: string;
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
  vendor?: any;
  relatedOrder?: PurchaseOrderRelatedOrder | null;
  lineItems: PurchaseOrderLineItem[];
}

export interface PurchaseOrderRelatedOrder {
  id: string;
  orderNumber?: string | null;
  displayNumber?: string | null;
  jobNumber?: string | null;
  customerName?: string | null;
  status?: string | null;
  state?: string | null;
  primaryDescription?: string | null;
  dueDate?: string | null;
  createdAt?: string | null;
  poNumber?: string | null;
  label?: string | null;
}

interface POFilters {
  vendorId?: string;
  status?: string;
  search?: string;
  startDate?: string;
  endDate?: string;
}

function parseResponse<T>(res: Response): Promise<T> {
  return res.json().then(json => (json && json.success ? json.data : json));
}

export function usePurchaseOrders(filters?: POFilters) {
  return useQuery<PurchaseOrder[]>({
    queryKey: ["/api/purchase-orders", filters],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filters?.vendorId) params.set("vendorId", filters.vendorId);
      if (filters?.status) params.set("status", filters.status);
      if (filters?.search) params.set("search", filters.search);
      if (filters?.startDate) params.set("startDate", filters.startDate);
      if (filters?.endDate) params.set("endDate", filters.endDate);
      const url = `/api/purchase-orders${params.toString() ? `?${params.toString()}` : ""}`;
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch purchase orders");
      return parseResponse<PurchaseOrder[]>(res);
    }
  });
}

export function usePurchaseOrder(id: string | undefined) {
  return useQuery<PurchaseOrder>({
    queryKey: ["/api/purchase-orders", id],
    enabled: !!id,
    queryFn: async () => {
      if (!id) throw new Error("PO ID required");
      const res = await fetch(`/api/purchase-orders/${id}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch purchase order");
      return parseResponse<PurchaseOrder>(res);
    }
  });
}

export interface CreatePurchaseOrderInput {
  vendorId: string;
  relatedOrderId?: string | null;
  issueDate: string; // ISO
  expectedDate?: string | null;
  notes?: string | null;
  lineItems: Array<{ materialId?: string | null; description: string; vendorSku?: string | null; quantityOrdered: number; unitCost: number; notes?: string | null; }>; 
}

export function usePurchaseOrderRelatedOrderSearch(query: string, options?: { enabled?: boolean; recent?: boolean; limit?: number }) {
  const trimmed = query.trim();
  const recent = Boolean(options?.recent);
  return useQuery<PurchaseOrderRelatedOrder[]>({
    queryKey: ["/api/purchase-orders/related-orders/search", { q: trimmed, recent, limit: options?.limit ?? 10 }],
    enabled: options?.enabled !== false && (recent || trimmed.length >= 2),
    queryFn: async () => {
      const params = new URLSearchParams();
      if (trimmed) params.set("q", trimmed);
      if (recent) params.set("recent", "true");
      params.set("limit", String(options?.limit ?? 10));
      const res = await fetch(`/api/purchase-orders/related-orders/search?${params.toString()}`, { credentials: "include" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to search jobs/orders");
      return json.success ? json.data : json;
    },
  });
}

export function useCreatePurchaseOrder() {
  const qc = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (data: CreatePurchaseOrderInput) => {
      const res = await fetch("/api/purchase-orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ ...data, issueDate: data.issueDate, expectedDate: data.expectedDate || undefined })
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || json.message || "Failed to create PO");
      return json.success ? json.data : json;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/purchase-orders"] });
      toast({ title: "Purchase order created" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" })
  });
}

export function useUpdatePurchaseOrder(id: string) {
  const qc = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (data: Partial<CreatePurchaseOrderInput> & { status?: string }) => {
      const res = await fetch(`/api/purchase-orders/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(data)
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || json.message || "Failed to update PO");
      return json.success ? json.data : json;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/purchase-orders"] });
      qc.invalidateQueries({ queryKey: ["/api/purchase-orders", id] });
      toast({ title: "Purchase order updated" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" })
  });
}

export function useDeletePurchaseOrder() {
  const qc = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/purchase-orders/${id}`, { method: "DELETE", credentials: "include" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to delete purchase order");
      return json;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/purchase-orders"] });
      toast({ title: "Purchase order deleted" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" })
  });
}

export function useSendPurchaseOrder(id: string) {
  const qc = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/purchase-orders/${id}/send`, { method: "POST", credentials: "include" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to issue purchase order");
      return json.success ? json.data : json;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/purchase-orders"] });
      qc.invalidateQueries({ queryKey: ["/api/purchase-orders", id] });
      toast({ title: "PO issued" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" })
  });
}

export function useReceivePurchaseOrder(id: string) {
  const qc = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (items: { lineItemId: string; quantityToReceive: number; receivedDate?: Date }[]) => {
      const payload = { items: items.map(i => ({ ...i, receivedDate: i.receivedDate ? i.receivedDate.toISOString() : undefined })) };
      const res = await fetch(`/api/purchase-orders/${id}/receive`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload)
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to receive items");
      return json.success ? json.data : json;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/purchase-orders"] });
      qc.invalidateQueries({ queryKey: ["/api/purchase-orders", id] });
      toast({ title: "Items received" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" })
  });
}
