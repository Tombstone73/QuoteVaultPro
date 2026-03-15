import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  CustomerProductionDestinationViewStatus,
  OrganizationStorageProfileViewStatus,
  StorageProviderViewStatus,
  StorageSettingsMode,
  TitanManagedRoutingMode,
} from "@shared/storageSettings";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

type StorageValidationSummary = {
  valid: boolean;
  error: string | null;
  warnings: string[];
  validatedAt: string;
  preview: {
    routingMode: TitanManagedRoutingMode;
    maxCloudUploadBytes: number;
    smallFileTarget: "supabase" | "local_dev";
    largeFileTarget: "supabase" | "local_dev";
    supabaseConfigured: boolean;
  };
};

export type OrganizationStorageSettingsView = {
  profile: {
    id: string | null;
    mode: StorageSettingsMode;
    status: OrganizationStorageProfileViewStatus;
    persistedStatus: string | null;
    updatedAt: string | null;
  };
  provider: {
    id: string | null;
    providerType: "titan_managed";
    displayName: string;
    status: StorageProviderViewStatus;
    persistedStatus: string | null;
    config: {
      routingMode: TitanManagedRoutingMode;
      maxCloudUploadBytesOverride?: number | null;
    };
    lastValidatedAt: string | null;
    validationError: string | null;
    isRuntimeActive: boolean;
  };
  validation: StorageValidationSummary | null;
  productionDestinations: {
    status: CustomerProductionDestinationViewStatus;
    totalCustomers: number;
    setCount: number;
    invalidCount: number;
    disabledCount: number;
  };
};

export type StorageSettingsPayload = {
  mode: StorageSettingsMode;
  providerType: "titan_managed";
  displayName: string;
  activate?: boolean;
  config: {
    routingMode: TitanManagedRoutingMode;
    maxCloudUploadBytesOverride?: number | null;
  };
};

type Envelope<T> = {
  success: boolean;
  data: T;
  error?: string;
};

async function unwrapEnvelope<T>(response: Response): Promise<T> {
  const payload = (await response.json()) as Envelope<T>;
  if (!payload.success) {
    throw new Error(payload.error || "Request failed");
  }
  return payload.data;
}

export function useStorageSettings() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [draftValidation, setDraftValidation] = useState<StorageValidationSummary | null>(null);

  const query = useQuery<OrganizationStorageSettingsView>({
    queryKey: ["/api/admin/storage-settings"],
    queryFn: async () => {
      const response = await apiRequest("GET", "/api/admin/storage-settings");
      return unwrapEnvelope<OrganizationStorageSettingsView>(response);
    },
  });

  const validateMutation = useMutation({
    mutationFn: async (payload: StorageSettingsPayload) => {
      const response = await apiRequest("POST", "/api/admin/storage-settings/validate", payload);
      return unwrapEnvelope<StorageValidationSummary>(response);
    },
    onSuccess: (validation) => {
      setDraftValidation(validation);
      toast({
        title: validation.valid ? "Storage draft validated" : "Storage draft needs attention",
        description: validation.valid
          ? "The draft configuration is valid. Runtime behavior will not change until you save it."
          : validation.error || "Review the validation details before saving.",
        variant: validation.valid ? "default" : "destructive",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Validation failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const saveMutation = useMutation({
    mutationFn: async (payload: StorageSettingsPayload) => {
      const response = await apiRequest("PUT", "/api/admin/storage-settings", payload);
      return unwrapEnvelope<OrganizationStorageSettingsView>(response);
    },
    onSuccess: async (settings) => {
      setDraftValidation(settings.validation);
      await queryClient.invalidateQueries({ queryKey: ["/api/admin/storage-settings"] });
      toast({
        title: "Storage settings saved",
        description: settings.profile.status === "active"
          ? "The saved configuration is now active for runtime routing."
          : "The draft was saved. Runtime behavior still uses the currently active configuration.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to save storage settings",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  return {
    settings: query.data,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    error: query.error,
    refetch: query.refetch,
    draftValidation,
    clearDraftValidation: () => setDraftValidation(null),
    validateDraft: validateMutation.mutateAsync,
    isValidating: validateMutation.isPending,
    saveSettings: saveMutation.mutateAsync,
    isSaving: saveMutation.isPending,
  };
}
