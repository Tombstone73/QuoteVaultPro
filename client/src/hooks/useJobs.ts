import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

export type JobStatus = {
  id: string;
  key: string;
  label: string;
  position: number;
  badgeVariant: string;
  isDefault: boolean;
};

export type Job = {
  id: string;
  orderId: string | null;
  orderLineItemId: string;
  productType: string;
  statusKey: string; // Renamed from status
  priority?: string; // present on schema
  specsJson?: any;
  assignedToUserId: string | null;
  notesInternal: string | null;
  createdAt: string;
  updatedAt: string;
};

export type JobNote = {
  id: string;
  jobId: string;
  userId: string | null;
  noteText: string;
  createdAt: string;
};

export type JobStatusLog = {
  id: string;
  jobId: string;
  oldStatusKey: string | null;
  newStatusKey: string;
  userId: string | null;
  createdAt: string;
};

export type JobWithRelations = Job & {
  order?: any | null;
  orderLineItem?: any | null;
  notesLog?: JobNote[];
  statusLog?: JobStatusLog[];
};

export function useJobStatuses() {
  return useQuery<JobStatus[]>({
    queryKey: ["/api/settings/job-statuses"],
    queryFn: async () => {
      const res = await fetch("/api/settings/job-statuses", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch job statuses");
      const json = await res.json();
      return json.data || [];
    },
  });
}

export function useCreateJobStatus() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (data: Partial<JobStatus>) => {
      const res = await fetch("/api/settings/job-statuses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to create status");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings/job-statuses"] });
      toast({ title: "Status created" });
    },
  });
}

export function useUpdateJobStatus(id: string) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (data: Partial<JobStatus>) => {
      const res = await fetch(`/api/settings/job-statuses/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to update status");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings/job-statuses"] });
      toast({ title: "Status updated" });
    },
  });
}

export function useDeleteJobStatus(id: string) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/settings/job-statuses/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed to delete status");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings/job-statuses"] });
      toast({ title: "Status deleted" });
    },
  });
}

export function useJobs(filters?: { status?: string; assignedToUserId?: string; orderId?: string }) {
  return useQuery<JobWithRelations[]>({
    queryKey: ["/api/jobs", filters],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filters?.status) params.set("status", filters.status);
      if (filters?.assignedToUserId) params.set("assignedToUserId", filters.assignedToUserId);
      if (filters?.orderId) params.set("orderId", filters.orderId);
      const url = `/api/jobs${params.toString() ? `?${params.toString()}` : ""}`;
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch jobs");
      const json = await res.json();
      return json.data || [];
    },
  });
}

export function useJob(id: string | undefined) {
  return useQuery<JobWithRelations>({
    queryKey: ["/api/jobs", id],
    queryFn: async () => {
      if (!id) throw new Error("Job ID required");
      const res = await fetch(`/api/jobs/${id}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch job");
      const json = await res.json();
      return json.data;
    },
    enabled: !!id,
  });
}

export function useUpdateJob(id: string) {
  const qc = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (data: { statusKey?: string; assignedToUserId?: string; assignedTo?: string; notes?: string }) => {
      const res = await fetch(`/api/jobs/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
        credentials: 'include',
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || 'Failed to update job');
      }
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/jobs"] });
      qc.invalidateQueries({ queryKey: ["/api/jobs", id] });
      toast({ title: 'Job Updated', description: 'Changes saved.' });
    },
    onError: (e: Error) => {
      toast({ title: 'Job Update Failed', description: e.message, variant: 'destructive' });
    }
  });
}

export function useAddJobNote(id: string) {
  const qc = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (noteText: string) => {
      const res = await fetch(`/api/jobs/${id}/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ noteText }),
        credentials: 'include',
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || 'Failed to add note');
      }
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/jobs", id] });
      toast({ title: 'Note Added', description: 'Job note appended.' });
    },
    onError: (e: Error) => {
      toast({ title: 'Add Note Failed', description: e.message, variant: 'destructive' });
    }
  });
}

export function useAssignJob(id: string) {
  const update = useUpdateJob(id);
  return {
    assign: (userId: string) => update.mutate({ assignedTo: userId }),
    ...update,
  };
}


