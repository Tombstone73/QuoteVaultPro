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
