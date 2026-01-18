import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

export type ProductionConfig = {
  enabledViews: string[];
  defaultView: string;
};

export type ProductionTimerSummary = {
  isRunning: boolean;
  runningSince: string | null;
  currentSeconds: number;
};

export type ProductionOrderLineItemSummary = {
  id: string;
  description: string;
  quantity: number;
  width: string | null;
  height: string | null;
  materialId: string | null;
  materialName: string | null;
  productType: string;
  status: string;
};

export type ProductionOrderArtworkSummary = {
  id: string;
  orderLineItemId: string | null;
  fileName: string;
  fileUrl: string;
  thumbKey: string | null;
  previewKey: string | null;
  thumbnailUrl: string | null;
  side: string;
  isPrimary: boolean;
  thumbStatus: string | null;
};

export type ProductionJobListItem = {
  id: string;
  view: string;
  status: "queued" | "in_progress" | "done";
  startedAt: string | null;
  completedAt: string | null;
  totalSeconds: number;
  timer: ProductionTimerSummary;
  reprintCount: number;
  order: {
    id: string;
    orderNumber: string;
    customerName: string;
    dueDate: string | null;
    priority: string;
    lineItems?: {
      count: number;
      totalQuantity: number;
      primary: ProductionOrderLineItemSummary | null;
      items: ProductionOrderLineItemSummary[];
    };
    artwork?: ProductionOrderArtworkSummary[];
  };
  createdAt: string;
  updatedAt: string;
};

export type ProductionEvent = {
  id: string;
  type: "timer_started" | "timer_stopped" | "note" | "reprint_incremented" | "media_used_set";
  payload: any;
  createdAt: string;
};

export type ProductionJobDetail = Omit<ProductionJobListItem, "view"> & {
  events: ProductionEvent[];
};

export function useProductionConfig() {
  return useQuery<ProductionConfig>({
    queryKey: ["/api/production/config"],
    queryFn: async () => {
      const res = await fetch("/api/production/config", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch production config");
      const json = await res.json();
      return json.data;
    },
  });
}

export function useProductionJobs(filters: { status?: string; view?: string }) {
  return useQuery<ProductionJobListItem[]>({
    queryKey: ["/api/production/jobs", filters],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filters.status) params.set("status", filters.status);
      if (filters.view) params.set("view", filters.view);
      const url = `/api/production/jobs${params.toString() ? `?${params.toString()}` : ""}`;
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch production jobs");
      const json = await res.json();
      return json.data || [];
    },
  });
}

export function useProductionJob(jobId: string | undefined) {
  return useQuery<ProductionJobDetail>({
    queryKey: ["/api/production/jobs", jobId],
    queryFn: async () => {
      if (!jobId) throw new Error("jobId required");
      const res = await fetch(`/api/production/jobs/${jobId}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch production job");
      const json = await res.json();
      return json.data;
    },
    enabled: !!jobId,
  });
}

export function useCreateProductionJobFromOrder() {
  const qc = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (orderId: string) => {
      const res = await fetch(`/api/production/jobs/from-order/${orderId}`, {
        method: "POST",
        credentials: "include",
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Failed to create production job");
      return json.data as { id: string; orderId: string; status: string };
    },
    onSuccess: (_data, orderId) => {
      qc.invalidateQueries({ queryKey: ["/api/production/jobs"] });
      toast({ title: "Production job ready" });
      qc.invalidateQueries({ queryKey: ["/api/orders", orderId] as any });
    },
    onError: (e: Error) => {
      toast({ title: "Create job failed", description: e.message, variant: "destructive" });
    },
  });
}

function invalidateProduction(qc: ReturnType<typeof useQueryClient>, jobId?: string) {
  qc.invalidateQueries({ queryKey: ["/api/production/jobs"] });
  if (jobId) qc.invalidateQueries({ queryKey: ["/api/production/jobs", jobId] });
}

export function useStartProductionTimer(jobId: string) {
  const qc = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/production/jobs/${jobId}/start`, {
        method: "POST",
        credentials: "include",
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Failed to start timer");
      return json.data;
    },
    onSuccess: () => {
      invalidateProduction(qc, jobId);
      toast({ title: "Timer started" });
    },
    onError: (e: Error) => {
      toast({ title: "Start failed", description: e.message, variant: "destructive" });
    },
  });
}

export function useStopProductionTimer(jobId: string) {
  const qc = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/production/jobs/${jobId}/stop`, {
        method: "POST",
        credentials: "include",
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Failed to stop timer");
      return json.data;
    },
    onSuccess: () => {
      invalidateProduction(qc, jobId);
      toast({ title: "Timer stopped" });
    },
    onError: (e: Error) => {
      toast({ title: "Stop failed", description: e.message, variant: "destructive" });
    },
  });
}

export function useCompleteProductionJob(jobId: string) {
  const qc = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (opts?: { skipProduction?: boolean }) => {
      const res = await fetch(`/api/production/jobs/${jobId}/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ skipProduction: opts?.skipProduction === true }),
        credentials: "include",
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Failed to complete job");
      return json.data;
    },
    onSuccess: () => {
      invalidateProduction(qc, jobId);
      toast({ title: "Job completed" });
    },
    onError: (e: Error) => {
      toast({ title: "Complete failed", description: e.message, variant: "destructive" });
    },
  });
}

export function useReopenProductionJob(jobId: string) {
  const qc = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/production/jobs/${jobId}/reopen`, {
        method: "POST",
        credentials: "include",
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Failed to reopen job");
      return json.data;
    },
    onSuccess: () => {
      invalidateProduction(qc, jobId);
      toast({ title: "Job reopened" });
    },
    onError: (e: Error) => {
      toast({ title: "Reopen failed", description: e.message, variant: "destructive" });
    },
  });
}

export function useReprintProductionJob(jobId: string) {
  const qc = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/production/jobs/${jobId}/reprint`, {
        method: "POST",
        credentials: "include",
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Failed to record reprint");
      return json.data;
    },
    onSuccess: () => {
      invalidateProduction(qc, jobId);
      toast({ title: "Reprint recorded" });
    },
    onError: (e: Error) => {
      toast({ title: "Reprint failed", description: e.message, variant: "destructive" });
    },
  });
}

export function useSetProductionMediaUsed(jobId: string) {
  const qc = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (data: { text: string; qty?: number; unit?: string }) => {
      const res = await fetch(`/api/production/jobs/${jobId}/media-used`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
        credentials: "include",
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Failed to set media used");
      return json.data;
    },
    onSuccess: () => {
      invalidateProduction(qc, jobId);
      toast({ title: "Media used saved" });
    },
    onError: (e: Error) => {
      toast({ title: "Save failed", description: e.message, variant: "destructive" });
    },
  });
}

export function useAddProductionNote(jobId: string) {
  const qc = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (text: string) => {
      const res = await fetch(`/api/production/jobs/${jobId}/note`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
        credentials: "include",
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Failed to add note");
      return json.data;
    },
    onSuccess: () => {
      invalidateProduction(qc, jobId);
      toast({ title: "Note added" });
    },
    onError: (e: Error) => {
      toast({ title: "Note failed", description: e.message, variant: "destructive" });
    },
  });
}
