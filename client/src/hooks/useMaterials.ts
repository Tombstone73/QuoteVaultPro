import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useToast } from "@/hooks/use-toast";
import type { MaterialInventoryStatus, MaterialReorderRequestStatus } from "@shared/materialInventory";

export interface Material {
  id: string;
  name: string;
  sku: string;
  type: "sheet" | "roll" | "ink" | "consumable";
  category?: string | null;
  unitOfMeasure: string;
  inventoryUnit?: string | null;
  sellPriceUnit?: string | null;
  wholesalePriceUnit?: string | null;
  vendorCostUnit?: string | null;
  consumptionUnit?: string | null;
  weightValue?: string | null;
  weightUnit?: "oz" | "lb" | "g" | "kg" | null;
  weightBasis?: "each" | "sqft" | "sheet" | "linear_ft" | "roll" | null;
  weightOzPerBasis?: string | null;
  width?: string | null;
  height?: string | null;
  thickness?: string | null;
  thicknessUnit?: "in" | "mm" | "mil" | "gauge" | null;
  color?: string | null;
  costPerUnit: string;
  wholesaleBaseRate?: string | null;
  wholesaleMinCharge?: string | null;
  retailBaseRate?: string | null;
  retailMinCharge?: string | null;
  stockQuantity: string;
  minStockAlert: string;
  isActive: boolean;
  vendorId?: string | null; // legacy placeholder
  preferredVendorId?: string | null;
  preferredVendorName?: string | null;
  vendorSku?: string | null;
  vendorCostPerUnit?: string | null;
  vendorProductUrl?: string | null;
  vendorNotes?: string | null;
  vendorLastPriceCents?: number | null;
  vendorLastPriceUpdatedAt?: string | null;
  specsJson?: Record<string, any> | null;
  aiParsingDescription?: string | null;
  aiParsingDescriptionLinkedToDescription?: boolean | null;
  // Roll-specific fields
  rollLengthFt?: string | null;
  costPerRoll?: string | null;
  edgeWasteInPerSide?: string | null;
  leadWasteFt?: string | null;
  tailWasteFt?: string | null;
  linkedProductIds?: string[];
  createdAt: string;
  updatedAt: string;
}

// Helper function to calculate roll derived values (mirrors shared/schema.ts)
export interface RollDerivedValues {
  grossSqftPerRoll: number;
  usableWidthIn: number;
  usableLengthFt: number;
  usableSqftPerRoll: number;
  costPerSqft: number;
}

export function calculateRollDerivedValues(
  rollWidthIn: number,
  rollLengthFt: number,
  costPerRoll: number,
  edgeWasteInPerSide: number = 0,
  leadWasteFt: number = 0,
  tailWasteFt: number = 0
): RollDerivedValues {
  const grossSqftPerRoll = (rollWidthIn / 12) * rollLengthFt;
  const usableWidthIn = Math.max(0, rollWidthIn - 2 * edgeWasteInPerSide);
  const usableLengthFt = Math.max(0, rollLengthFt - leadWasteFt - tailWasteFt);
  const usableSqftPerRoll = (usableWidthIn / 12) * usableLengthFt;
  const costPerSqft = usableSqftPerRoll > 0 ? costPerRoll / usableSqftPerRoll : 0;

  return {
    grossSqftPerRoll: parseFloat(grossSqftPerRoll.toFixed(2)),
    usableWidthIn: parseFloat(usableWidthIn.toFixed(2)),
    usableLengthFt: parseFloat(usableLengthFt.toFixed(2)),
    usableSqftPerRoll: parseFloat(usableSqftPerRoll.toFixed(2)),
    costPerSqft: parseFloat(costPerSqft.toFixed(4)),
  };
}

export interface InventoryAdjustment {
  id: string;
  organizationId?: string | null;
  movementType?: string | null;
  materialId: string;
  type: string;
  quantityChange: string;
  quantityBefore?: string | null;
  quantityAfter?: string | null;
  reason?: string | null;
  notes?: string | null;
  orderId?: string | null;
  reorderRequestId?: string | null;
  userId: string;
  createdAt: string;
}

export interface MaterialReorderRequest {
  id: string;
  materialId: string;
  materialName: string;
  materialSku?: string | null;
  vendorId?: string | null;
  vendorName?: string | null;
  status: MaterialReorderRequestStatus;
  requestedQuantity: string;
  receivedQuantity?: string | null;
  currentStockQuantity?: string | null;
  currentMaterialQuantity?: string | null;
  minStockAlert?: string | null;
  notes?: string | null;
  requestedByUserId?: string | null;
  requestedByName?: string | null;
  orderedByName?: string | null;
  receivedByName?: string | null;
  cancelledByName?: string | null;
  requestedAt: string;
  orderedAt?: string | null;
  receivedAt?: string | null;
  cancelledAt?: string | null;
}

export interface ManualInventoryAdjustmentRequest {
  adjustmentMode: "set_quantity" | "add_quantity" | "subtract_quantity";
  quantity: number;
  reason: "damage" | "miscount" | "scrap" | "correction" | "received_outside_reorder" | "other";
  otherReason?: string;
  notes?: string;
}

export interface CreateMaterialReorderRequestInput {
  requestedQuantity: number;
  currentStockQuantity?: number | null;
  minStockAlert?: number | null;
  vendorId?: string | null;
  notes?: string;
}

export interface ReceiveMaterialReorderRequestInput {
  receivedQuantity: number;
  notes?: string;
}

export interface MaterialUsage {
  id: string;
  orderId: string;
  orderLineItemId: string;
  materialId: string;
  quantityUsed: string;
  unitOfMeasure: string;
  calculatedBy: string;
  createdAt: string;
}

interface MaterialFilters {
  search?: string;
  type?: string;
  lowStockOnly?: boolean;
  includeInactive?: boolean;
}

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState<T>(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

export interface MaterialSearchItem {
  id: string;
  name: string;
  unitOfMeasure: string;
  inventoryUnit?: string | null;
  sellPriceUnit?: string | null;
  wholesalePriceUnit?: string | null;
  vendorCostUnit?: string | null;
  consumptionUnit?: string | null;
  weightValue?: string | null;
  weightUnit?: "oz" | "lb" | "g" | "kg" | null;
  weightBasis?: "each" | "sqft" | "sheet" | "linear_ft" | "roll" | null;
  weightOzPerBasis?: string | null;
  isActive: boolean;
  linkedProductIds?: string[];
}

export function useMaterialsSearch(searchText: string, options?: { limit?: number; includeInactive?: boolean }) {
  const debouncedSearch = useDebouncedValue(searchText, 250);
  const limit = options?.limit ?? 20;
  const includeInactive = options?.includeInactive ?? false;

  return useQuery<MaterialSearchItem[]>({
    queryKey: ["/api/materials", "search", debouncedSearch, limit, includeInactive],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (debouncedSearch.trim()) params.set("search", debouncedSearch.trim());
      params.set("limit", String(limit));
      if (includeInactive) params.set("includeInactive", "true");

      const response = await fetch(`/api/materials?${params.toString()}`, { credentials: "include" });
      if (!response.ok) throw new Error("Failed to search materials");

      const json = await response.json();
      const payload = json?.success ? json.data : json;
      const list: any[] = Array.isArray(payload) ? payload : Array.isArray(payload?.materials) ? payload.materials : [];

      return list.map((m: any) => ({
        id: String(m.id || ""),
        name: String(m.name || ""),
        unitOfMeasure: String(m.unitOfMeasure || ""),
        inventoryUnit: m.inventoryUnit ?? m.unitOfMeasure ?? null,
        sellPriceUnit: m.sellPriceUnit ?? m.unitOfMeasure ?? null,
        wholesalePriceUnit: m.wholesalePriceUnit ?? m.sellPriceUnit ?? m.unitOfMeasure ?? null,
        vendorCostUnit: m.vendorCostUnit ?? m.unitOfMeasure ?? null,
        consumptionUnit: m.consumptionUnit ?? m.sellPriceUnit ?? m.unitOfMeasure ?? null,
        weightValue: m.weightValue ?? null,
        weightUnit: m.weightUnit ?? null,
        weightBasis: m.weightBasis ?? null,
        weightOzPerBasis: m.weightOzPerBasis ?? null,
        isActive: m?.isActive !== false,
      })).filter((m) => !!m.id && !!m.name);
    },
  });
}

export function useMaterials(filters?: MaterialFilters) {
  return useQuery<Material[]>({
    queryKey: ["/api/materials", filters],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filters?.includeInactive) params.set("includeInactive", "true");

      const url = params.toString() ? `/api/materials?${params.toString()}` : "/api/materials";
      const response = await fetch(url, { credentials: "include" });
      if (!response.ok) throw new Error("Failed to fetch materials");
      const json = await response.json();
      const payload = json?.success ? json.data : json;
      const list: Material[] = Array.isArray(payload) ? payload : Array.isArray(payload?.materials) ? payload.materials : [];
      // Client-side filters until server supports them
      return list.filter(m => {
        if (filters?.search) {
          const s = filters.search.toLowerCase();
          if (!(m.name.toLowerCase().includes(s) || m.sku.toLowerCase().includes(s))) return false;
        }
        if (filters?.type && filters.type !== "all" && m.type !== filters.type) return false;
        if (filters?.lowStockOnly) {
          const stock = parseFloat(m.stockQuantity || "0");
          const min = parseFloat(m.minStockAlert || "0");
            if (!(stock <= min && min > 0)) return false;
        }
        return true;
      });
    },
  });
}

export function useMaterial(id: string | undefined) {
  return useQuery<Material>({
    queryKey: ["/api/materials", id],
    queryFn: async () => {
      if (!id) throw new Error("Material ID required");
      const response = await fetch(`/api/materials/${id}`, { credentials: "include" });
      if (!response.ok) throw new Error("Failed to fetch material");
      const json = await response.json();
      return json.success ? json.data : json;
    },
    enabled: !!id,
  });
}

export function useLowStockAlerts() {
  return useQuery<Material[]>({
    queryKey: ["/api/materials/low-stock"],
    queryFn: async () => {
      const response = await fetch("/api/materials/low-stock", { credentials: "include" });
      if (!response.ok) throw new Error("Failed to fetch low stock alerts");
      const json = await response.json();
      return json.success ? json.data : json;
    },
  });
}

export function useMaterialUsage(materialId: string | undefined) {
  return useQuery<MaterialUsage[]>({
    queryKey: ["/api/materials", materialId, "usage"],
    queryFn: async () => {
      if (!materialId) throw new Error("Material ID required");
      const response = await fetch(`/api/materials/${materialId}/usage`, { credentials: "include" });
      if (!response.ok) throw new Error("Failed to fetch material usage");
      const json = await response.json();
      return json.success ? json.data : json;
    },
    enabled: !!materialId,
  });
}

export function useMaterialAdjustments(materialId: string | undefined) {
  return useQuery<InventoryAdjustment[]>({
    queryKey: ["/api/materials", materialId, "adjustments"],
    queryFn: async () => {
      if (!materialId) throw new Error("Material ID required");
      const response = await fetch(`/api/materials/${materialId}/adjustments`, { credentials: "include" });
      if (!response.ok) throw new Error("Failed to fetch inventory adjustments");
      const json = await response.json();
      return json.success ? json.data : json;
    },
    enabled: !!materialId,
  });
}

export function useMaterialReorderRequests() {
  return useQuery<MaterialReorderRequest[]>({
    queryKey: ["/api/material-reorder-requests"],
    queryFn: async () => {
      const response = await fetch("/api/material-reorder-requests", { credentials: "include" });
      if (!response.ok) throw new Error("Failed to fetch reorder requests");
      const json = await response.json();
      return json.success ? json.data : json;
    },
  });
}

export function useCreateMaterial() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (data: Partial<Material>) => {
      const response = await fetch("/api/materials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(data),
      });
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || "Failed to create material");
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/materials"] });
      queryClient.invalidateQueries({ queryKey: ["/api/materials/low-stock"] });
      toast({ title: "Material created" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });
}

export function useUpdateMaterial(id: string) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (data: Partial<Material>) => {
      const response = await fetch(`/api/materials/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(data),
      });
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || "Failed to update material");
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/materials"] });
      queryClient.invalidateQueries({ queryKey: ["/api/materials", id] });
      queryClient.invalidateQueries({ queryKey: ["/api/materials/low-stock"] });
      toast({ title: "Material updated" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });
}

export function useDeleteMaterial() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (id: string) => {
      const response = await fetch(`/api/materials/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || "Failed to delete material");
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/materials"] });
      queryClient.invalidateQueries({ queryKey: ["/api/materials/low-stock"] });
      toast({ title: "Material deleted" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });
}

export function useAdjustInventory(materialId: string) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (data: ManualInventoryAdjustmentRequest) => {
      const response = await fetch(`/api/materials/${materialId}/adjust`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(data),
      });
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || "Failed to adjust inventory");
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/materials", materialId] });
      queryClient.invalidateQueries({ queryKey: ["/api/materials", materialId, "adjustments"] });
      queryClient.invalidateQueries({ queryKey: ["/api/materials", materialId, "usage"] });
      queryClient.invalidateQueries({ queryKey: ["/api/materials"] });
      queryClient.invalidateQueries({ queryKey: ["/api/materials/low-stock"] });
      queryClient.invalidateQueries({ queryKey: ["/api/material-reorder-requests"] });
      toast({ title: "Inventory adjusted" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });
}

export function useCreateMaterialReorderRequest(materialId: string) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (data: CreateMaterialReorderRequestInput) => {
      const response = await fetch(`/api/materials/${materialId}/reorder-requests`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(data),
      });
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || "Failed to create reorder request");
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/materials"] });
      queryClient.invalidateQueries({ queryKey: ["/api/materials/low-stock"] });
      queryClient.invalidateQueries({ queryKey: ["/api/material-reorder-requests"] });
      toast({ title: "Reorder request created" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });
}

export function useMarkMaterialReorderRequestOrdered() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (reorderRequestId: string) => {
      const response = await fetch(`/api/material-reorder-requests/${reorderRequestId}/mark-ordered`, {
        method: "POST",
        credentials: "include",
      });
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || "Failed to mark reorder request ordered");
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/materials"] });
      queryClient.invalidateQueries({ queryKey: ["/api/material-reorder-requests"] });
      toast({ title: "Reorder request marked ordered" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });
}

export function useCancelMaterialReorderRequest() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (reorderRequestId: string) => {
      const response = await fetch(`/api/material-reorder-requests/${reorderRequestId}/cancel`, {
        method: "POST",
        credentials: "include",
      });
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || "Failed to cancel reorder request");
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/materials"] });
      queryClient.invalidateQueries({ queryKey: ["/api/material-reorder-requests"] });
      toast({ title: "Reorder request cancelled" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });
}

export function useReceiveMaterialReorderRequest() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (args: { reorderRequestId: string; data: ReceiveMaterialReorderRequestInput }) => {
      const response = await fetch(`/api/material-reorder-requests/${args.reorderRequestId}/receive`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(args.data),
      });
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || "Failed to receive reorder request");
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/materials"] });
      queryClient.invalidateQueries({ queryKey: ["/api/materials/low-stock"] });
      queryClient.invalidateQueries({ queryKey: ["/api/material-reorder-requests"] });
      toast({ title: "Reorder request received" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });
}
