import type { OrganizationStorageProfile, StorageProviderConfig } from "@shared/schema";
import { organizationStorageProfileRepository } from "../../storage/organizationStorageProfile.repo";
import { storageProviderConfigRepository } from "../../storage/storageProviderConfig.repo";

export type ResolvedStoragePolicy = {
  profile: OrganizationStorageProfile;
  intakeProviderConfig: StorageProviderConfig;
  canonicalProviderConfig: StorageProviderConfig;
  archiveProviderConfig: StorageProviderConfig | null;
  effectiveMode: OrganizationStorageProfile["mode"];
};

export class StoragePolicyResolver {
  async loadOrganizationStorageProfile(organizationId: string): Promise<OrganizationStorageProfile> {
    const existing = await organizationStorageProfileRepository.getByOrganizationId(organizationId);
    if (existing) {
      return existing;
    }

    const intakeConfig = await this.ensureTitanManagedConfig(organizationId, "intake");
    const canonicalConfig = await this.ensureTitanManagedConfig(organizationId, "canonical");

    return organizationStorageProfileRepository.create({
      organizationId,
      mode: "titan_managed",
      status: "active",
      primaryProviderConfigId: canonicalConfig.id,
      intakeProviderConfigId: intakeConfig.id,
      archiveProviderConfigId: null,
      productionFolderReferenceId: null,
    });
  }

  async resolve(organizationId: string): Promise<ResolvedStoragePolicy> {
    let profile = await this.loadOrganizationStorageProfile(organizationId);

    if (profile.mode === "disabled" || profile.status === "disabled") {
      throw new Error("Storage is disabled for this organization");
    }

    const intakeProviderConfig = await this.resolveRequiredProviderConfig(
      organizationId,
      profile.intakeProviderConfigId,
      "intake",
    );
    const canonicalProviderConfig = await this.resolveRequiredProviderConfig(
      organizationId,
      profile.primaryProviderConfigId,
      "canonical",
    );
    const archiveProviderConfig = profile.archiveProviderConfigId
      ? await storageProviderConfigRepository.getByIdForOrganization(organizationId, profile.archiveProviderConfigId)
      : null;

    if (
      profile.primaryProviderConfigId !== canonicalProviderConfig.id ||
      profile.intakeProviderConfigId !== intakeProviderConfig.id
    ) {
      profile = await organizationStorageProfileRepository.update(profile.id, {
        primaryProviderConfigId: canonicalProviderConfig.id,
        intakeProviderConfigId: intakeProviderConfig.id,
      });
    }

    return {
      profile,
      intakeProviderConfig,
      canonicalProviderConfig,
      archiveProviderConfig,
      effectiveMode: profile.mode,
    };
  }

  resolveActiveStorageMode(policy: ResolvedStoragePolicy): OrganizationStorageProfile["mode"] {
    return policy.effectiveMode;
  }

  resolveCanonicalStorageBehavior(policy: ResolvedStoragePolicy): StorageProviderConfig {
    return policy.canonicalProviderConfig;
  }

  resolveIntakeStorageBehavior(policy: ResolvedStoragePolicy): StorageProviderConfig {
    return policy.intakeProviderConfig;
  }

  private async resolveRequiredProviderConfig(
    organizationId: string,
    configId: string | null,
    role: StorageProviderConfig["role"],
  ): Promise<StorageProviderConfig> {
    if (configId) {
      const existing = await storageProviderConfigRepository.getByIdForOrganization(organizationId, configId);
      if (existing) {
        return existing;
      }
    }

    return this.ensureTitanManagedConfig(organizationId, role);
  }

  private async ensureTitanManagedConfig(
    organizationId: string,
    role: StorageProviderConfig["role"],
  ): Promise<StorageProviderConfig> {
    const existing = await storageProviderConfigRepository.getByOrganizationAndRole(organizationId, role);
    if (existing) {
      return existing;
    }

    const displayName = role === "canonical" ? "Titan Managed Canonical" : role === "intake" ? "Titan Managed Intake" : "Titan Managed Archive";

    return storageProviderConfigRepository.create({
      organizationId,
      providerType: "titan_managed",
      role,
      status: "validated",
      displayName,
      configJson: {
        managedBy: "TitanOS",
        mode: "titan_managed",
      },
      validationError: null,
      lastValidatedAt: new Date(),
    });
  }
}

export const storagePolicyResolver = new StoragePolicyResolver();
