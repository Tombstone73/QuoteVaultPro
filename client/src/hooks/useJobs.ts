import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

export type Job = {
  id: string;
  orderId: string | null;
  orderLineItemId: string;
  productType: string;
  status: string;
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
  oldStatus: string | null;
  newStatus: string;
  userId: string | null;
  createdAt: string;
};

export type JobWithRelations = Job & {
  order?: any | null;
  orderLineItem?: any | null;
  notesLog?: JobNote[];
  statusLog?: JobStatusLog[];
};

const STATUS_VALUES = [
  'pending_prepress',
  'prepress',
  'queued_production',
  'in_production',
  'finishing',
  'qc',
  'complete'
];

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
    mutationFn: async (data: { status?: string; assignedTo?: string; notes?: string }) => {
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

export { STATUS_VALUES };
