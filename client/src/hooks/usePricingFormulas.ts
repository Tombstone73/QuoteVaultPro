import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

export interface PricingFormula {
  id: string;
  organizationId: string;
  name: string;
  code: string;
  description: string | null;
  pricingProfileKey: string;
  expression: string | null;
  config: Record<string, unknown> | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PricingFormulaInput {
  name: string;
  code: string;
  description?: string | null;
  pricingProfileKey?: string;
  expression?: string | null;
  config?: Record<string, unknown> | null;
  isActive?: boolean;
}

export function usePricingFormulas() {
  return useQuery<PricingFormula[]>({
    queryKey: ["/api/pricing-formulas"],
    queryFn: async () => {
      const response = await fetch("/api/pricing-formulas", {
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to fetch pricing formulas");
      return response.json();
    },
  });
}

export function usePricingFormula(id: string | undefined) {
  return useQuery<PricingFormula>({
    queryKey: ["/api/pricing-formulas", id],
    queryFn: async () => {
      const response = await fetch(`/api/pricing-formulas/${id}`, {
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to fetch pricing formula");
      return response.json();
    },
    enabled: !!id,
  });
}

export function usePricingFormulaWithProducts(id: string | undefined) {
  return useQuery<{ formula: PricingFormula; products: unknown[] }>({
    queryKey: ["/api/pricing-formulas", id, "products"],
    queryFn: async () => {
      const response = await fetch(`/api/pricing-formulas/${id}/products`, {
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to fetch pricing formula with products");
      return response.json();
    },
    enabled: !!id,
  });
}

export function useCreatePricingFormula() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (data: PricingFormulaInput) => {
      const response = await fetch("/api/pricing-formulas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(data),
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to create pricing formula");
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/pricing-formulas"] });
      toast({ title: "Pricing formula created" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });
}

export function useUpdatePricingFormula() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<PricingFormulaInput> }) => {
      const response = await fetch(`/api/pricing-formulas/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(data),
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to update pricing formula");
      }
      return response.json();
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/pricing-formulas"] });
      queryClient.invalidateQueries({ queryKey: ["/api/pricing-formulas", variables.id] });
      toast({ title: "Pricing formula updated" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });
}

export function useDeletePricingFormula() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (id: string) => {
      const response = await fetch(`/api/pricing-formulas/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to delete pricing formula");
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/pricing-formulas"] });
      toast({ title: "Pricing formula deleted" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });
}
