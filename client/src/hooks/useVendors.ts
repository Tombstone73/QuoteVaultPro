import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

export interface Vendor {
  id: string;
  name: string;
  email?: string | null;
  phone?: string | null;
  website?: string | null;
  notes?: string | null;
  paymentTerms: string;
  defaultLeadTimeDays?: number | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

interface VendorFilters {
  search?: string;
  isActive?: boolean;
  page?: number;
  pageSize?: number;
}

function parseResponse<T>(res: Response): Promise<T> {
  return res.json().then(json => (json && json.success ? json.data : json));
}

export function useVendors(filters?: VendorFilters) {
  return useQuery<Vendor[]>({
    queryKey: ["/api/vendors", filters],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filters?.search) params.set("search", filters.search);
      if (typeof filters?.isActive === "boolean") params.set("isActive", String(filters.isActive));
      if (filters?.page) params.set("page", String(filters.page));
      if (filters?.pageSize) params.set("pageSize", String(filters.pageSize));
      const url = `/api/vendors${params.toString() ? `?${params.toString()}` : ""}`;
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch vendors");
      return parseResponse<Vendor[]>(res);
    }
  });
}

export function useVendor(id: string | undefined) {
  return useQuery<Vendor>({
    queryKey: ["/api/vendors", id],
    enabled: !!id,
    queryFn: async () => {
      if (!id) throw new Error("Vendor ID required");
      const res = await fetch(`/api/vendors/${id}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch vendor");
      return parseResponse<Vendor>(res);
    }
  });
}

export function useCreateVendor() {
  const qc = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (data: Partial<Vendor>) => {
      const res = await fetch("/api/vendors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(data)
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to create vendor");
      return json.success ? json.data : json;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/vendors"] });
      toast({ title: "Vendor created" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" })
  });
}

export function useUpdateVendor(id: string) {
  const qc = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (data: Partial<Vendor>) => {
      const res = await fetch(`/api/vendors/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(data)
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to update vendor");
      return json.success ? json.data : json;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/vendors"] });
      qc.invalidateQueries({ queryKey: ["/api/vendors", id] });
      toast({ title: "Vendor updated" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" })
  });
}

export function useDeleteVendor() {
  const qc = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/vendors/${id}`, { method: "DELETE", credentials: "include" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to delete vendor");
      return json;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/vendors"] });
      toast({ title: "Vendor removed" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" })
  });
}
