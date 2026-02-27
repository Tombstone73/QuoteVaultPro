import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

export type ProductionLineItemStatusRule = {
  id: string;
  label: string;
  color?: string | null;
  sendToProduction?: boolean;
  stationKey?: string | null;
  stepKey?: string | null;
  sortOrder?: number | null;
  // Back-compat
  key?: string | null;
  defaultStepKey?: string | null;
};

export type ProductionStation = {
  key: string;
  name: string;
  sort: number;
};

export type ProductionManagedStep = {
  key: string;
  label: string;
  active: boolean;
};

export type ProductionManagedStepsByStation = Record<string, ProductionManagedStep[]>;

export function useProductionLineItemStatusRules() {
  return useQuery<ProductionLineItemStatusRule[]>({
    queryKey: ["/api/production/settings/line-item-statuses"],
    queryFn: async () => {
      const res = await fetch("/api/production/settings/line-item-statuses", { credentials: "include" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || json.message || "Failed to fetch production settings");
      return (json.data ?? []) as ProductionLineItemStatusRule[];
    },
  });
}

export function useSaveProductionLineItemStatusRules() {
  const qc = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (rules: ProductionLineItemStatusRule[]) => {
      const res = await fetch("/api/production/settings/line-item-statuses", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(rules),
        credentials: "include",
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || json.message || "Failed to save production settings");
      return (json.data ?? []) as ProductionLineItemStatusRule[];
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/production/settings/line-item-statuses"] });
      toast({ title: "Production settings saved" });
    },
    onError: (e: Error) => {
      toast({ title: "Save failed", description: e.message, variant: "destructive" });
    },
  });
}

export function useProductionStations() {
  return useQuery<ProductionStation[]>({
    queryKey: ["/api/production/stations"],
    queryFn: async () => {
      const res = await fetch("/api/production/stations", { credentials: "include" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || json.message || "Failed to fetch stations");
      return (json.data ?? []) as ProductionStation[];
    },
  });
}

export function useProductionStationSteps() {
  return useQuery<ProductionManagedStepsByStation>({
    queryKey: ["/api/production/steps"],
    queryFn: async () => {
      const res = await fetch("/api/production/steps", { credentials: "include" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || json.message || "Failed to fetch production steps");
      return (json.data ?? {}) as ProductionManagedStepsByStation;
    },
  });
}

export function useCreateProductionStep() {
  const qc = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (payload: { stationKey: string; label: string; key?: string | null }) => {
      const res = await fetch("/api/production/steps", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        credentials: "include",
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || json.message || "Failed to create production step");
      return (json.data ?? {}) as ProductionManagedStepsByStation;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/production/steps"] });
      toast({ title: "Step created" });
    },
    onError: (e: Error) => {
      toast({ title: "Create failed", description: e.message, variant: "destructive" });
    },
  });
}

export function useUpdateProductionStep() {
  const qc = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (payload: {
      stationKey: string;
      key: string;
      label?: string;
      active?: boolean;
    }) => {
      const { stationKey, key, ...body } = payload;
      const res = await fetch(`/api/production/steps/${encodeURIComponent(stationKey)}/${encodeURIComponent(key)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        credentials: "include",
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || json.message || "Failed to update production step");
      return (json.data ?? {}) as ProductionManagedStepsByStation;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/production/steps"] });
      toast({ title: "Step updated" });
    },
    onError: (e: Error) => {
      toast({ title: "Update failed", description: e.message, variant: "destructive" });
    },
  });
}
