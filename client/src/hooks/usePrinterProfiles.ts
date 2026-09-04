import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

export type PrinterProfileType = "production_ticket" | "shipping_label" | "office_document" | "other";

export interface PrinterProfile {
  id: string;
  organizationId: string;
  displayName: string;
  printerType: PrinterProfileType;
  intendedUse: string;
  stationRoute?: string | null;
  location?: string | null;
  windowsQueueName?: string | null;
  printAgentId?: string | null;
  supportedDocuments?: string[];
  defaultCopies?: number;
  trailingFeedMm?: string | number;
  scope: "organization";
  isActive: boolean;
  isDefault: boolean;
  lastUsedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PrinterProfileInput {
  displayName: string;
  printerType: PrinterProfileType;
  intendedUse: string;
  stationRoute?: string | null;
  location?: string | null;
  windowsQueueName?: string | null;
  printAgentId?: string | null;
  supportedDocuments?: string[];
  defaultCopies?: number;
  trailingFeedMm?: number;
  scope?: "organization";
  isActive: boolean;
  isDefault: boolean;
}

function unwrap<T>(json: any): T {
  return json?.success ? json.data : json;
}

async function readJson<T>(res: Response, fallback: string): Promise<T> {
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || json.message || fallback);
  return unwrap<T>(json);
}

export function usePrinterProfiles(filters: { active?: boolean; intendedUse?: string; printerType?: string } = {}) {
  return useQuery<PrinterProfile[]>({
    queryKey: ["/api/printer-profiles", filters],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filters.active !== undefined) params.set("active", String(filters.active));
      if (filters.intendedUse) params.set("intendedUse", filters.intendedUse);
      if (filters.printerType) params.set("printerType", filters.printerType);
      const res = await fetch(`/api/printer-profiles${params.toString() ? `?${params.toString()}` : ""}`, { credentials: "include" });
      return readJson<PrinterProfile[]>(res, "Failed to load printer profiles");
    },
  });
}

export function useCreatePrinterProfile() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (input: PrinterProfileInput) => {
      const res = await fetch("/api/printer-profiles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(input),
      });
      return readJson<PrinterProfile>(res, "Failed to create printer profile");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/printer-profiles"] });
      toast({ title: "Printer profile saved" });
    },
    onError: (error: Error) => toast({ title: "Printer profile failed", description: error.message, variant: "destructive" }),
  });
}

export function useUpdatePrinterProfile(id: string) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (input: Partial<PrinterProfileInput>) => {
      const res = await fetch(`/api/printer-profiles/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(input),
      });
      return readJson<PrinterProfile>(res, "Failed to update printer profile");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/printer-profiles"] });
      toast({ title: "Printer profile updated" });
    },
    onError: (error: Error) => toast({ title: "Printer profile failed", description: error.message, variant: "destructive" }),
  });
}

export function useSetDefaultPrinterProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/printer-profiles/${id}/default`, { method: "POST", credentials: "include" });
      return readJson<PrinterProfile>(res, "Failed to set default printer profile");
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/printer-profiles"] }),
  });
}

export function useDeactivatePrinterProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/printer-profiles/${id}/deactivate`, { method: "POST", credentials: "include" });
      return readJson<PrinterProfile>(res, "Failed to deactivate printer profile");
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/printer-profiles"] }),
  });
}

export function useDeletePrinterProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/printer-profiles/${id}`, { method: "DELETE", credentials: "include" });
      return readJson<{ deleted: boolean }>(res, "Failed to delete printer profile");
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/printer-profiles"] }),
  });
}

export async function markPrinterProfileUsed(id: string) {
  await fetch(`/api/printer-profiles/${id}/used`, { method: "POST", credentials: "include" }).catch(() => undefined);
}
