import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

export interface Material {
  id: string;
  name: string;
  sku: string;
  type: "sheet" | "roll" | "ink" | "consumable";
  unitOfMeasure: string;
  width?: string | null;
  height?: string | null;
  thickness?: string | null;
  thicknessUnit?: "in" | "mm" | "mil" | "gauge" | null;
  color?: string | null;
  costPerUnit: string;
  stockQuantity: string;
  minStockAlert: string;
  vendorId?: string | null; // legacy placeholder
  preferredVendorId?: string | null;
  vendorSku?: string | null;
  vendorCostPerUnit?: string | null;
  specsJson?: Record<string, any> | null;
  createdAt: string;
  updatedAt: string;
}

export interface InventoryAdjustment {
  id: string;
  materialId: string;
  type: string;
  quantityChange: string;
  reason?: string | null;
  orderId?: string | null;
  userId: string;
  createdAt: string;
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
}

export function useMaterials(filters?: MaterialFilters) {
  return useQuery<Material[]>({
    queryKey: ["/api/materials", filters],
    queryFn: async () => {
      const response = await fetch("/api/materials", { credentials: "include" });
      if (!response.ok) throw new Error("Failed to fetch materials");
      const json = await response.json();
      const list: Material[] = json.success ? json.data : json;
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
            if (!(stock < min)) return false;
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
    mutationFn: async (data: { type: string; quantityChange: number; reason?: string }) => {
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
      toast({ title: "Inventory adjusted" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });
}
