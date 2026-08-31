import { useEffect, useMemo, useState } from "react";
import type {
  ConfigurableStorageProviderType,
  CustomerProductionDestinationViewStatus,
  OrganizationStorageProfileViewStatus,
  StorageProviderViewStatus,
  StorageSettingsMode,
  StorageSettingsSaveRequest,
  StorageSettingsValidateRequest,
  TitanManagedRoutingMode,
} from "@shared/storageSettings";
import { TitanCard } from "@/components/titan";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  useStorageSettings,
  type OrganizationStorageSettingsView,
  type StorageProviderFieldName,
  type StorageProviderView,
  type StorageRuntimeMode,
  type StorageValidationSummary,
} from "@/hooks/useStorageSettings";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  AlertCircle,
  CheckCircle2,
  FolderTree,
  HardDrive,
  Loader2,
  Save,
  Server,
  Zap,
} from "lucide-react";

type OrchestrationFormState = {
  mode: StorageSettingsMode;
  displayName: string;
  routingMode: TitanManagedRoutingMode;
  maxCloudUploadBytesOverrideInput: string;
  maxDurableUploadBytesOverrideInput: string;
};

type ProviderFormState = {
  providerConfigId: string | null;
  providerType: ConfigurableStorageProviderType;
  displayName: string;
  bucketName: string;
  pathPrefix: string;
  subfolderPrefix: string;
  region: string;
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
  providerLabel: string;
};

const NEW_PROVIDER_KEY = "__new__";

const providerStatusClasses: Record<StorageProviderViewStatus, string> = {
  missing: "bg-muted text-muted-foreground",
  draft: "bg-amber-100 text-amber-900 border-amber-200",
  valid: "bg-blue-100 text-blue-900 border-blue-200",
  invalid: "bg-destructive/10 text-destructive border-destructive/20",
  active: "bg-emerald-100 text-emerald-900 border-emerald-200",
  disabled: "bg-slate-200 text-slate-700 border-slate-300",
};

const profileStatusClasses: Record<OrganizationStorageProfileViewStatus, string> = {
  missing: "bg-muted text-muted-foreground",
  draft: "bg-amber-100 text-amber-900 border-amber-200",
  active: "bg-emerald-100 text-emerald-900 border-emerald-200",
  disabled: "bg-slate-200 text-slate-700 border-slate-300",
};

const destinationStatusClasses: Record<CustomerProductionDestinationViewStatus, string> = {
  missing: "bg-muted text-muted-foreground",
  set: "bg-blue-100 text-blue-900 border-blue-200",
  invalid: "bg-destructive/10 text-destructive border-destructive/20",
  disabled: "bg-slate-200 text-slate-700 border-slate-300",
};

function formatStatusLabel(value: string) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatRuntimeModeDescription(mode: StorageRuntimeMode) {
  switch (mode) {
    case "byos_local":
      return "Saved BYOS local provider controls uploads.";
    case "byos_cloud":
      return "Saved BYOS cloud provider controls uploads.";
    case "hybrid":
      return "Hybrid runtime mode is active.";
    case "disabled":
      return "Storage is disabled for this organization.";
    case "titan_managed":
    default:
      return "Titan-managed routing controls uploads.";
  }
}

function formatProviderDestination(provider: StorageProviderView | null) {
  if (!provider) {
    return "No active destination";
  }

  if (provider.providerType === "local_filesystem") {
    const prefix = provider.config.subfolderPrefix?.trim();
    return prefix
      ? `Application server disk under FILE_STORAGE_ROOT/${prefix}`
      : "Application server disk under FILE_STORAGE_ROOT";
  }

  if (provider.providerType === "supabase") {
    const prefix = provider.config.pathPrefix?.trim();
    return prefix
      ? `Supabase bucket ${provider.config.bucketName} / ${prefix}`
      : `Supabase bucket ${provider.config.bucketName}`;
  }

  const prefix = provider.config.pathPrefix?.trim();
  const label = provider.config.providerLabel?.trim() || "S3-compatible";
  return prefix
    ? `${label} bucket ${provider.config.bucketName} / ${prefix}`
    : `${label} bucket ${provider.config.bucketName}`;
}

function buildOrchestrationFormState(settings?: OrganizationStorageSettingsView | null): OrchestrationFormState {
  return {
    mode: settings?.profile.mode === "disabled" ? "disabled" : "titan_managed",
    displayName: settings?.orchestration.displayName ?? "Titan Managed Orchestration",
    routingMode: settings?.orchestration.config.routingMode ?? "auto",
    maxCloudUploadBytesOverrideInput:
      settings?.orchestration.config.maxCloudUploadBytesOverride == null
        ? ""
        : String(settings.orchestration.config.maxCloudUploadBytesOverride),
    maxDurableUploadBytesOverrideInput:
      settings?.orchestration.config.maxDurableUploadBytesOverride == null
        ? ""
        : String(settings.orchestration.config.maxDurableUploadBytesOverride),
  };
}

function buildEmptyProviderForm(providerType: ConfigurableStorageProviderType): ProviderFormState {
  return {
    providerConfigId: null,
    providerType,
    displayName:
      providerType === "supabase"
        ? "Supabase Storage"
        : providerType === "local_filesystem"
          ? "Server Filesystem Storage"
          : "IDrive E2 / S3-Compatible Storage",
    bucketName: providerType === "supabase" ? "titan-private" : "",
    pathPrefix: "",
    subfolderPrefix: "",
    region: "",
    endpoint: "",
    accessKeyId: "",
    secretAccessKey: "",
    forcePathStyle: true,
    providerLabel: providerType === "s3" ? "IDrive E2" : "",
  };
}

function buildProviderFormState(provider?: StorageProviderView | null): ProviderFormState {
  if (!provider) {
    return buildEmptyProviderForm("supabase");
  }

  if (provider.providerType === "supabase") {
    const config = provider.config as Extract<StorageProviderView["config"], { providerType: "supabase" }>;
    return {
      ...buildEmptyProviderForm("supabase"),
      providerConfigId: provider.id,
      displayName: provider.displayName,
      bucketName: config.bucketName,
      pathPrefix: config.pathPrefix ?? "",
    };
  }

  if (provider.providerType === "local_filesystem") {
    const config = provider.config as Extract<StorageProviderView["config"], { providerType: "local_filesystem" }>;
    return {
      ...buildEmptyProviderForm("local_filesystem"),
      providerConfigId: provider.id,
      displayName: provider.displayName,
      subfolderPrefix: config.subfolderPrefix ?? "",
    };
  }

  const config = provider.config as Extract<StorageProviderView["config"], { providerType: "s3" }>;
  return {
    ...buildEmptyProviderForm("s3"),
    providerConfigId: provider.id,
    displayName: provider.displayName,
    bucketName: config.bucketName,
    pathPrefix: config.pathPrefix ?? "",
    region: config.region,
    endpoint: config.endpoint,
    accessKeyId: config.accessKeyId,
    secretAccessKey: "",
    forcePathStyle: config.forcePathStyle,
    providerLabel: config.providerLabel ?? "",
  };
}

function normalizeOrchestrationFormState(state: OrchestrationFormState) {
  return {
    ...state,
    displayName: state.displayName.trim(),
    maxCloudUploadBytesOverrideInput: state.maxCloudUploadBytesOverrideInput.trim(),
    maxDurableUploadBytesOverrideInput: state.maxDurableUploadBytesOverrideInput.trim(),
  };
}

function normalizeProviderFormState(state: ProviderFormState) {
  return {
    ...state,
    displayName: state.displayName.trim(),
    bucketName: state.bucketName.trim(),
    pathPrefix: state.pathPrefix.trim(),
    subfolderPrefix: state.subfolderPrefix.trim(),
    region: state.region.trim(),
    endpoint: state.endpoint.trim(),
    accessKeyId: state.accessKeyId.trim(),
    secretAccessKey: state.secretAccessKey.trim(),
    providerLabel: state.providerLabel.trim(),
  };
}

function buildOrchestrationRequest(state: OrchestrationFormState): StorageSettingsSaveRequest {
  const normalized = normalizeOrchestrationFormState(state);
  let maxCloudUploadBytesOverride: number | null = null;
  let maxDurableUploadBytesOverride: number | null = null;

  if (normalized.maxCloudUploadBytesOverrideInput) {
    const parsed = Number(normalized.maxCloudUploadBytesOverrideInput);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      throw new Error("Max cloud upload bytes override must be a positive whole number or blank.");
    }
    maxCloudUploadBytesOverride = parsed;
  }

  if (normalized.maxDurableUploadBytesOverrideInput) {
    const parsed = Number(normalized.maxDurableUploadBytesOverrideInput);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      throw new Error("Durable artwork storage limit must be a positive whole number or blank.");
    }
    maxDurableUploadBytesOverride = parsed;
  }

  if (!normalized.displayName) {
    throw new Error("Orchestration display name is required.");
  }

  return {
    kind: "orchestration",
    data: {
      mode: normalized.mode,
      providerType: "titan_managed",
      displayName: normalized.displayName,
      activate: false,
      config: {
        routingMode: normalized.routingMode,
        maxCloudUploadBytesOverride,
        maxDurableUploadBytesOverride,
      },
    },
  };
}

function buildProviderRequest(state: ProviderFormState): StorageSettingsSaveRequest {
  const normalized = normalizeProviderFormState(state);
  if (!normalized.displayName) {
    throw new Error("Provider display name is required.");
  }

  if (normalized.providerType === "supabase") {
    if (!normalized.bucketName) {
      throw new Error("Supabase bucket name is required.");
    }
    return {
      kind: "provider",
      data: {
        providerConfigId: normalized.providerConfigId,
        providerType: "supabase",
        displayName: normalized.displayName,
        config: {
          bucketName: normalized.bucketName,
          pathPrefix: normalized.pathPrefix || null,
        },
      },
    };
  }

  if (normalized.providerType === "local_filesystem") {
    return {
      kind: "provider",
      data: {
        providerConfigId: normalized.providerConfigId,
        providerType: "local_filesystem",
        displayName: normalized.displayName,
        config: {
          subfolderPrefix: normalized.subfolderPrefix || null,
        },
      },
    };
  }

  if (!normalized.bucketName || !normalized.region || !normalized.endpoint || !normalized.accessKeyId) {
    throw new Error("Bucket, region, endpoint, and access key are required for S3-compatible storage.");
  }

  return {
    kind: "provider",
    data: {
      providerConfigId: normalized.providerConfigId,
      providerType: "s3",
      displayName: normalized.displayName,
      config: {
        bucketName: normalized.bucketName,
        region: normalized.region,
        endpoint: normalized.endpoint,
        accessKeyId: normalized.accessKeyId,
        secretAccessKey: normalized.secretAccessKey || null,
        pathPrefix: normalized.pathPrefix || null,
        forcePathStyle: normalized.forcePathStyle,
        providerLabel: normalized.providerLabel || null,
      },
    },
  };
}

function ValidationCard({
  title,
  description,
  validation,
}: {
  title: string;
  description: string;
  validation: StorageValidationSummary | null;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {validation ? (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <Badge
                variant="outline"
                className={validation.valid
                  ? "border-emerald-300 bg-emerald-50 text-emerald-800"
                  : "border-destructive/30 bg-destructive/10 text-destructive"}
              >
                {validation.valid ? "Valid" : "Invalid"}
              </Badge>
              {validation.kind === "provider" ? (
                <Badge variant="outline" className="border-border text-muted-foreground">
                  {formatStatusLabel(validation.providerType)}
                </Badge>
              ) : null}
              <span className="text-xs text-muted-foreground">
                Validated {new Date(validation.validatedAt).toLocaleString()}
              </span>
            </div>

            {validation.error ? (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Validation error</AlertTitle>
                <AlertDescription>{validation.error}</AlertDescription>
              </Alert>
            ) : null}

            {validation.warnings.length > 0 ? (
              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Warnings</AlertTitle>
                <AlertDescription>
                  <ul className="list-disc space-y-1 pl-5">
                    {validation.warnings.map((warning) => (
                      <li key={warning}>{warning}</li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            ) : null}

            {validation.kind === "orchestration" ? (
              <div className="rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Preview item</TableHead>
                      <TableHead>Result</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    <TableRow>
                      <TableCell>Routing mode</TableCell>
                      <TableCell>{formatStatusLabel(validation.preview.routingMode)}</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell>Titan-managed cloud threshold</TableCell>
                      <TableCell>{validation.preview.maxCloudUploadBytes.toLocaleString()} bytes</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell>Small file preview (10 MB)</TableCell>
                      <TableCell>{formatStatusLabel(validation.preview.smallFileTarget)}</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell>Large file preview (100 MB)</TableCell>
                      <TableCell>{formatStatusLabel(validation.preview.largeFileTarget)}</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell>Supabase availability</TableCell>
                      <TableCell>{validation.preview.supabaseConfigured ? "Configured" : "Not configured"}</TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg border p-3 text-sm">
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">Runtime support</div>
                  <div className="mt-1 font-medium text-foreground">{validation.runtimeSupported ? "Supported" : "Not yet supported"}</div>
                </div>
                <div className="rounded-lg border p-3 text-sm">
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">Activation</div>
                  <div className="mt-1 font-medium text-foreground">{validation.canActivate ? "Can activate" : "Cannot activate yet"}</div>
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
            Validate the current draft to see fresh results.
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function StorageSettingsPage() {
  const { toast } = useToast();
  const {
    settings,
    isLoading,
    draftValidation,
    clearDraftValidation,
    validateRequest,
    isValidating,
    saveRequest,
    isSaving,
    activateProvider,
    isActivating,
  } = useStorageSettings();

  const [orchestrationForm, setOrchestrationForm] = useState<OrchestrationFormState>(buildOrchestrationFormState());
  const [selectedProviderKey, setSelectedProviderKey] = useState<string>("");
  const [providerForm, setProviderForm] = useState<ProviderFormState>(buildEmptyProviderForm("supabase"));

  const savedOrchestration = useMemo(() => buildOrchestrationFormState(settings), [settings]);
  const selectedExistingProvider = useMemo(
    () => settings?.providers.find((provider) => provider.id === selectedProviderKey) ?? null,
    [selectedProviderKey, settings],
  );
  const savedProviderState = useMemo(
    () => buildProviderFormState(selectedExistingProvider),
    [selectedExistingProvider],
  );

  const orchestrationDirty = useMemo(() => {
    return JSON.stringify(normalizeOrchestrationFormState(orchestrationForm)) !== JSON.stringify(normalizeOrchestrationFormState(savedOrchestration));
  }, [orchestrationForm, savedOrchestration]);

  const providerDirty = useMemo(() => {
    if (selectedProviderKey === NEW_PROVIDER_KEY) {
      return JSON.stringify(normalizeProviderFormState(providerForm)) !== JSON.stringify(normalizeProviderFormState(buildEmptyProviderForm(providerForm.providerType)));
    }
    return JSON.stringify(normalizeProviderFormState(providerForm)) !== JSON.stringify(normalizeProviderFormState(savedProviderState));
  }, [providerForm, savedProviderState, selectedProviderKey]);

  useEffect(() => {
    setOrchestrationForm(savedOrchestration);
  }, [savedOrchestration]);

  useEffect(() => {
    if (!settings) {
      return;
    }
    if (settings.providers.length === 0) {
      setSelectedProviderKey(NEW_PROVIDER_KEY);
      setProviderForm(buildEmptyProviderForm("supabase"));
      return;
    }
    setSelectedProviderKey((current) => {
      return settings.providers.some((provider) => provider.id === current)
        ? current
        : settings.activeProvider?.id ?? settings.providers[0]?.id ?? "";
    });
  }, [settings]);

  useEffect(() => {
    if (selectedProviderKey === NEW_PROVIDER_KEY) {
      setProviderForm((current) => buildEmptyProviderForm(current.providerType));
      return;
    }
    setProviderForm(savedProviderState);
  }, [savedProviderState, selectedProviderKey]);

  useEffect(() => {
    clearDraftValidation();
  }, [
    clearDraftValidation,
    orchestrationForm.mode,
    orchestrationForm.displayName,
    orchestrationForm.routingMode,
    orchestrationForm.maxCloudUploadBytesOverrideInput,
    providerForm.providerConfigId,
    providerForm.providerType,
    providerForm.displayName,
    providerForm.bucketName,
    providerForm.pathPrefix,
    providerForm.subfolderPrefix,
    providerForm.region,
    providerForm.endpoint,
    providerForm.accessKeyId,
    providerForm.secretAccessKey,
    providerForm.forcePathStyle,
    providerForm.providerLabel,
  ]);

  const orchestrationValidation = draftValidation?.kind === "orchestration"
    ? draftValidation
    : settings?.orchestration.validation ?? null;
  const providerValidation = draftValidation?.kind === "provider" ? draftValidation : null;
  const providerFieldErrors = providerValidation && !providerValidation.valid
    ? providerValidation.fieldErrors ?? {}
    : {};

  const getProviderFieldError = (field: StorageProviderFieldName) => providerFieldErrors[field] ?? null;
  const getProviderFieldClassName = (field: StorageProviderFieldName) => cn(
    getProviderFieldError(field) ? "border-destructive focus-visible:ring-destructive" : undefined,
  );

  const handleOpenNewProvider = (providerType: ConfigurableStorageProviderType = "supabase") => {
    clearDraftValidation();
    setSelectedProviderKey(NEW_PROVIDER_KEY);
    setProviderForm(buildEmptyProviderForm(providerType));
  };

  const handleSelectExistingProvider = (providerId: string) => {
    clearDraftValidation();
    setSelectedProviderKey(providerId);
  };

  const handleValidateOrchestration = async () => {
    try {
      const payload = buildOrchestrationRequest(orchestrationForm) as StorageSettingsValidateRequest;
      await validateRequest(payload);
    } catch (error: any) {
      toast({
        title: "Validation failed",
        description: error instanceof Error ? error.message : "Unable to validate orchestration settings.",
        variant: "destructive",
      });
    }
  };

  const handleSaveOrchestration = async () => {
    try {
      await saveRequest(buildOrchestrationRequest(orchestrationForm));
    } catch (error: any) {
      toast({
        title: "Save failed",
        description: error instanceof Error ? error.message : "Unable to save orchestration settings.",
        variant: "destructive",
      });
    }
  };

  const handleValidateProvider = async () => {
    try {
      await validateRequest(buildProviderRequest(providerForm) as StorageSettingsValidateRequest);
    } catch (error: any) {
      toast({
        title: "Validation failed",
        description: error instanceof Error ? error.message : "Unable to validate provider settings.",
        variant: "destructive",
      });
    }
  };

  const handleSaveProvider = async () => {
    try {
      const nextSettings = await saveRequest(buildProviderRequest(providerForm));
      const savedProvider = nextSettings.providers.find((provider) => {
        if (provider.providerType !== providerForm.providerType) {
          return false;
        }
        if (provider.displayName !== providerForm.displayName.trim()) {
          return false;
        }
        if (providerForm.providerConfigId) {
          return provider.id === providerForm.providerConfigId;
        }
        return true;
      }) ?? null;

      if (savedProvider) {
        setSelectedProviderKey(savedProvider.id);
        setProviderForm(buildProviderFormState(savedProvider));
      }
    } catch (error: any) {
      toast({
        title: "Save failed",
        description: error instanceof Error ? error.message : "Unable to save provider settings.",
        variant: "destructive",
      });
    }
  };

  const handleActivateProvider = async (providerId: string) => {
    try {
      await activateProvider({ providerConfigId: providerId });
    } catch (error: any) {
      toast({
        title: "Activation failed",
        description: error instanceof Error ? error.message : "Unable to activate provider.",
        variant: "destructive",
      });
    }
  };

  if (isLoading || !settings) {
    return (
      <TitanCard className="p-6">
        <div className="space-y-6">
          <div className="space-y-2">
            <Skeleton className="h-7 w-56" />
            <Skeleton className="h-4 w-[32rem] max-w-full" />
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            <Skeleton className="h-36 w-full" />
            <Skeleton className="h-36 w-full" />
            <Skeleton className="h-36 w-full" />
          </div>
          <Skeleton className="h-80 w-full" />
        </div>
      </TitanCard>
    );
  }

  return (
    <TitanCard className="p-6">
      <div className="space-y-6">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <HardDrive className="h-5 w-5 text-titan-text-primary" />
            <h2 className="text-titan-lg font-semibold text-titan-text-primary">Storage</h2>
          </div>
          <p className="text-sm text-titan-text-secondary">
            Manage Titan-managed orchestration settings, saved BYOS provider records, and the current runtime destination explicitly.
          </p>
        </div>

        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Saved drafts and active runtime are separate</AlertTitle>
          <AlertDescription>
            Validating and saving a provider draft stores a reusable record. Upload destination only changes when you activate a supported provider.
          </AlertDescription>
        </Alert>

        <div className="grid gap-4 xl:grid-cols-3">
          <Card>
            <CardHeader className="space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <CardTitle className="flex items-center gap-2 text-base"><Server className="h-4 w-4" />Organization profile</CardTitle>
                  <CardDescription>Overall storage state for this organization</CardDescription>
                </div>
                <Badge variant="outline" className={profileStatusClasses[settings.profile.status]}>{formatStatusLabel(settings.profile.status)}</Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-muted-foreground">
              <div className="flex items-center justify-between gap-3"><span>Runtime mode</span><span className="font-medium text-foreground">{formatStatusLabel(settings.profile.mode)}</span></div>
              <div className="rounded-lg border p-3 text-xs text-muted-foreground">{formatRuntimeModeDescription(settings.profile.mode)}</div>
              <div className="flex items-center justify-between gap-3"><span>Persisted state</span><span className="font-medium text-foreground">{settings.profile.persistedStatus ? formatStatusLabel(settings.profile.persistedStatus) : "Not saved yet"}</span></div>
              <div className="flex items-center justify-between gap-3"><span>Updated</span><span className="font-medium text-foreground">{settings.profile.updatedAt ? new Date(settings.profile.updatedAt).toLocaleString() : "Never"}</span></div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <CardTitle className="flex items-center gap-2 text-base"><Zap className="h-4 w-4" />Active provider</CardTitle>
                  <CardDescription>Current runtime upload destination truth for BYOS testing</CardDescription>
                </div>
                <Badge variant="outline" className={settings.activeProvider ? providerStatusClasses[settings.activeProvider.status] : providerStatusClasses.missing}>
                  {formatStatusLabel(settings.activeProvider?.status ?? "missing")}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-muted-foreground">
              <div className="flex items-center justify-between gap-3"><span>Provider</span><span className="font-medium text-foreground">{settings.activeProvider?.displayName ?? "No active provider"}</span></div>
              <div className="flex items-center justify-between gap-3"><span>Type</span><span className="font-medium text-foreground">{settings.activeProvider ? formatStatusLabel(settings.activeProvider.providerType) : "—"}</span></div>
              <div className="flex items-center justify-between gap-3"><span>Destination</span><span className="text-right font-medium text-foreground">{formatProviderDestination(settings.activeProvider)}</span></div>
              <div className="flex items-center justify-between gap-3"><span>Runtime support</span><span className="font-medium text-foreground">{settings.activeProvider ? settings.activeProvider.runtimeSupported ? "Supported" : "Not yet supported" : "—"}</span></div>
              {settings.activeProvider?.providerType === "local_filesystem" ? (
                <div className="rounded-lg border p-3 text-xs text-muted-foreground">
                  Local filesystem means the hosted application server disk under FILE_STORAGE_ROOT, not Batman&apos;s PC path.
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <CardTitle className="flex items-center gap-2 text-base"><FolderTree className="h-4 w-4" />Production destinations</CardTitle>
                  <CardDescription>Customer production folder references remain separate</CardDescription>
                </div>
                <Badge variant="outline" className={destinationStatusClasses[settings.productionDestinations.status]}>{formatStatusLabel(settings.productionDestinations.status)}</Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-muted-foreground">
              <div className="flex items-center justify-between gap-3"><span>Customers</span><span className="font-medium text-foreground">{settings.productionDestinations.totalCustomers}</span></div>
              <div className="flex items-center justify-between gap-3"><span>Set references</span><span className="font-medium text-foreground">{settings.productionDestinations.setCount}</span></div>
              <div className="flex items-center justify-between gap-3"><span>Invalid references</span><span className="font-medium text-foreground">{settings.productionDestinations.invalidCount}</span></div>
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
          <Card>
            <CardHeader>
              <CardTitle>Orchestration and routing</CardTitle>
              <CardDescription>Titan-managed routing rules are separate from the saved active BYOS provider.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {settings.activeProvider ? (
                <Alert>
                  <AlertCircle className="h-4 w-4" />
                  <AlertTitle>BYOS provider is active</AlertTitle>
                  <AlertDescription>
                    Titan-managed routing previews below do not control current uploads while {settings.activeProvider.displayName} is active. They only apply if runtime is switched back to Titan managed.
                  </AlertDescription>
                </Alert>
              ) : null}

              <div className="grid gap-4 md:grid-cols-3">
                <div className="space-y-2">
                  <Label htmlFor="storage-mode">Storage mode</Label>
                  <Select value={orchestrationForm.mode} onValueChange={(value) => setOrchestrationForm((current) => ({ ...current, mode: value as StorageSettingsMode }))}>
                    <SelectTrigger id="storage-mode"><SelectValue placeholder="Select mode" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="titan_managed">Titan managed</SelectItem>
                      <SelectItem value="disabled">Disabled</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="orchestration-display-name">Display name</Label>
                  <Input id="orchestration-display-name" value={orchestrationForm.displayName} onChange={(event) => setOrchestrationForm((current) => ({ ...current, displayName: event.target.value }))} />
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="routing-mode">Routing mode</Label>
                  <Select value={orchestrationForm.routingMode} onValueChange={(value) => setOrchestrationForm((current) => ({ ...current, routingMode: value as TitanManagedRoutingMode }))} disabled={orchestrationForm.mode === "disabled"}>
                    <SelectTrigger id="routing-mode"><SelectValue placeholder="Select routing mode" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="auto">Auto</SelectItem>
                      <SelectItem value="supabase">Force Supabase</SelectItem>
                      <SelectItem value="local_dev">Force local dev</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="max-cloud-upload">Development cloud-routing threshold</Label>
                  <Input id="max-cloud-upload" inputMode="numeric" value={orchestrationForm.maxCloudUploadBytesOverrideInput} onChange={(event) => setOrchestrationForm((current) => ({ ...current, maxCloudUploadBytesOverrideInput: event.target.value }))} placeholder="Development only; blank uses the default" disabled={orchestrationForm.mode === "disabled"} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="max-durable-upload">Durable artwork storage limit</Label>
                  <Input id="max-durable-upload" inputMode="numeric" value={orchestrationForm.maxDurableUploadBytesOverrideInput} onChange={(event) => setOrchestrationForm((current) => ({ ...current, maxDurableUploadBytesOverrideInput: event.target.value }))} placeholder="Blank means no application limit" disabled={orchestrationForm.mode === "disabled"} />
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <Button type="button" variant="outline" onClick={handleValidateOrchestration} disabled={isValidating || isSaving}>
                  {isValidating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}Validate orchestration
                </Button>
                <Button type="button" onClick={handleSaveOrchestration} disabled={isSaving || isValidating}>
                  {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}Save orchestration
                </Button>
                <Button type="button" variant="ghost" onClick={() => setOrchestrationForm(savedOrchestration)} disabled={!orchestrationDirty || isSaving || isValidating}>Reset</Button>
                <Badge variant="outline" className={cn(orchestrationDirty ? "border-amber-300 text-amber-800 bg-amber-50" : "border-emerald-300 text-emerald-800 bg-emerald-50")}>
                  {orchestrationDirty ? "Unsaved orchestration draft" : "Orchestration matches saved"}
                </Badge>
              </div>
            </CardContent>
          </Card>

          <ValidationCard
            title="Orchestration validation"
            description="Preview how Printers Hero would route small and large files with the current orchestration settings."
            validation={orchestrationValidation}
          />
        </div>

        <Separator />

        <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
          <Card>
            <CardHeader>
              <CardTitle>Saved provider records</CardTitle>
              <CardDescription>Configure reusable provider records for Supabase, server filesystem, and S3-compatible backends.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant={selectedProviderKey === NEW_PROVIDER_KEY ? "default" : "outline"} onClick={() => handleOpenNewProvider(providerForm.providerType)}>
                  New provider
                </Button>
                {settings.providers.map((provider) => (
                  <Button key={provider.id} type="button" variant={selectedProviderKey === provider.id ? "default" : "outline"} onClick={() => handleSelectExistingProvider(provider.id)}>
                    {provider.displayName}
                  </Button>
                ))}
              </div>

              <div className="rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Activation</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {settings.providers.length > 0 ? settings.providers.map((provider) => (
                      <TableRow key={provider.id}>
                        <TableCell>
                          <div className="font-medium text-foreground">{provider.displayName}</div>
                          <div className="text-xs text-muted-foreground">{provider.lastValidatedAt ? `Validated ${new Date(provider.lastValidatedAt).toLocaleString()}` : "Not validated yet"}</div>
                        </TableCell>
                        <TableCell>{formatStatusLabel(provider.providerType)}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className={providerStatusClasses[provider.status]}>{formatStatusLabel(provider.status)}</Badge>
                        </TableCell>
                        <TableCell>
                          <Button type="button" size="sm" variant="outline" disabled={!provider.canActivate || provider.isActive || isActivating} onClick={() => handleActivateProvider(provider.id)}>
                            {provider.isActive ? "Active" : provider.canActivate ? "Activate" : "Blocked"}
                          </Button>
                        </TableCell>
                      </TableRow>
                    )) : (
                      <TableRow>
                        <TableCell colSpan={4} className="text-sm text-muted-foreground">No provider records saved yet.</TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Provider draft editor</CardTitle>
              <CardDescription>Edit the selected provider record or create a new one.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className={selectedProviderKey === NEW_PROVIDER_KEY ? "border-blue-300 bg-blue-50 text-blue-900" : providerStatusClasses[selectedExistingProvider?.status ?? "missing"]}>
                  {selectedProviderKey === NEW_PROVIDER_KEY ? "Creating new provider" : selectedExistingProvider ? `Editing ${selectedExistingProvider.displayName}` : "No provider selected"}
                </Badge>
              </div>

              {providerValidation && !providerValidation.valid ? (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertTitle>Provider draft needs attention</AlertTitle>
                  <AlertDescription>
                    <div className="space-y-2">
                      {providerValidation.error ? <p>{providerValidation.error}</p> : null}
                      {Object.keys(providerFieldErrors).length > 0 ? (
                        <ul className="list-disc space-y-1 pl-5">
                          {Object.entries(providerFieldErrors)
                            .filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].trim().length > 0)
                            .map(([field, message]) => (
                              <li key={field}>{message}</li>
                            ))}
                        </ul>
                      ) : null}
                    </div>
                  </AlertDescription>
                </Alert>
              ) : null}

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="provider-type">Provider type</Label>
                  <Select
                    value={providerForm.providerType}
                    onValueChange={(value) => {
                      const nextType = value as ConfigurableStorageProviderType;
                      handleOpenNewProvider(nextType);
                    }}
                    disabled={selectedProviderKey !== NEW_PROVIDER_KEY}
                  >
                    <SelectTrigger id="provider-type"><SelectValue placeholder="Select provider type" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="supabase">Supabase</SelectItem>
                      <SelectItem value="local_filesystem">Server filesystem</SelectItem>
                      <SelectItem value="s3">IDrive E2 / S3-compatible</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="provider-display-name">Display name</Label>
                  <Input id="provider-display-name" className={getProviderFieldClassName("displayName")} value={providerForm.displayName} onChange={(event) => setProviderForm((current) => ({ ...current, displayName: event.target.value }))} />
                  {getProviderFieldError("displayName") ? <p className="text-xs text-destructive">{getProviderFieldError("displayName")}</p> : null}
                </div>
              </div>

              {providerForm.providerType === "supabase" ? (
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="supabase-bucket">Bucket name</Label>
                    <Input id="supabase-bucket" className={getProviderFieldClassName("bucketName")} value={providerForm.bucketName} onChange={(event) => setProviderForm((current) => ({ ...current, bucketName: event.target.value }))} />
                    {getProviderFieldError("bucketName") ? <p className="text-xs text-destructive">{getProviderFieldError("bucketName")}</p> : null}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="supabase-prefix">Path prefix</Label>
                    <Input id="supabase-prefix" className={getProviderFieldClassName("pathPrefix")} value={providerForm.pathPrefix} onChange={(event) => setProviderForm((current) => ({ ...current, pathPrefix: event.target.value }))} placeholder="optional/folder" />
                    {getProviderFieldError("pathPrefix") ? <p className="text-xs text-destructive">{getProviderFieldError("pathPrefix")}</p> : null}
                  </div>
                </div>
              ) : null}

              {providerForm.providerType === "local_filesystem" ? (
                <div className="space-y-3">
                  <div className="rounded-lg border p-3 text-sm text-muted-foreground">
                    Server filesystem providers write to the hosted app server disk under FILE_STORAGE_ROOT. They do not write to Batman&apos;s personal computer.
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="local-subfolder">Server subfolder prefix</Label>
                    <Input id="local-subfolder" className={getProviderFieldClassName("subfolderPrefix")} value={providerForm.subfolderPrefix} onChange={(event) => setProviderForm((current) => ({ ...current, subfolderPrefix: event.target.value }))} placeholder="optional/subfolder" />
                    {getProviderFieldError("subfolderPrefix") ? <p className="text-xs text-destructive">{getProviderFieldError("subfolderPrefix")}</p> : null}
                  </div>
                </div>
              ) : null}

              {providerForm.providerType === "s3" ? (
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="s3-label">Provider label</Label>
                    <Input id="s3-label" className={getProviderFieldClassName("providerLabel")} value={providerForm.providerLabel} onChange={(event) => setProviderForm((current) => ({ ...current, providerLabel: event.target.value }))} placeholder="IDrive E2" />
                    {getProviderFieldError("providerLabel") ? <p className="text-xs text-destructive">{getProviderFieldError("providerLabel")}</p> : null}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="s3-bucket">Bucket name</Label>
                    <Input id="s3-bucket" className={getProviderFieldClassName("bucketName")} value={providerForm.bucketName} onChange={(event) => setProviderForm((current) => ({ ...current, bucketName: event.target.value }))} />
                    {getProviderFieldError("bucketName") ? <p className="text-xs text-destructive">{getProviderFieldError("bucketName")}</p> : null}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="s3-region">Region</Label>
                    <Input id="s3-region" className={getProviderFieldClassName("region")} value={providerForm.region} onChange={(event) => setProviderForm((current) => ({ ...current, region: event.target.value }))} />
                    {getProviderFieldError("region") ? <p className="text-xs text-destructive">{getProviderFieldError("region")}</p> : null}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="s3-endpoint">Endpoint</Label>
                    <Input id="s3-endpoint" className={getProviderFieldClassName("endpoint")} value={providerForm.endpoint} onChange={(event) => setProviderForm((current) => ({ ...current, endpoint: event.target.value }))} placeholder="https://..." />
                    {getProviderFieldError("endpoint") ? <p className="text-xs text-destructive">{getProviderFieldError("endpoint")}</p> : null}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="s3-access-key">Access key ID</Label>
                    <Input id="s3-access-key" className={getProviderFieldClassName("accessKeyId")} value={providerForm.accessKeyId} onChange={(event) => setProviderForm((current) => ({ ...current, accessKeyId: event.target.value }))} />
                    {getProviderFieldError("accessKeyId") ? <p className="text-xs text-destructive">{getProviderFieldError("accessKeyId")}</p> : null}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="s3-secret-key">Secret access key</Label>
                    <Input id="s3-secret-key" className={getProviderFieldClassName("secretAccessKey")} type="password" value={providerForm.secretAccessKey} onChange={(event) => setProviderForm((current) => ({ ...current, secretAccessKey: event.target.value }))} placeholder={selectedProviderKey === NEW_PROVIDER_KEY ? "Required for validation" : "Leave blank to keep existing secret"} />
                    {getProviderFieldError("secretAccessKey") ? <p className="text-xs text-destructive">{getProviderFieldError("secretAccessKey")}</p> : null}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="s3-prefix">Path prefix</Label>
                    <Input id="s3-prefix" className={getProviderFieldClassName("pathPrefix")} value={providerForm.pathPrefix} onChange={(event) => setProviderForm((current) => ({ ...current, pathPrefix: event.target.value }))} placeholder="optional/folder" />
                    {getProviderFieldError("pathPrefix") ? <p className="text-xs text-destructive">{getProviderFieldError("pathPrefix")}</p> : null}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="s3-path-style">URL style</Label>
                    <Select value={providerForm.forcePathStyle ? "path" : "virtual"} onValueChange={(value) => setProviderForm((current) => ({ ...current, forcePathStyle: value === "path" }))}>
                      <SelectTrigger id="s3-path-style" className={getProviderFieldClassName("forcePathStyle")}><SelectValue placeholder="Select URL style" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="path">Force path-style</SelectItem>
                        <SelectItem value="virtual">Virtual-hosted style</SelectItem>
                      </SelectContent>
                    </Select>
                    {getProviderFieldError("forcePathStyle") ? <p className="text-xs text-destructive">{getProviderFieldError("forcePathStyle")}</p> : null}
                  </div>
                </div>
              ) : null}

              <div className="flex flex-wrap items-center gap-3">
                <Button type="button" variant="outline" onClick={handleValidateProvider} disabled={isValidating || isSaving}>
                  {isValidating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}Validate provider
                </Button>
                <Button type="button" onClick={handleSaveProvider} disabled={isSaving || isValidating}>
                  {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}Save provider draft
                </Button>
                {selectedProviderKey !== NEW_PROVIDER_KEY && providerForm.providerConfigId ? (
                  <Button type="button" variant="secondary" onClick={() => handleActivateProvider(providerForm.providerConfigId!)} disabled={isActivating || !selectedExistingProvider?.canActivate || selectedExistingProvider?.isActive}>
                    {isActivating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                    {selectedExistingProvider?.isActive ? "Already active" : "Activate provider"}
                  </Button>
                ) : null}
                <Button type="button" variant="ghost" onClick={() => setProviderForm(selectedProviderKey === NEW_PROVIDER_KEY ? buildEmptyProviderForm(providerForm.providerType) : savedProviderState)} disabled={!providerDirty || isSaving || isValidating}>Reset</Button>
                <Badge variant="outline" className={cn(providerDirty ? "border-amber-300 text-amber-800 bg-amber-50" : "border-emerald-300 text-emerald-800 bg-emerald-50")}>
                  {providerDirty ? "Unsaved provider draft" : "Provider draft matches saved"}
                </Badge>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-6 xl:grid-cols-[1fr_1fr]">
          <ValidationCard
            title="Provider validation"
            description="Use this to test the selected provider draft before saving or activating it."
            validation={providerValidation}
          />

          <Card>
            <CardHeader>
              <CardTitle>Production destination references</CardTitle>
              <CardDescription>Customer-specific production folder references remain downstream destinations only.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 text-sm text-muted-foreground">
              <div className="rounded-lg border p-4">
                <p className="font-medium text-foreground">Keep canonical storage and production drop folders separate.</p>
                <p className="mt-1">Canonical uploads are controlled by the active provider above. Customer production folders stay in customer workflow configuration.</p>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-lg border p-3"><div className="text-xs uppercase tracking-wide text-muted-foreground">Set</div><div className="mt-1 text-2xl font-semibold text-foreground">{settings.productionDestinations.setCount}</div></div>
                <div className="rounded-lg border p-3"><div className="text-xs uppercase tracking-wide text-muted-foreground">Invalid</div><div className="mt-1 text-2xl font-semibold text-foreground">{settings.productionDestinations.invalidCount}</div></div>
                <div className="rounded-lg border p-3"><div className="text-xs uppercase tracking-wide text-muted-foreground">Disabled</div><div className="mt-1 text-2xl font-semibold text-foreground">{settings.productionDestinations.disabledCount}</div></div>
              </div>
            </CardContent>
          </Card>
        </div>

        {settings.activeProvider?.validationError ? (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Active provider issue</AlertTitle>
            <AlertDescription>{settings.activeProvider.validationError}</AlertDescription>
          </Alert>
        ) : null}
      </div>
    </TitanCard>
  );
}
