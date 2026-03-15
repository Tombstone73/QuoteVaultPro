import { useEffect, useMemo, useState, type ReactNode } from "react";
import type {
  CustomerProductionDestinationViewStatus,
  OrganizationStorageProfileViewStatus,
  StorageProviderViewStatus,
  StorageSettingsMode,
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
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useStorageSettings, type OrganizationStorageSettingsView, type StorageSettingsPayload } from "@/hooks/useStorageSettings";
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
} from "lucide-react";

type StorageSettingsFormState = {
  mode: StorageSettingsMode;
  displayName: string;
  activate: boolean;
  routingMode: TitanManagedRoutingMode;
  maxCloudUploadBytesOverrideInput: string;
};

const DEFAULT_FORM_STATE: StorageSettingsFormState = {
  mode: "titan_managed",
  displayName: "Titan Managed Storage",
  activate: false,
  routingMode: "auto",
  maxCloudUploadBytesOverrideInput: "",
};

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

function buildFormState(settings?: OrganizationStorageSettingsView | null): StorageSettingsFormState {
  if (!settings) return DEFAULT_FORM_STATE;

  return {
    mode: settings.profile.mode,
    displayName: settings.provider.displayName || "Titan Managed Storage",
    activate: settings.profile.status === "active",
    routingMode: settings.provider.config.routingMode || "auto",
    maxCloudUploadBytesOverrideInput:
      settings.provider.config.maxCloudUploadBytesOverride == null
        ? ""
        : String(settings.provider.config.maxCloudUploadBytesOverride),
  };
}

function normalizeFormState(formState: StorageSettingsFormState) {
  return {
    ...formState,
    displayName: formState.displayName.trim(),
    maxCloudUploadBytesOverrideInput: formState.maxCloudUploadBytesOverrideInput.trim(),
    activate: formState.mode === "disabled" ? false : formState.activate,
  };
}

function parsePayload(formState: StorageSettingsFormState): StorageSettingsPayload {
  const normalized = normalizeFormState(formState);
  const rawThreshold = normalized.maxCloudUploadBytesOverrideInput;

  let maxCloudUploadBytesOverride: number | null = null;
  if (rawThreshold.length > 0) {
    const parsed = Number(rawThreshold);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      throw new Error("Max cloud upload bytes override must be a positive whole number or blank.");
    }
    maxCloudUploadBytesOverride = parsed;
  }

  if (!normalized.displayName) {
    throw new Error("Display name is required.");
  }

  return {
    mode: normalized.mode,
    providerType: "titan_managed",
    displayName: normalized.displayName,
    activate: normalized.mode === "disabled" ? false : normalized.activate,
    config: {
      routingMode: normalized.routingMode,
      maxCloudUploadBytesOverride,
    },
  };
}

function SummaryCard({
  title,
  description,
  status,
  statusClassName,
  icon: Icon,
  children,
}: {
  title: string;
  description: string;
  status: string;
  statusClassName: string;
  icon: typeof HardDrive;
  children: ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2 text-base">
              <Icon className="h-4 w-4" />
              {title}
            </CardTitle>
            <CardDescription>{description}</CardDescription>
          </div>
          <Badge variant="outline" className={statusClassName}>
            {formatStatusLabel(status)}
          </Badge>
        </div>
      </CardHeader>
      <CardContent>{children}</CardContent>
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
    validateDraft,
    isValidating,
    saveSettings,
    isSaving,
  } = useStorageSettings();

  const [formState, setFormState] = useState<StorageSettingsFormState>(DEFAULT_FORM_STATE);

  const savedFormState = useMemo(() => buildFormState(settings), [settings]);
  const isDirty = useMemo(() => {
    return JSON.stringify(normalizeFormState(formState)) !== JSON.stringify(normalizeFormState(savedFormState));
  }, [formState, savedFormState]);

  useEffect(() => {
    setFormState(savedFormState);
  }, [savedFormState]);

  useEffect(() => {
    if (draftValidation) {
      clearDraftValidation();
    }
  }, [
    clearDraftValidation,
    draftValidation,
    formState.mode,
    formState.displayName,
    formState.activate,
    formState.routingMode,
    formState.maxCloudUploadBytesOverrideInput,
  ]);

  const displayedValidation = draftValidation ?? settings?.validation ?? null;

  const handleValidate = async () => {
    try {
      await validateDraft(parsePayload(formState));
    } catch (error: any) {
      if (error instanceof Error) {
        toast({ title: "Validation failed", description: error.message, variant: "destructive" });
      }
    }
  };

  const handleSave = async () => {
    try {
      await saveSettings(parsePayload(formState));
    } catch (error: any) {
      if (error instanceof Error) {
        toast({ title: "Save failed", description: error.message, variant: "destructive" });
      }
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
            Configure saved TitanOS storage routing. Draft edits stay temporary until you validate and save them.
          </p>
        </div>

        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Saved config controls runtime behavior</AlertTitle>
          <AlertDescription>
            Unsaved form changes never affect live routing. TitanOS only reads the saved active configuration for upload decisions.
          </AlertDescription>
        </Alert>

        <div className="grid gap-4 xl:grid-cols-3">
          <SummaryCard
            title="Organization profile"
            description="Overall storage state for this organization"
            status={settings.profile.status}
            statusClassName={profileStatusClasses[settings.profile.status]}
            icon={Server}
          >
            <div className="space-y-2 text-sm text-muted-foreground">
              <div className="flex items-center justify-between gap-3">
                <span>Mode</span>
                <span className="font-medium text-foreground">{formatStatusLabel(settings.profile.mode)}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span>Persisted state</span>
                <span className="font-medium text-foreground">{settings.profile.persistedStatus ? formatStatusLabel(settings.profile.persistedStatus) : "Not saved yet"}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span>Updated</span>
                <span className="font-medium text-foreground">{settings.profile.updatedAt ? new Date(settings.profile.updatedAt).toLocaleString() : "Never"}</span>
              </div>
            </div>
          </SummaryCard>

          <SummaryCard
            title="Provider"
            description="Canonical and intake provider configuration"
            status={settings.provider.status}
            statusClassName={providerStatusClasses[settings.provider.status]}
            icon={HardDrive}
          >
            <div className="space-y-2 text-sm text-muted-foreground">
              <div className="flex items-center justify-between gap-3">
                <span>Display name</span>
                <span className="font-medium text-foreground">{settings.provider.displayName}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span>Provider type</span>
                <span className="font-medium text-foreground">Titan managed</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span>Last validated</span>
                <span className="font-medium text-foreground">{settings.provider.lastValidatedAt ? new Date(settings.provider.lastValidatedAt).toLocaleString() : "Never"}</span>
              </div>
            </div>
          </SummaryCard>

          <SummaryCard
            title="Production destinations"
            description="Separate customer production folder references"
            status={settings.productionDestinations.status}
            statusClassName={destinationStatusClasses[settings.productionDestinations.status]}
            icon={FolderTree}
          >
            <div className="space-y-2 text-sm text-muted-foreground">
              <div className="flex items-center justify-between gap-3">
                <span>Customers</span>
                <span className="font-medium text-foreground">{settings.productionDestinations.totalCustomers}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span>Set references</span>
                <span className="font-medium text-foreground">{settings.productionDestinations.setCount}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span>Invalid references</span>
                <span className="font-medium text-foreground">{settings.productionDestinations.invalidCount}</span>
              </div>
            </div>
          </SummaryCard>
        </div>

        <div className="grid gap-6 xl:grid-cols-[1.25fr_0.9fr]">
          <Card>
            <CardHeader>
              <CardTitle>Provider draft</CardTitle>
              <CardDescription>
                This form edits the next saved storage config. It does not change runtime routing until you save it.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="storage-mode">Storage mode</Label>
                  <Select
                    value={formState.mode}
                    onValueChange={(value) => setFormState((current) => ({ ...current, mode: value as StorageSettingsMode }))}
                  >
                    <SelectTrigger id="storage-mode">
                      <SelectValue placeholder="Select mode" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="titan_managed">Titan managed</SelectItem>
                      <SelectItem value="disabled">Disabled</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Disabled keeps the saved provider record but prevents it from being the active runtime profile.
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="storage-display-name">Display name</Label>
                  <Input
                    id="storage-display-name"
                    value={formState.displayName}
                    onChange={(event) => setFormState((current) => ({ ...current, displayName: event.target.value }))}
                    placeholder="Titan Managed Storage"
                  />
                  <p className="text-xs text-muted-foreground">
                    Admin-facing label for the saved provider configuration.
                  </p>
                </div>
              </div>

              <Separator />

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="routing-mode">Routing mode</Label>
                  <Select
                    value={formState.routingMode}
                    onValueChange={(value) => setFormState((current) => ({ ...current, routingMode: value as TitanManagedRoutingMode }))}
                    disabled={formState.mode === "disabled"}
                  >
                    <SelectTrigger id="routing-mode">
                      <SelectValue placeholder="Select routing mode" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="auto">Auto</SelectItem>
                      <SelectItem value="supabase">Force Supabase</SelectItem>
                      <SelectItem value="local_dev">Force local dev</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Auto routes by the saved threshold and environment readiness. Forced modes always target one location.
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="max-cloud-upload">Max cloud upload bytes override</Label>
                  <Input
                    id="max-cloud-upload"
                    inputMode="numeric"
                    value={formState.maxCloudUploadBytesOverrideInput}
                    onChange={(event) => setFormState((current) => ({ ...current, maxCloudUploadBytesOverrideInput: event.target.value }))}
                    placeholder="Leave blank to use default"
                    disabled={formState.mode === "disabled"}
                  />
                  <p className="text-xs text-muted-foreground">
                    Optional integer override for the largest file TitanOS should send to cloud storage in auto mode.
                  </p>
                </div>
              </div>

              <div className="flex items-start justify-between gap-4 rounded-lg border p-4">
                <div className="space-y-1">
                  <Label htmlFor="activate-storage-draft" className="text-sm font-medium">
                    Make this config active on save
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Turn this on to promote the saved draft to the active organization storage profile after save.
                  </p>
                </div>
                <Switch
                  id="activate-storage-draft"
                  checked={formState.mode === "disabled" ? false : formState.activate}
                  onCheckedChange={(checked) => setFormState((current) => ({ ...current, activate: checked }))}
                  disabled={formState.mode === "disabled"}
                />
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <Button type="button" variant="outline" onClick={handleValidate} disabled={isValidating || isSaving}>
                  {isValidating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
                  Validate draft
                </Button>
                <Button type="button" onClick={handleSave} disabled={isSaving || isValidating}>
                  {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                  Save settings
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setFormState(savedFormState)}
                  disabled={!isDirty || isSaving || isValidating}
                >
                  Reset to saved
                </Button>
                <Badge variant="outline" className={cn(isDirty ? "border-amber-300 text-amber-800 bg-amber-50" : "border-emerald-300 text-emerald-800 bg-emerald-50")}>
                  {isDirty ? "Unsaved draft" : "Draft matches saved config"}
                </Badge>
              </div>
            </CardContent>
          </Card>

          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Validation preview</CardTitle>
                <CardDescription>
                  Preview how TitanOS would route small and large files with the current saved or newly validated draft.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {displayedValidation ? (
                  <>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge
                        variant="outline"
                        className={displayedValidation.valid
                          ? "border-emerald-300 bg-emerald-50 text-emerald-800"
                          : "border-destructive/30 bg-destructive/10 text-destructive"}
                      >
                        {displayedValidation.valid ? "Valid" : "Invalid"}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        Validated {new Date(displayedValidation.validatedAt).toLocaleString()}
                      </span>
                    </div>

                    {displayedValidation.error ? (
                      <Alert variant="destructive">
                        <AlertCircle className="h-4 w-4" />
                        <AlertTitle>Validation error</AlertTitle>
                        <AlertDescription>{displayedValidation.error}</AlertDescription>
                      </Alert>
                    ) : null}

                    {displayedValidation.warnings.length > 0 ? (
                      <Alert>
                        <AlertCircle className="h-4 w-4" />
                        <AlertTitle>Warnings</AlertTitle>
                        <AlertDescription>
                          <ul className="list-disc space-y-1 pl-5">
                            {displayedValidation.warnings.map((warning) => (
                              <li key={warning}>{warning}</li>
                            ))}
                          </ul>
                        </AlertDescription>
                      </Alert>
                    ) : null}

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
                            <TableCell>{formatStatusLabel(displayedValidation.preview.routingMode)}</TableCell>
                          </TableRow>
                          <TableRow>
                            <TableCell>Cloud threshold</TableCell>
                            <TableCell>{displayedValidation.preview.maxCloudUploadBytes.toLocaleString()} bytes</TableCell>
                          </TableRow>
                          <TableRow>
                            <TableCell>Small file preview (10 MB)</TableCell>
                            <TableCell>{formatStatusLabel(displayedValidation.preview.smallFileTarget)}</TableCell>
                          </TableRow>
                          <TableRow>
                            <TableCell>Large file preview (100 MB)</TableCell>
                            <TableCell>{formatStatusLabel(displayedValidation.preview.largeFileTarget)}</TableCell>
                          </TableRow>
                          <TableRow>
                            <TableCell>Supabase availability</TableCell>
                            <TableCell>{displayedValidation.preview.supabaseConfigured ? "Configured" : "Not configured"}</TableCell>
                          </TableRow>
                        </TableBody>
                      </Table>
                    </div>
                  </>
                ) : (
                  <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                    Validate the current draft to see a fresh routing preview.
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Production destination references</CardTitle>
                <CardDescription>
                  Customer production folder paths stay separate from canonical storage provider settings.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4 text-sm text-muted-foreground">
                <div className="rounded-lg border p-4">
                  <p className="font-medium text-foreground">These references are downstream destinations only.</p>
                  <p className="mt-1">
                    They do not control where TitanOS stores canonical uploads. Keep storage provider decisions here, and customer-specific production folders in the customer workflow.
                  </p>
                </div>
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="rounded-lg border p-3">
                    <div className="text-xs uppercase tracking-wide text-muted-foreground">Set</div>
                    <div className="mt-1 text-2xl font-semibold text-foreground">{settings.productionDestinations.setCount}</div>
                  </div>
                  <div className="rounded-lg border p-3">
                    <div className="text-xs uppercase tracking-wide text-muted-foreground">Invalid</div>
                    <div className="mt-1 text-2xl font-semibold text-foreground">{settings.productionDestinations.invalidCount}</div>
                  </div>
                  <div className="rounded-lg border p-3">
                    <div className="text-xs uppercase tracking-wide text-muted-foreground">Disabled</div>
                    <div className="mt-1 text-2xl font-semibold text-foreground">{settings.productionDestinations.disabledCount}</div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>

        {settings.provider.validationError ? (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Saved provider issue</AlertTitle>
            <AlertDescription>
              The saved provider currently reports: {settings.provider.validationError}
            </AlertDescription>
          </Alert>
        ) : null}
      </div>
    </TitanCard>
  );
}
