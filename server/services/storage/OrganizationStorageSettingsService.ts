import { randomUUID } from "crypto";
import { eq, sql } from "drizzle-orm";
import { HeadBucketCommand, S3Client } from "@aws-sdk/client-s3";
import {
  customerProductionFolderReferences,
  customers,
  type OrganizationStorageProfile,
  type StorageProviderConfig,
} from "@shared/schema";
import {
  normalizeLocalFilesystemStorageProviderConfig,
  normalizeS3CompatibleStorageProviderConfig,
  normalizeSupabaseStorageProviderConfig,
  normalizeTitanManagedStorageConfig,
  storageProviderDraftSaveSchema,
  storageSettingsSaveSchema,
  storageSettingsValidateRequestSchema,
  type CustomerProductionDestinationViewStatus,
  type OrganizationStorageProfileViewStatus,
  type StorageProviderDraftSaveInput,
  type StorageProviderViewStatus,
  type StorageSettingsSaveInput,
} from "@shared/storageSettings";
import { db } from "../../db";
import { organizationStorageProfileRepository } from "../../storage/organizationStorageProfile.repo";
import { storageProviderConfigRepository } from "../../storage/storageProviderConfig.repo";
import { isSupabaseConfigured, SupabaseStorageService } from "../../supabaseStorage";
import { getEffectiveMaxCloudUploadBytes } from "../storageTarget";

const SAMPLE_SMALL_FILE_BYTES = 10 * 1024 * 1024;
const SAMPLE_LARGE_FILE_BYTES = 100 * 1024 * 1024;
const ORCHESTRATION_DISPLAY_NAME_CANONICAL = "Titan Managed Orchestration";
const ORCHESTRATION_DISPLAY_NAME_INTAKE = "Titan Managed Intake Orchestration";

type StorageOrchestrationValidationSummary = {
  kind: "orchestration";
  valid: boolean;
  error: string | null;
  warnings: string[];
  validatedAt: string;
  preview: {
    routingMode: "auto" | "supabase" | "local_dev";
    maxCloudUploadBytes: number;
    smallFileTarget: "supabase" | "local_dev";
    largeFileTarget: "supabase" | "local_dev";
    supabaseConfigured: boolean;
  };
};

type StorageProviderValidationSummary = {
  kind: "provider";
  valid: boolean;
  error: string | null;
  warnings: string[];
  validatedAt: string;
  runtimeSupported: boolean;
  canActivate: boolean;
  providerType: "supabase" | "local_filesystem" | "s3";
};

type ProductionDestinationSummary = {
  status: CustomerProductionDestinationViewStatus;
  totalCustomers: number;
  setCount: number;
  invalidCount: number;
  disabledCount: number;
};

type PublicProviderConfig =
  | {
      providerType: "supabase";
      bucketName: string;
      pathPrefix: string | null;
    }
  | {
      providerType: "local_filesystem";
      subfolderPrefix: string | null;
    }
  | {
      providerType: "s3";
      bucketName: string;
      region: string;
      endpoint: string;
      accessKeyId: string;
      secretAccessKeyConfigured: boolean;
      pathPrefix: string | null;
      forcePathStyle: boolean;
      providerLabel: string | null;
    };

export type StorageProviderView = {
  id: string;
  providerType: "supabase" | "local_filesystem" | "s3";
  displayName: string;
  status: StorageProviderViewStatus;
  persistedStatus: StorageProviderConfig["status"];
  role: StorageProviderConfig["role"];
  config: PublicProviderConfig;
  lastValidatedAt: string | null;
  validationError: string | null;
  runtimeSupported: boolean;
  canActivate: boolean;
  isActive: boolean;
};

export type OrganizationStorageSettingsView = {
  profile: {
    id: string | null;
    mode: "titan_managed" | "disabled";
    status: OrganizationStorageProfileViewStatus;
    persistedStatus: OrganizationStorageProfile["status"] | null;
    updatedAt: string | null;
    activeProviderConfigId: string | null;
  };
  orchestration: {
    id: string | null;
    displayName: string;
    config: ReturnType<typeof normalizeTitanManagedStorageConfig>;
    lastValidatedAt: string | null;
    validationError: string | null;
    validation: StorageOrchestrationValidationSummary | null;
  };
  providers: StorageProviderView[];
  activeProvider: StorageProviderView | null;
  productionDestinations: ProductionDestinationSummary;
};

function getProviderGroupKey(config: StorageProviderConfig | null | undefined): string | null {
  const raw = (config?.configJson as Record<string, unknown> | null | undefined)?.providerGroupKey;
  return typeof raw === "string" && raw.trim() ? raw.trim() : null;
}

function withProviderGroupKey(config: Record<string, unknown>, providerGroupKey: string) {
  return {
    ...config,
    providerGroupKey,
  };
}

function deriveProfileViewStatus(profile: OrganizationStorageProfile | null): OrganizationStorageProfileViewStatus {
  if (!profile) return "missing";
  if (profile.mode === "disabled" || profile.status === "disabled") return "disabled";
  if (profile.status === "active") return "active";
  return "draft";
}

function deriveProviderViewStatus(args: {
  persistedStatus: StorageProviderConfig["status"];
  isActive: boolean;
  profile: OrganizationStorageProfile | null;
}): StorageProviderViewStatus {
  if (args.profile?.mode === "disabled" || args.profile?.status === "disabled" || args.persistedStatus === "disabled") {
    return "disabled";
  }
  if (args.isActive) return "active";
  if (args.persistedStatus === "invalid") return "invalid";
  if (args.persistedStatus === "validated") return "valid";
  if (args.persistedStatus === "missing") return "missing";
  return "draft";
}

export class OrganizationStorageSettingsService {
  async getSettings(organizationId: string): Promise<OrganizationStorageSettingsView> {
    const profile = await organizationStorageProfileRepository.getByOrganizationId(organizationId);
    const canonicalRows = await storageProviderConfigRepository.listByOrganizationAndRole(organizationId, "canonical");
    const orchestrationRow = canonicalRows.find((row) => row.providerType === "titan_managed") ?? null;
    const providerRows = canonicalRows.filter((row) => row.providerType !== "titan_managed");
    const productionDestinations = await this.getProductionDestinationSummary(organizationId);
    const orchestrationValidation = orchestrationRow ? this.validateOrchestrationConfig(orchestrationRow.configJson) : null;

    const providers = await Promise.all(providerRows.map(async (row) => this.toProviderView(profile, row)));
    const activeProvider = providers.find((provider) => provider.isActive) ?? null;

    return {
      profile: {
        id: profile?.id ?? null,
        mode: profile?.mode === "disabled" ? "disabled" : "titan_managed",
        status: deriveProfileViewStatus(profile),
        persistedStatus: profile?.status ?? null,
        updatedAt: profile?.updatedAt ? new Date(profile.updatedAt).toISOString() : null,
        activeProviderConfigId: activeProvider?.id ?? null,
      },
      orchestration: {
        id: orchestrationRow?.id ?? null,
        displayName: orchestrationRow?.displayName ?? ORCHESTRATION_DISPLAY_NAME_CANONICAL,
        config: normalizeTitanManagedStorageConfig(orchestrationRow?.configJson),
        lastValidatedAt: orchestrationRow?.lastValidatedAt ? new Date(orchestrationRow.lastValidatedAt).toISOString() : null,
        validationError: orchestrationRow?.validationError ?? null,
        validation: orchestrationValidation,
      },
      providers,
      activeProvider,
      productionDestinations,
    };
  }

  async validateRequest(
    organizationId: string,
    rawInput: unknown,
  ): Promise<StorageOrchestrationValidationSummary | StorageProviderValidationSummary> {
    const parsed = storageSettingsValidateRequestSchema.parse(rawInput);
    if (parsed.kind === "orchestration") {
      return this.validateOrchestrationDraft(parsed.data);
    }
    return this.validateProviderDraft(organizationId, parsed.data);
  }

  async saveRequest(organizationId: string, rawInput: unknown): Promise<OrganizationStorageSettingsView> {
    const parsed = storageSettingsValidateRequestSchema.parse(rawInput);
    if (parsed.kind === "orchestration") {
      await this.saveOrchestrationSettings(organizationId, parsed.data);
    } else {
      await this.saveProviderDraft(organizationId, parsed.data);
    }
    return this.getSettings(organizationId);
  }

  async activateProvider(organizationId: string, providerConfigId: string): Promise<OrganizationStorageSettingsView> {
    const provider = await storageProviderConfigRepository.getByIdForOrganization(organizationId, providerConfigId);
    if (!provider || provider.providerType === "titan_managed") {
      throw new Error("Provider configuration not found.");
    }

    const validation = await this.validateSavedProvider(provider);
    if (!validation.canActivate) {
      throw new Error(validation.error || "This provider cannot be activated yet.");
    }

    const intakeProvider = await this.ensureIntakeProviderForCanonical(organizationId, provider);
    const existingProfile = await organizationStorageProfileRepository.getByOrganizationId(organizationId);
    const profileValues = {
      organizationId,
      mode: "titan_managed" as const,
      status: validation.valid ? "active" as const : "invalid" as const,
      primaryProviderConfigId: provider.id,
      intakeProviderConfigId: intakeProvider.id,
      archiveProviderConfigId: existingProfile?.archiveProviderConfigId ?? null,
    };

    if (existingProfile) {
      await organizationStorageProfileRepository.update(existingProfile.id, profileValues);
    } else {
      await organizationStorageProfileRepository.create({
        ...profileValues,
        productionFolderReferenceId: null,
      });
    }

    return this.getSettings(organizationId);
  }

  private validateOrchestrationDraft(input: StorageSettingsSaveInput): StorageOrchestrationValidationSummary {
    storageSettingsSaveSchema.parse(input);
    return this.validateOrchestrationConfig(input.config);
  }

  private validateOrchestrationConfig(rawConfig: unknown): StorageOrchestrationValidationSummary {
    const normalizedConfig = normalizeTitanManagedStorageConfig(rawConfig);
    const warnings: string[] = [];
    if (normalizedConfig.routingMode === "auto" && !isSupabaseConfigured()) {
      warnings.push("Supabase is not configured. Auto routing will send files to local storage until cloud storage is available.");
    }

    const maxCloudUploadBytes = getEffectiveMaxCloudUploadBytes(normalizedConfig);
    const smallFileTarget = normalizedConfig.routingMode === "local_dev"
      ? "local_dev"
      : normalizedConfig.routingMode === "supabase"
        ? "supabase"
        : isSupabaseConfigured() && SAMPLE_SMALL_FILE_BYTES <= maxCloudUploadBytes
          ? "supabase"
          : "local_dev";
    const largeFileTarget = normalizedConfig.routingMode === "local_dev"
      ? "local_dev"
      : normalizedConfig.routingMode === "supabase"
        ? "supabase"
        : isSupabaseConfigured() && SAMPLE_LARGE_FILE_BYTES <= maxCloudUploadBytes
          ? "supabase"
          : "local_dev";

    return {
      kind: "orchestration",
      valid: maxCloudUploadBytes > 0,
      error: maxCloudUploadBytes > 0 ? null : "Max cloud upload threshold must be greater than zero.",
      warnings,
      validatedAt: new Date().toISOString(),
      preview: {
        routingMode: normalizedConfig.routingMode,
        maxCloudUploadBytes,
        smallFileTarget,
        largeFileTarget,
        supabaseConfigured: isSupabaseConfigured(),
      },
    };
  }

  private async saveOrchestrationSettings(organizationId: string, input: StorageSettingsSaveInput): Promise<void> {
    const validation = this.validateOrchestrationDraft(input);
    const existingCanonical = await this.findOrchestrationConfig(organizationId, "canonical");
    const existingIntake = await this.findOrchestrationConfig(organizationId, "intake");

    const canonicalValues = {
      organizationId,
      providerType: "titan_managed" as const,
      role: "canonical" as const,
      status: input.mode === "disabled" ? "disabled" as const : validation.valid ? "validated" as const : "invalid" as const,
      displayName: input.displayName,
      configJson: input.config,
      validationError: validation.valid ? null : validation.error,
      lastValidatedAt: new Date(validation.validatedAt),
    };
    const intakeValues = {
      ...canonicalValues,
      role: "intake" as const,
      displayName: ORCHESTRATION_DISPLAY_NAME_INTAKE,
    };

    const canonical = existingCanonical
      ? await storageProviderConfigRepository.update(existingCanonical.id, canonicalValues)
      : await storageProviderConfigRepository.create(canonicalValues);
    const intake = existingIntake
      ? await storageProviderConfigRepository.update(existingIntake.id, intakeValues)
      : await storageProviderConfigRepository.create(intakeValues);

    const existingProfile = await organizationStorageProfileRepository.getByOrganizationId(organizationId);
    const activePointersNeedDefaults = !existingProfile?.primaryProviderConfigId || !existingProfile?.intakeProviderConfigId;
    const nextStatus: OrganizationStorageProfile["status"] = input.mode === "disabled"
      ? "disabled"
      : existingProfile?.primaryProviderConfigId && existingProfile.primaryProviderConfigId !== canonical.id
        ? existingProfile.status
        : validation.valid
          ? "active"
          : "invalid";

    const profileValues = {
      organizationId,
      mode: input.mode,
      status: nextStatus,
      primaryProviderConfigId: activePointersNeedDefaults ? canonical.id : existingProfile?.primaryProviderConfigId ?? canonical.id,
      intakeProviderConfigId: activePointersNeedDefaults ? intake.id : existingProfile?.intakeProviderConfigId ?? intake.id,
      archiveProviderConfigId: existingProfile?.archiveProviderConfigId ?? null,
    };

    if (existingProfile) {
      await organizationStorageProfileRepository.update(existingProfile.id, profileValues);
    } else {
      await organizationStorageProfileRepository.create({
        ...profileValues,
        productionFolderReferenceId: null,
      });
    }
  }

  private async validateProviderDraft(
    organizationId: string,
    input: StorageProviderDraftSaveInput,
  ): Promise<StorageProviderValidationSummary> {
    const parsed = storageProviderDraftSaveSchema.parse(input);
    const existing = parsed.providerConfigId
      ? await storageProviderConfigRepository.getByIdForOrganization(organizationId, parsed.providerConfigId)
      : null;
    const draft = this.buildDraftProviderRecord(organizationId, parsed, existing);
    return this.validateSavedProvider(draft);
  }

  private async saveProviderDraft(organizationId: string, input: StorageProviderDraftSaveInput): Promise<void> {
    const parsed = storageProviderDraftSaveSchema.parse(input);
    const existingCanonical = parsed.providerConfigId
      ? await storageProviderConfigRepository.getByIdForOrganization(organizationId, parsed.providerConfigId)
      : null;
    const providerGroupKey = getProviderGroupKey(existingCanonical) ?? randomUUID();
    const existingIntake = existingCanonical
      ? await this.findProviderPairByGroupKey(organizationId, providerGroupKey, "intake")
      : null;
    const validation = await this.validateProviderDraft(organizationId, parsed);

    const canonicalValues = {
      organizationId,
      providerType: parsed.providerType,
      role: "canonical" as const,
      status: validation.valid ? "validated" as const : "invalid" as const,
      displayName: parsed.displayName,
      configJson: this.buildPersistedProviderConfig(parsed, providerGroupKey, existingCanonical),
      validationError: validation.valid ? null : validation.error,
      lastValidatedAt: new Date(validation.validatedAt),
    };
    const intakeValues = {
      ...canonicalValues,
      role: "intake" as const,
    };

    await (existingCanonical
      ? storageProviderConfigRepository.update(existingCanonical.id, canonicalValues)
      : storageProviderConfigRepository.create(canonicalValues));
    await (existingIntake
      ? storageProviderConfigRepository.update(existingIntake.id, intakeValues)
      : storageProviderConfigRepository.create(intakeValues));
  }

  private buildDraftProviderRecord(
    organizationId: string,
    input: StorageProviderDraftSaveInput,
    existing: StorageProviderConfig | null,
  ): StorageProviderConfig {
    return {
      id: existing?.id ?? "draft",
      organizationId,
      providerType: input.providerType,
      role: "canonical",
      status: "configured",
      displayName: input.displayName,
      configJson: this.buildPersistedProviderConfig(input, getProviderGroupKey(existing) ?? "draft", existing),
      validationError: null,
      lastValidatedAt: null,
      createdAt: existing?.createdAt ?? new Date(),
      updatedAt: new Date(),
    };
  }

  private buildPersistedProviderConfig(
    input: StorageProviderDraftSaveInput,
    providerGroupKey: string,
    existing: StorageProviderConfig | null,
  ): Record<string, unknown> {
    if (input.providerType === "supabase") {
      return withProviderGroupKey(normalizeSupabaseStorageProviderConfig(input.config), providerGroupKey);
    }
    if (input.providerType === "local_filesystem") {
      return withProviderGroupKey(normalizeLocalFilesystemStorageProviderConfig(input.config), providerGroupKey);
    }

    const normalized = normalizeS3CompatibleStorageProviderConfig(input.config);
    const existingConfig = existing ? normalizeS3CompatibleStorageProviderConfig(existing.configJson) : null;
    const secretAccessKey = normalized.secretAccessKey || existingConfig?.secretAccessKey || null;

    return withProviderGroupKey({
      ...normalized,
      secretAccessKey,
      secretAccessKeyConfigured: !!secretAccessKey,
    }, providerGroupKey);
  }

  private async validateSavedProvider(provider: StorageProviderConfig): Promise<StorageProviderValidationSummary> {
    if (provider.providerType === "supabase") {
      return this.validateSupabaseProvider(provider);
    }
    if (provider.providerType === "local_filesystem") {
      return this.validateLocalFilesystemProvider(provider);
    }
    if (provider.providerType === "s3") {
      return this.validateS3CompatibleProvider(provider);
    }
    return {
      kind: "provider",
      valid: false,
      error: "Titan-managed orchestration rows are not direct provider configs.",
      warnings: [],
      validatedAt: new Date().toISOString(),
      runtimeSupported: false,
      canActivate: false,
      providerType: "supabase",
    };
  }

  private async validateSupabaseProvider(provider: StorageProviderConfig): Promise<StorageProviderValidationSummary> {
    const normalized = normalizeSupabaseStorageProviderConfig(provider.configJson);
    if (!isSupabaseConfigured()) {
      return {
        kind: "provider",
        valid: false,
        error: "Supabase server credentials are not configured in the current environment.",
        warnings: [],
        validatedAt: new Date().toISOString(),
        runtimeSupported: true,
        canActivate: false,
        providerType: "supabase",
      };
    }

    try {
      const service = new SupabaseStorageService(normalized.bucketName.trim());
      await service.listFiles(normalized.pathPrefix || "");
      return {
        kind: "provider",
        valid: true,
        error: null,
        warnings: [],
        validatedAt: new Date().toISOString(),
        runtimeSupported: true,
        canActivate: true,
        providerType: "supabase",
      };
    } catch (error: any) {
      return {
        kind: "provider",
        valid: false,
        error: error?.message || "Failed to validate Supabase provider.",
        warnings: [],
        validatedAt: new Date().toISOString(),
        runtimeSupported: true,
        canActivate: false,
        providerType: "supabase",
      };
    }
  }

  private async validateLocalFilesystemProvider(provider: StorageProviderConfig): Promise<StorageProviderValidationSummary> {
    try {
      const normalized = normalizeLocalFilesystemStorageProviderConfig(provider.configJson);
      const subfolder = (normalized.subfolderPrefix || "").trim().replace(/\\/g, "/");
      if (subfolder.split("/").some((segment) => segment === "..")) {
        throw new Error("Subfolder prefix cannot contain path traversal segments.");
      }
      return {
        kind: "provider",
        valid: true,
        error: null,
        warnings: [],
        validatedAt: new Date().toISOString(),
        runtimeSupported: true,
        canActivate: true,
        providerType: "local_filesystem",
      };
    } catch (error: any) {
      return {
        kind: "provider",
        valid: false,
        error: error?.message || "Failed to validate local filesystem provider.",
        warnings: [],
        validatedAt: new Date().toISOString(),
        runtimeSupported: true,
        canActivate: false,
        providerType: "local_filesystem",
      };
    }
  }

  private async validateS3CompatibleProvider(provider: StorageProviderConfig): Promise<StorageProviderValidationSummary> {
    const normalized = normalizeS3CompatibleStorageProviderConfig(provider.configJson);
    if (!normalized.secretAccessKeyConfigured || !normalized.secretAccessKey) {
      return {
        kind: "provider",
        valid: false,
        error: "Secret access key is required to validate an S3-compatible provider.",
        warnings: [],
        validatedAt: new Date().toISOString(),
        runtimeSupported: false,
        canActivate: false,
        providerType: "s3",
      };
    }

    try {
      const client = new S3Client({
        region: normalized.region,
        endpoint: normalized.endpoint,
        forcePathStyle: normalized.forcePathStyle,
        credentials: {
          accessKeyId: normalized.accessKeyId,
          secretAccessKey: normalized.secretAccessKey,
        },
      });
      await client.send(new HeadBucketCommand({ Bucket: normalized.bucketName }));
      return {
        kind: "provider",
        valid: true,
        error: null,
        warnings: ["S3-compatible providers can be saved and validated now, but activation remains blocked until legacy direct-upload surfaces are migrated to generic provider adapters."],
        validatedAt: new Date().toISOString(),
        runtimeSupported: false,
        canActivate: false,
        providerType: "s3",
      };
    } catch (error: any) {
      return {
        kind: "provider",
        valid: false,
        error: error?.message || "Failed to validate S3-compatible provider.",
        warnings: [],
        validatedAt: new Date().toISOString(),
        runtimeSupported: false,
        canActivate: false,
        providerType: "s3",
      };
    }
  }

  private async toProviderView(
    profile: OrganizationStorageProfile | null,
    provider: StorageProviderConfig,
  ): Promise<StorageProviderView> {
    const validation = await this.validateSavedProvider(provider);
    const isActive = profile?.primaryProviderConfigId === provider.id && profile?.status === "active";

    return {
      id: provider.id,
      providerType: provider.providerType as "supabase" | "local_filesystem" | "s3",
      displayName: provider.displayName,
      status: deriveProviderViewStatus({
        persistedStatus: provider.status,
        isActive,
        profile,
      }),
      persistedStatus: provider.status,
      role: provider.role,
      config: this.toPublicProviderConfig(provider),
      lastValidatedAt: provider.lastValidatedAt ? new Date(provider.lastValidatedAt).toISOString() : null,
      validationError: provider.validationError ?? validation.error,
      runtimeSupported: validation.runtimeSupported,
      canActivate: validation.canActivate,
      isActive,
    };
  }

  private toPublicProviderConfig(provider: StorageProviderConfig): PublicProviderConfig {
    if (provider.providerType === "supabase") {
      const normalized = normalizeSupabaseStorageProviderConfig(provider.configJson);
      return {
        providerType: "supabase",
        bucketName: normalized.bucketName,
        pathPrefix: normalized.pathPrefix ?? null,
      };
    }
    if (provider.providerType === "local_filesystem") {
      const normalized = normalizeLocalFilesystemStorageProviderConfig(provider.configJson);
      return {
        providerType: "local_filesystem",
        subfolderPrefix: normalized.subfolderPrefix ?? null,
      };
    }

    const normalized = normalizeS3CompatibleStorageProviderConfig(provider.configJson);
    return {
      providerType: "s3",
      bucketName: normalized.bucketName,
      region: normalized.region,
      endpoint: normalized.endpoint,
      accessKeyId: normalized.accessKeyId,
      secretAccessKeyConfigured: normalized.secretAccessKeyConfigured ?? false,
      pathPrefix: normalized.pathPrefix ?? null,
      forcePathStyle: normalized.forcePathStyle ?? true,
      providerLabel: normalized.providerLabel ?? null,
    };
  }

  private async ensureIntakeProviderForCanonical(
    organizationId: string,
    canonicalProvider: StorageProviderConfig,
  ): Promise<StorageProviderConfig> {
    const providerGroupKey = getProviderGroupKey(canonicalProvider) ?? randomUUID();
    const existing = await this.findProviderPairByGroupKey(organizationId, providerGroupKey, "intake");
    if (existing) {
      return existing;
    }

    return storageProviderConfigRepository.create({
      organizationId,
      providerType: canonicalProvider.providerType,
      role: "intake",
      status: canonicalProvider.status,
      displayName: canonicalProvider.displayName,
      configJson: withProviderGroupKey(canonicalProvider.configJson as Record<string, unknown>, providerGroupKey),
      validationError: canonicalProvider.validationError,
      lastValidatedAt: canonicalProvider.lastValidatedAt,
    });
  }

  private async findProviderPairByGroupKey(
    organizationId: string,
    providerGroupKey: string,
    role: StorageProviderConfig["role"],
  ): Promise<StorageProviderConfig | null> {
    const rows = await storageProviderConfigRepository.listByOrganizationAndRole(organizationId, role);
    return rows.find((row) => getProviderGroupKey(row) === providerGroupKey) ?? null;
  }

  private async findOrchestrationConfig(
    organizationId: string,
    role: StorageProviderConfig["role"],
  ): Promise<StorageProviderConfig | null> {
    const rows = await storageProviderConfigRepository.listByOrganizationAndRole(organizationId, role);
    return rows.find((row) => row.providerType === "titan_managed") ?? null;
  }

  private async getProductionDestinationSummary(organizationId: string): Promise<ProductionDestinationSummary> {
    const [{ totalCustomers = 0 } = {}] = await db
      .select({ totalCustomers: sql<number>`count(*)` })
      .from(customers)
      .where(eq(customers.organizationId, organizationId));

    const [{ setCount = 0, invalidCount = 0, disabledCount = 0 } = {}] = await db
      .select({
        setCount: sql<number>`count(*) filter (where ${customerProductionFolderReferences.status} in ('configured', 'validated'))`,
        invalidCount: sql<number>`count(*) filter (where ${customerProductionFolderReferences.status} = 'invalid')`,
        disabledCount: sql<number>`count(*) filter (where ${customerProductionFolderReferences.status} = 'disabled')`,
      })
      .from(customerProductionFolderReferences)
      .where(eq(customerProductionFolderReferences.organizationId, organizationId));

    const normalizedSetCount = Number(setCount);
    const normalizedInvalidCount = Number(invalidCount);
    const normalizedDisabledCount = Number(disabledCount);
    const status: CustomerProductionDestinationViewStatus = normalizedInvalidCount > 0
      ? "invalid"
      : normalizedSetCount > 0
        ? "set"
        : normalizedDisabledCount > 0
          ? "disabled"
          : "missing";

    return {
      status,
      totalCustomers: Number(totalCustomers),
      setCount: normalizedSetCount,
      invalidCount: normalizedInvalidCount,
      disabledCount: normalizedDisabledCount,
    };
  }
}

export const organizationStorageSettingsService = new OrganizationStorageSettingsService();
