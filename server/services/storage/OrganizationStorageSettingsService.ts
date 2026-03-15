import { eq, sql } from "drizzle-orm";
import {
  customerProductionFolderReferences,
  customers,
  type OrganizationStorageProfile,
  type StorageProviderConfig,
} from "@shared/schema";
import {
  storageSettingsSaveSchema,
  type CustomerProductionDestinationViewStatus,
  type OrganizationStorageProfileViewStatus,
  type StorageProviderViewStatus,
  type StorageSettingsSaveInput,
} from "@shared/storageSettings";
import { db } from "../../db";
import { organizationStorageProfileRepository } from "../../storage/organizationStorageProfile.repo";
import { storageProviderConfigRepository } from "../../storage/storageProviderConfig.repo";
import { storageRegistry } from "./StorageRegistry";
import { decideStorageTarget, getEffectiveMaxCloudUploadBytes, normalizeTitanManagedStorageConfig } from "../storageTarget";
import { isSupabaseConfigured } from "../../supabaseStorage";

const SAMPLE_SMALL_FILE_BYTES = 10 * 1024 * 1024;
const SAMPLE_LARGE_FILE_BYTES = 100 * 1024 * 1024;

type StorageValidationSummary = {
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

type ProductionDestinationSummary = {
  status: CustomerProductionDestinationViewStatus;
  totalCustomers: number;
  setCount: number;
  invalidCount: number;
  disabledCount: number;
};

export type OrganizationStorageSettingsView = {
  profile: {
    id: string | null;
    mode: "titan_managed" | "disabled";
    status: OrganizationStorageProfileViewStatus;
    persistedStatus: OrganizationStorageProfile["status"] | null;
    updatedAt: string | null;
  };
  provider: {
    id: string | null;
    providerType: "titan_managed";
    displayName: string;
    status: StorageProviderViewStatus;
    persistedStatus: StorageProviderConfig["status"] | null;
    config: ReturnType<typeof normalizeTitanManagedStorageConfig>;
    lastValidatedAt: string | null;
    validationError: string | null;
    isRuntimeActive: boolean;
  };
  validation: StorageValidationSummary | null;
  productionDestinations: ProductionDestinationSummary;
};

export class OrganizationStorageSettingsService {
  async getSettings(organizationId: string): Promise<OrganizationStorageSettingsView> {
    const profile = await organizationStorageProfileRepository.getByOrganizationId(organizationId);
    const canonicalConfig = await storageProviderConfigRepository.getByOrganizationAndRole(organizationId, "canonical");
    const intakeConfig = await storageProviderConfigRepository.getByOrganizationAndRole(organizationId, "intake");

    const provider = canonicalConfig ?? intakeConfig;
    const validation = provider ? await this.validateProvider(provider) : null;
    const productionDestinations = await this.getProductionDestinationSummary(organizationId);

    return this.buildView({
      profile,
      provider,
      validation,
      productionDestinations,
    });
  }

  async validateDraft(organizationId: string, rawInput: unknown): Promise<StorageValidationSummary> {
    const parsed = storageSettingsSaveSchema.parse(rawInput);
    const draftProvider = this.buildDraftProviderConfig(organizationId, parsed);
    return this.validateProvider(draftProvider);
  }

  async saveSettings(organizationId: string, rawInput: unknown): Promise<OrganizationStorageSettingsView> {
    const parsed = storageSettingsSaveSchema.parse(rawInput);
    const validation = await this.validateDraft(organizationId, parsed);

    const profile = await db.transaction(async (tx) => {
      const existingProfile = await organizationStorageProfileRepository.getByOrganizationId(organizationId);
      const existingCanonical = await storageProviderConfigRepository.getByOrganizationAndRole(organizationId, "canonical");
      const existingIntake = await storageProviderConfigRepository.getByOrganizationAndRole(organizationId, "intake");

      const providerStatus: StorageProviderConfig["status"] = parsed.mode === "disabled"
        ? "disabled"
        : validation.valid
          ? "validated"
          : "invalid";

      const canonicalValues = {
        organizationId,
        providerType: parsed.providerType,
        role: "canonical" as const,
        status: providerStatus,
        displayName: parsed.displayName,
        configJson: parsed.config,
        validationError: validation.valid ? null : validation.error,
        lastValidatedAt: new Date(validation.validatedAt),
      };

      const intakeValues = {
        organizationId,
        providerType: parsed.providerType,
        role: "intake" as const,
        status: providerStatus,
        displayName: parsed.displayName,
        configJson: parsed.config,
        validationError: validation.valid ? null : validation.error,
        lastValidatedAt: new Date(validation.validatedAt),
      };

      const canonical = existingCanonical
        ? await storageProviderConfigRepository.update(existingCanonical.id, canonicalValues, tx)
        : await storageProviderConfigRepository.create(canonicalValues, tx);

      const intake = existingIntake
        ? await storageProviderConfigRepository.update(existingIntake.id, intakeValues, tx)
        : await storageProviderConfigRepository.create(intakeValues, tx);

      const nextMode = parsed.mode;
      const nextProfileStatus: OrganizationStorageProfile["status"] = nextMode === "disabled"
        ? "disabled"
        : parsed.activate && validation.valid
          ? "active"
          : "unconfigured";

      const profileValues = {
        organizationId,
        mode: nextMode,
        status: nextProfileStatus,
        primaryProviderConfigId: canonical.id,
        intakeProviderConfigId: intake.id,
        archiveProviderConfigId: null,
      };

      if (existingProfile) {
        return organizationStorageProfileRepository.update(existingProfile.id, profileValues, tx);
      }

      return organizationStorageProfileRepository.create({
        ...profileValues,
        productionFolderReferenceId: null,
      }, tx);
    });

    const productionDestinations = await this.getProductionDestinationSummary(organizationId);
    const canonicalConfig = await storageProviderConfigRepository.getByOrganizationAndRole(organizationId, "canonical");

    return this.buildView({
      profile,
      provider: canonicalConfig,
      validation,
      productionDestinations,
    });
  }

  private buildDraftProviderConfig(organizationId: string, parsed: StorageSettingsSaveInput): StorageProviderConfig {
    return {
      id: "draft",
      organizationId,
      providerType: parsed.providerType,
      role: "canonical",
      status: parsed.mode === "disabled" ? "disabled" : "configured",
      displayName: parsed.displayName,
      configJson: parsed.config,
      validationError: null,
      lastValidatedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }

  private async validateProvider(provider: StorageProviderConfig): Promise<StorageValidationSummary> {
    const normalizedConfig = normalizeTitanManagedStorageConfig(provider.configJson);
    const adapter = storageRegistry.getAdapter(provider.providerType);
    const result = await adapter.validateConfig(provider);
    const warnings: string[] = [];

    if (normalizedConfig.routingMode === "auto" && !isSupabaseConfigured()) {
      warnings.push("Supabase is not configured. TitanOS will route uploads to local dev storage until cloud storage is available.");
    }

    const maxCloudUploadBytes = getEffectiveMaxCloudUploadBytes(provider.configJson);

    return {
      valid: result.valid,
      error: result.error,
      warnings,
      validatedAt: result.validatedAt.toISOString(),
      preview: {
        routingMode: normalizedConfig.routingMode,
        maxCloudUploadBytes,
        smallFileTarget: decideStorageTarget({
          fileName: "sample-small.pdf",
          fileSizeBytes: SAMPLE_SMALL_FILE_BYTES,
          organizationId: provider.organizationId,
          context: "storage-settings.preview.small",
          providerConfigJson: provider.configJson,
        }),
        largeFileTarget: decideStorageTarget({
          fileName: "sample-large.pdf",
          fileSizeBytes: SAMPLE_LARGE_FILE_BYTES,
          organizationId: provider.organizationId,
          context: "storage-settings.preview.large",
          providerConfigJson: provider.configJson,
        }),
        supabaseConfigured: isSupabaseConfigured(),
      },
    };
  }

  private buildView(args: {
    profile: OrganizationStorageProfile | null;
    provider: StorageProviderConfig | null;
    validation: StorageValidationSummary | null;
    productionDestinations: ProductionDestinationSummary;
  }): OrganizationStorageSettingsView {
    const profileStatus = this.getProfileViewStatus(args.profile);
    const providerStatus = this.getProviderViewStatus(args.profile, args.provider);

    return {
      profile: {
        id: args.profile?.id ?? null,
        mode: args.profile?.mode === "disabled" ? "disabled" : "titan_managed",
        status: profileStatus,
        persistedStatus: args.profile?.status ?? null,
        updatedAt: args.profile?.updatedAt ? new Date(args.profile.updatedAt).toISOString() : null,
      },
      provider: {
        id: args.provider?.id ?? null,
        providerType: "titan_managed",
        displayName: args.provider?.displayName ?? "Titan Managed Storage",
        status: providerStatus,
        persistedStatus: args.provider?.status ?? null,
        config: normalizeTitanManagedStorageConfig(args.provider?.configJson),
        lastValidatedAt: args.provider?.lastValidatedAt ? new Date(args.provider.lastValidatedAt).toISOString() : null,
        validationError: args.provider?.validationError ?? null,
        isRuntimeActive: providerStatus === "active",
      },
      validation: args.validation,
      productionDestinations: args.productionDestinations,
    };
  }

  private getProfileViewStatus(profile: OrganizationStorageProfile | null): OrganizationStorageProfileViewStatus {
    if (!profile) return "missing";
    if (profile.mode === "disabled" || profile.status === "disabled") return "disabled";
    if (profile.status === "active") return "active";
    return "draft";
  }

  private getProviderViewStatus(
    profile: OrganizationStorageProfile | null,
    provider: StorageProviderConfig | null,
  ): StorageProviderViewStatus {
    if (!provider) return "missing";
    if (provider.status === "disabled" || profile?.status === "disabled" || profile?.mode === "disabled") return "disabled";
    if (profile?.status === "active" && profile.primaryProviderConfigId === provider.id) return "active";
    if (provider.status === "invalid") return "invalid";
    if (provider.status === "validated") return "valid";
    return "draft";
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
