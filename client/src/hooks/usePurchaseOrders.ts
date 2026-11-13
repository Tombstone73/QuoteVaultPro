import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import type { ActualPurchaseCost } from "@shared/purchaseOrderWorkflow";

export interface PurchaseOrderLineItem {
  id: string;
  purchaseOrderId: string;
  materialId?: string | null;
  description: string;
  vendorSku?: string | null;
  quantityOrdered: string; // stored as decimal
  quantityReceived: string;
  inventoryUnitsPerPurchaseUnit: string;
  unitCost: string; // decimal
  lineTotal: string; // decimal
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PurchaseOrderListRow {
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
  version: number;
  revision: number | null;
  paymentTerms: string | null;
  paymentMethod: string | null;
  paymentInstructions: string | null;
  originalTotal: string | null;
  actualTotal: string | null;
  actualProvisional: boolean;
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
  vendor?: { id: string; name: string; email?: string | null; salesRepEmail?: string | null; salesRepName?: string | null } | null;
  relatedOrder?: PurchaseOrderRelatedOrder | null;
  itemSummary?: string | null;
}

export interface PurchaseOrder extends PurchaseOrderListRow {
  lineItems: PurchaseOrderLineItem[];
  actualCosts: Record<string, ActualPurchaseCost>;
  originalLines?: Pick<PurchaseOrderLineItem, "id" | "quantityOrdered" | "unitCost" | "lineTotal">[] | null;
  revisions?: { revision: number; source: string; reason: string | null; actorId: string | null; createdAt: string; total: string }[];
  timeline?: { id: string; actionType: string; description: string; createdAt: string; userId?: string | null; userName?: string | null; oldValues?: unknown; newValues?: unknown }[];
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
  return useQuery<PurchaseOrderListRow[]>({
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
      const rows = await parseResponse<PurchaseOrderListRow[]>(res);
      if (!Array.isArray(rows) || rows.some(row => typeof row.version !== "number")) throw new Error("The purchasing service is updating. Try again shortly.");
      return rows;
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
      const po = await parseResponse<PurchaseOrder>(res);
      if (typeof po?.version !== "number") throw new Error("The purchasing service is updating. Try again shortly.");
      return po;
    }
  });
}

export interface CreatePurchaseOrderInput {
  vendorId: string;
  relatedOrderId?: string | null;
  issueDate: string; // ISO
  expectedDate?: string | null;
  notes?: string | null;
  paymentTerms?: string | null;
  paymentMethod?: string | null;
  paymentInstructions?: string | null;
  lineItems: Array<{ id?: string; materialId?: string | null; description: string; vendorSku?: string | null; quantityOrdered: string | number; unitCost: string | number; notes?: string | null }>;
}

export type UpdatePurchaseOrderInput = Partial<CreatePurchaseOrderInput> & { expectedVersion: number; revisionReason?: string; status?: "cancelled" | "closed" };

export async function purchaseOrderRequest<T>(url: string, data: unknown, method = "POST"): Promise<T> {
  const res = await fetch(url, {
    method, headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify(data),
  });
  const json = await res.json().catch(() => null);
  if (!json) throw new Error("The purchasing service is unavailable. Try again shortly.");
  if (!res.ok || !json.success) throw new Error(json.error || json.message || "Purchase order request failed.");
  return json.data;
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
  return useMutation({
    mutationFn: (data: CreatePurchaseOrderInput) => purchaseOrderRequest<PurchaseOrder>("/api/purchase-orders/workflow", data),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["/api/purchase-orders"] }); },
  });
}

export function useUpdatePurchaseOrder(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: UpdatePurchaseOrderInput) => purchaseOrderRequest<PurchaseOrder>(`/api/purchase-orders/${id}/workflow`, data, "PATCH"),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["/api/purchase-orders"] }); },
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
    mutationFn: (expectedVersion: number) => purchaseOrderRequest<PurchaseOrder>(`/api/purchase-orders/${id}/issue`, { expectedVersion }),
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
    mutationFn: async ({ items, expectedVersion }: { expectedVersion: number; items: { lineItemId: string; quantityToReceive: number; receivedDate?: Date }[] }) => {
      const payload = { expectedVersion, items: items.map(i => ({ ...i, receivedDate: i.receivedDate?.toISOString() })) };
      return purchaseOrderRequest<PurchaseOrder>(`/api/purchase-orders/${id}/receipts`, payload);
    },
    onSuccess: (purchaseOrder, { items }) => {
      qc.invalidateQueries({ queryKey: ["/api/purchase-orders"] });
      const receivedLines = new Set(items.map(({ lineItemId }) => lineItemId));
      const materialIds = new Set(purchaseOrder.lineItems.filter(({ id, materialId }) => materialId && receivedLines.has(id)).map(({ materialId }) => materialId));
      if (materialIds.size) {
        void qc.invalidateQueries({ queryKey: ["/api/materials"], predicate: ({ queryKey }) => {
          const key = queryKey[1];
          return typeof key !== "string" || key === "search" || key === "low-stock" || materialIds.has(key);
        } });
        void qc.invalidateQueries({ queryKey: ["/api/material-families"] });
        void qc.invalidateQueries({ queryKey: ["/api/material-reorder-requests"] });
      }
      toast({ title: "Items received" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" })
  });
}
