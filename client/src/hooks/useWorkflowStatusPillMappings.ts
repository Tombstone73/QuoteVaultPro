import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useToast } from "@/hooks/use-toast";
import type {
  WorkflowStatusPillAssignmentSource,
  WorkflowStatusPillTrigger,
} from "@shared/orderStatusWorkflowAutomation";

export type WorkflowStatusPillMapping = {
  id: string;
  organizationId: string;
  triggerKey: WorkflowStatusPillTrigger;
  targetStatusKey: string;
  source: WorkflowStatusPillAssignmentSource;
  isActive: boolean;
  overwriteExceptionStatus: boolean;
  createdAt: string;
  updatedAt: string;
};

export const workflowStatusPillMappingsQueryKey = ["/api/settings/workflow-status-pill-mappings"] as const;

export function useWorkflowStatusPillMappings() {
  return useQuery<WorkflowStatusPillMapping[]>({
    queryKey: workflowStatusPillMappingsQueryKey,
    queryFn: async () => {
      const response = await fetch("/api/settings/workflow-status-pill-mappings", { credentials: "include" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message || "Failed to load workflow status automation");
      return payload.data || payload.mappings || [];
    },
    staleTime: 5 * 60 * 1000,
  });
}

export function useUpdateWorkflowStatusPillMapping() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async ({
      triggerKey,
      updates,
    }: {
      triggerKey: WorkflowStatusPillTrigger;
      updates: {
        targetStatusKey: string;
        source: WorkflowStatusPillAssignmentSource;
        isActive: boolean;
        overwriteExceptionStatus: boolean;
      };
    }) => {
      const response = await fetch(`/api/settings/workflow-status-pill-mappings/${triggerKey}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(updates),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message || "Failed to update workflow status automation");
      return payload.data as WorkflowStatusPillMapping;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: workflowStatusPillMappingsQueryKey });
      toast({ title: "Automation updated", description: "The workflow status mapping has been saved." });
    },
    onError: (error: Error) => {
      toast({ title: "Update failed", description: error.message, variant: "destructive" });
    },
  });
}
