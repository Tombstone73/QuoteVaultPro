import { z } from "zod";

export const storageSettingsModeSchema = z.enum(["titan_managed", "disabled"]);
export const titanManagedRoutingModeSchema = z.enum(["auto", "supabase", "local_dev"]);
export const storageProviderSettingsTypeSchema = z.literal("titan_managed");
export const configurableStorageProviderTypeSchema = z.enum(["supabase", "local_filesystem", "s3"]);

export const titanManagedStorageConfigSchema = z.object({
  routingMode: titanManagedRoutingModeSchema.default("auto"),
  // Legacy development routing threshold. This is not a production storage
  // capacity limit: production canonical files must remain durable at any size.
  maxCloudUploadBytesOverride: z.number().int().positive().nullable().optional(),
  // An explicit organization limit, used only when the configured durable
  // provider has a known operational ceiling.
  maxDurableUploadBytesOverride: z.number().int().positive().nullable().optional(),
});

export const supabaseStorageProviderConfigSchema = z.object({
  bucketName: z.string().min(1).max(255).default("titan-private"),
  pathPrefix: z.string().max(1024).nullable().optional(),
});

export const localFilesystemStorageProviderConfigSchema = z.object({
  subfolderPrefix: z.string().max(1024).nullable().optional(),
});

export const s3CompatibleStorageProviderConfigSchema = z.object({
  bucketName: z.string().min(1).max(255),
  region: z.string().min(1).max(255),
  endpoint: z.string().url().max(2048),
  accessKeyId: z.string().min(1).max(255),
  secretAccessKey: z.string().min(1).max(1024).nullable().optional(),
  secretAccessKeyConfigured: z.boolean().optional(),
  pathPrefix: z.string().max(1024).nullable().optional(),
  forcePathStyle: z.boolean().default(true),
  providerLabel: z.string().max(255).nullable().optional(),
});

export const storageSettingsSaveSchema = z.object({
  mode: storageSettingsModeSchema,
  providerType: storageProviderSettingsTypeSchema,
  displayName: z.string().min(1).max(255),
  activate: z.boolean().optional().default(false),
  config: titanManagedStorageConfigSchema,
});

const providerDraftBaseSchema = z.object({
  providerConfigId: z.string().min(1).optional().nullable(),
  displayName: z.string().min(1).max(255),
});

export const storageProviderDraftSaveSchema = z.discriminatedUnion("providerType", [
  providerDraftBaseSchema.extend({
    providerType: z.literal("supabase"),
    config: supabaseStorageProviderConfigSchema,
  }),
  providerDraftBaseSchema.extend({
    providerType: z.literal("local_filesystem"),
    config: localFilesystemStorageProviderConfigSchema,
  }),
  providerDraftBaseSchema.extend({
    providerType: z.literal("s3"),
    config: s3CompatibleStorageProviderConfigSchema,
  }),
]);

export const storageSettingsValidateRequestSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("orchestration"),
    data: storageSettingsSaveSchema,
  }),
  z.object({
    kind: z.literal("provider"),
    data: storageProviderDraftSaveSchema,
  }),
]);

export const storageSettingsSaveRequestSchema = storageSettingsValidateRequestSchema;

export const storageProviderActivationSchema = z.object({
  providerConfigId: z.string().min(1),
});

export type StorageSettingsMode = z.infer<typeof storageSettingsModeSchema>;
export type TitanManagedRoutingMode = z.infer<typeof titanManagedRoutingModeSchema>;
export type TitanManagedStorageConfig = z.infer<typeof titanManagedStorageConfigSchema>;
export type StorageSettingsSaveInput = z.infer<typeof storageSettingsSaveSchema>;
export type ConfigurableStorageProviderType = z.infer<typeof configurableStorageProviderTypeSchema>;
export type SupabaseStorageProviderConfig = z.infer<typeof supabaseStorageProviderConfigSchema>;
export type LocalFilesystemStorageProviderConfig = z.infer<typeof localFilesystemStorageProviderConfigSchema>;
export type S3CompatibleStorageProviderConfig = z.infer<typeof s3CompatibleStorageProviderConfigSchema>;
export type StorageProviderDraftSaveInput = z.infer<typeof storageProviderDraftSaveSchema>;
export type StorageSettingsValidateRequest = z.infer<typeof storageSettingsValidateRequestSchema>;
export type StorageSettingsSaveRequest = z.infer<typeof storageSettingsSaveRequestSchema>;
export type StorageProviderActivationInput = z.infer<typeof storageProviderActivationSchema>;

export type OrganizationStorageProfileViewStatus = "missing" | "draft" | "active" | "disabled";
export type StorageProviderViewStatus = "missing" | "draft" | "valid" | "invalid" | "active" | "disabled";
export type CustomerProductionDestinationViewStatus = "missing" | "set" | "invalid" | "disabled";

export function normalizeTitanManagedStorageConfig(raw: unknown): TitanManagedStorageConfig {
  const parsed = titanManagedStorageConfigSchema.safeParse(raw ?? {});
  if (!parsed.success) {
    return {
      routingMode: "auto",
      maxCloudUploadBytesOverride: null,
      maxDurableUploadBytesOverride: null,
    };
  }

  return {
    routingMode: parsed.data.routingMode ?? "auto",
    maxCloudUploadBytesOverride: parsed.data.maxCloudUploadBytesOverride ?? null,
    maxDurableUploadBytesOverride: parsed.data.maxDurableUploadBytesOverride ?? null,
  };
}

export function normalizeSupabaseStorageProviderConfig(raw: unknown): SupabaseStorageProviderConfig {
  const parsed = supabaseStorageProviderConfigSchema.safeParse(raw ?? {});
  if (!parsed.success) {
    return {
      bucketName: "titan-private",
      pathPrefix: null,
    };
  }

  return {
    bucketName: parsed.data.bucketName,
    pathPrefix: parsed.data.pathPrefix ?? null,
  };
}

export function normalizeLocalFilesystemStorageProviderConfig(raw: unknown): LocalFilesystemStorageProviderConfig {
  const parsed = localFilesystemStorageProviderConfigSchema.safeParse(raw ?? {});
  if (!parsed.success) {
    return {
      subfolderPrefix: null,
    };
  }

  return {
    subfolderPrefix: parsed.data.subfolderPrefix ?? null,
  };
}

export function normalizeS3CompatibleStorageProviderConfig(raw: unknown): S3CompatibleStorageProviderConfig {
  const parsed = s3CompatibleStorageProviderConfigSchema.safeParse(raw ?? {});
  if (!parsed.success) {
    return {
      bucketName: "",
      region: "",
      endpoint: "",
      accessKeyId: "",
      secretAccessKey: null,
      secretAccessKeyConfigured: false,
      pathPrefix: null,
      forcePathStyle: true,
      providerLabel: null,
    };
  }

  return {
    bucketName: parsed.data.bucketName,
    region: parsed.data.region,
    endpoint: parsed.data.endpoint,
    accessKeyId: parsed.data.accessKeyId,
    secretAccessKey: parsed.data.secretAccessKey ?? null,
    secretAccessKeyConfigured: parsed.data.secretAccessKeyConfigured ?? !!parsed.data.secretAccessKey,
    pathPrefix: parsed.data.pathPrefix ?? null,
    forcePathStyle: parsed.data.forcePathStyle ?? true,
    providerLabel: parsed.data.providerLabel ?? null,
  };
}
