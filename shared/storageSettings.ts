import { z } from "zod";

export const storageSettingsModeSchema = z.enum(["titan_managed", "disabled"]);
export const storageProviderSettingsTypeSchema = z.literal("titan_managed");
export const titanManagedRoutingModeSchema = z.enum(["auto", "supabase", "local_dev"]);

export const titanManagedStorageConfigSchema = z.object({
  routingMode: titanManagedRoutingModeSchema.default("auto"),
  maxCloudUploadBytesOverride: z.number().int().positive().nullable().optional(),
});

export const storageSettingsSaveSchema = z.object({
  mode: storageSettingsModeSchema,
  providerType: storageProviderSettingsTypeSchema,
  displayName: z.string().min(1).max(255),
  activate: z.boolean().optional().default(false),
  config: titanManagedStorageConfigSchema,
});

export type StorageSettingsMode = z.infer<typeof storageSettingsModeSchema>;
export type TitanManagedRoutingMode = z.infer<typeof titanManagedRoutingModeSchema>;
export type TitanManagedStorageConfig = z.infer<typeof titanManagedStorageConfigSchema>;
export type StorageSettingsSaveInput = z.infer<typeof storageSettingsSaveSchema>;

export type OrganizationStorageProfileViewStatus = "missing" | "draft" | "active" | "disabled";
export type StorageProviderViewStatus = "missing" | "draft" | "valid" | "invalid" | "active" | "disabled";
export type CustomerProductionDestinationViewStatus = "missing" | "set" | "invalid" | "disabled";
