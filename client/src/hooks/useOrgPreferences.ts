/**
 * Hook for managing organization preferences
 * Reads/writes to organizations.settings.preferences JSONB field
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "./use-toast";

export interface OrgPreferences {
  quotes?: {
    requireApproval?: boolean;
  };
  orders?: {
    requireDueDateForProduction?: boolean;
    requireBillingAddressForProduction?: boolean;
    requireShippingAddressForProduction?: boolean;
    allowCompletedOrderEdits?: boolean;
  };
}

export function useOrgPreferences() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: preferences, isLoading } = useQuery<OrgPreferences>({
    queryKey: ["/api/organization/preferences"],
    queryFn: async () => {
      const response = await fetch("/api/organization/preferences", {
        credentials: "include",
      });
      if (!response.ok) {
        throw new Error("Failed to fetch preferences");
      }
      return response.json();
    },
  });

  const mutation = useMutation({
    mutationFn: async (newPreferences: OrgPreferences) => {
      const response = await fetch("/api/organization/preferences", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newPreferences),
        credentials: "include",
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to update preferences");
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/organization/preferences"] });
      toast({
        title: "Preferences updated",
        description: "Your changes have been saved",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to update preferences",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  return {
    preferences: preferences || {},
    isLoading,
    updatePreferences: mutation.mutateAsync,
    isUpdating: mutation.isPending,
  };
}
