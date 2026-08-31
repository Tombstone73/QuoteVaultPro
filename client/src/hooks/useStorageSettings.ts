import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  ConfigurableStorageProviderType,
  CustomerProductionDestinationViewStatus,
  LocalFilesystemStorageProviderConfig,
  OrganizationStorageProfileViewStatus,
  S3CompatibleStorageProviderConfig,
  StorageProviderActivationInput,
  StorageProviderDraftSaveInput,
  StorageProviderViewStatus,
  StorageSettingsMode,
  StorageSettingsSaveInput,
  StorageSettingsSaveRequest,
  StorageSettingsValidateRequest,
  SupabaseStorageProviderConfig,
  TitanManagedRoutingMode,
} from "@shared/storageSettings";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

export type StorageProviderFieldName = "displayName" | "bucketName" | "pathPrefix" | "subfolderPrefix" | "region" | "endpoint" | "accessKeyId" | "secretAccessKey" | "forcePathStyle" | "providerLabel";

type OrchestrationValidationSummary = {
  kind: "orchestration";
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

type ProviderValidationSummary = {
  kind: "provider";
  valid: boolean;
  error: string | null;
  warnings: string[];
  validatedAt: string;
  runtimeSupported: boolean;
  canActivate: boolean;
  providerType: ConfigurableStorageProviderType;
  fieldErrors?: Partial<Record<StorageProviderFieldName, string>>;
};

export type StorageValidationSummary = OrchestrationValidationSummary | ProviderValidationSummary;

type BaseStorageProviderView = {
  id: string;
  displayName: string;
  status: StorageProviderViewStatus;
  persistedStatus: string;
  role: string;
  lastValidatedAt: string | null;
  validationError: string | null;
  runtimeSupported: boolean;
  canActivate: boolean;
  isActive: boolean;
};

export type StorageProviderView =
  | (BaseStorageProviderView & {
      providerType: "supabase";
      config: { providerType: "supabase" } & SupabaseStorageProviderConfig;
    })
  | (BaseStorageProviderView & {
      providerType: "local_filesystem";
      config: { providerType: "local_filesystem" } & LocalFilesystemStorageProviderConfig;
    })
  | (BaseStorageProviderView & {
      providerType: "s3";
      config: { providerType: "s3" } & Omit<S3CompatibleStorageProviderConfig, "secretAccessKey">;
    });

export type StorageRuntimeMode = "titan_managed" | "byos_cloud" | "byos_local" | "hybrid" | "disabled";

export type OrganizationStorageSettingsView = {
  profile: {
    id: string | null;
    mode: StorageRuntimeMode;
    status: OrganizationStorageProfileViewStatus;
    persistedStatus: string | null;
    updatedAt: string | null;
    activeProviderConfigId: string | null;
  };
  orchestration: {
    id: string | null;
    displayName: string;
    config: {
      routingMode: TitanManagedRoutingMode;
      maxCloudUploadBytesOverride?: number | null;
      maxDurableUploadBytesOverride?: number | null;
    };
    lastValidatedAt: string | null;
    validationError: string | null;
    validation: OrchestrationValidationSummary | null;
  };
  providers: StorageProviderView[];
  activeProvider: StorageProviderView | null;
  productionDestinations: {
    status: CustomerProductionDestinationViewStatus;
    totalCustomers: number;
    setCount: number;
    invalidCount: number;
    disabledCount: number;
  };
};

export type OrchestrationPayload = StorageSettingsSaveInput;
export type ProviderDraftPayload = StorageProviderDraftSaveInput;

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

function getValidationMessage(validation: StorageValidationSummary): string {
  if (validation.error?.trim()) {
    return validation.error.trim();
  }

  if (validation.kind === "provider") {
    const firstFieldError = Object.values(validation.fieldErrors ?? {}).find((value) => typeof value === "string" && value.trim());
    if (firstFieldError) {
      return firstFieldError;
    }
  }

  return validation.valid
    ? "The draft validated successfully. Save it when ready."
    : "Review the validation details before saving.";
}

export function useStorageSettings() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [draftValidation, setDraftValidation] = useState<StorageValidationSummary | null>(null);
  const storageSettingsKey = "/api/settings/storage";

  const query = useQuery<OrganizationStorageSettingsView>({
    queryKey: [storageSettingsKey],
    queryFn: async () => {
      const response = await apiRequest("GET", storageSettingsKey);
      return unwrapEnvelope<OrganizationStorageSettingsView>(response);
    },
  });

  const validateMutation = useMutation({
    mutationFn: async (payload: StorageSettingsValidateRequest) => {
      const response = await apiRequest("POST", `${storageSettingsKey}/validate`, payload);
      return unwrapEnvelope<StorageValidationSummary>(response);
    },
    onSuccess: (validation) => {
      setDraftValidation(validation);
      toast({
        title: validation.valid ? "Draft validated" : "Draft needs attention",
        description: getValidationMessage(validation),
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
    mutationFn: async (payload: StorageSettingsSaveRequest) => {
      const response = await apiRequest("PUT", storageSettingsKey, payload);
      return unwrapEnvelope<OrganizationStorageSettingsView>(response);
    },
    onSuccess: async (settings, payload) => {
      setDraftValidation(payload.kind === "orchestration" ? settings.orchestration.validation : null);
      await queryClient.invalidateQueries({ queryKey: [storageSettingsKey] });
      toast({
        title: payload.kind === "orchestration" ? "Orchestration settings saved" : "Provider draft saved",
        description: payload.kind === "orchestration"
          ? "Saved orchestration controls are available for runtime routing."
          : "The provider record was saved. Activate it separately when ready.",
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

  const activateMutation = useMutation({
    mutationFn: async (payload: StorageProviderActivationInput) => {
      const response = await apiRequest("POST", `${storageSettingsKey}/activate`, payload);
      return unwrapEnvelope<OrganizationStorageSettingsView>(response);
    },
    onSuccess: async () => {
      setDraftValidation(null);
      await queryClient.invalidateQueries({ queryKey: [storageSettingsKey] });
      toast({
        title: "Provider activated",
        description: "The selected provider is now the active runtime storage target.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to activate provider",
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
    validateRequest: validateMutation.mutateAsync,
    isValidating: validateMutation.isPending,
    saveRequest: saveMutation.mutateAsync,
    isSaving: saveMutation.isPending,
    activateProvider: activateMutation.mutateAsync,
    isActivating: activateMutation.isPending,
  };
}
