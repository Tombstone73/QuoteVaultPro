export async function deleteStoredObjectKeys(args: {
  keys: Array<string | null | undefined>;
  fileRecordId?: string | null;
  sourcePlacementId?: string | null;
  legacyStorageProvider?: "local" | "s3" | "gcs" | "supabase" | null;
}): Promise<{ deletedKeys: string[]; failedKeys: string[] }> {
  const uniqueKeys = Array.from(
    new Set(
      args.keys
        .map((key) => (typeof key === "string" ? key.trim() : ""))
        .filter((key): key is string => key.length > 0),
    ),
  );
  if (uniqueKeys.length === 0) {
    return { deletedKeys: [], failedKeys: [] };
  }

  const { normalizeObjectKeyForDb } = await import("../../lib/supabaseObjectHelpers");
  const { storagePlacementRepository } = await import("../../storage/storagePlacement.repo");
  const { storageProviderConfigRepository } = await import("../../storage/storageProviderConfig.repo");

  const placement = args.sourcePlacementId
    ? await storagePlacementRepository.getById(String(args.sourcePlacementId))
    : args.fileRecordId
      ? await storagePlacementRepository.getActiveCanonicalPlacementByFileRecordId(String(args.fileRecordId))
      : null;
  const providerConfig = placement?.providerConfigId
    ? await storageProviderConfigRepository.getById(String(placement.providerConfigId))
    : null;

  if (providerConfig) {
    const { storageRegistry } = await import("./StorageRegistry");
    const adapter = storageRegistry.getAdapter(providerConfig.providerType);
    const results = await Promise.all(
      uniqueKeys.map((key) =>
        adapter.deleteObject({
          providerConfig,
          objectKey: providerConfig.providerType === "local_filesystem" ? null : normalizeObjectKeyForDb(key),
          localPathRef: providerConfig.providerType === "local_filesystem" ? key : null,
        }).catch(() => false),
      ),
    );
    return {
      deletedKeys: uniqueKeys.filter((_, index) => results[index] === true),
      failedKeys: uniqueKeys.filter((_, index) => results[index] !== true),
    };
  }

  if (args.legacyStorageProvider === "supabase") {
    const { isSupabaseConfigured, SupabaseStorageService } = await import("../../supabaseStorage");
    if (!isSupabaseConfigured()) {
      return { deletedKeys: [], failedKeys: uniqueKeys };
    }
    const supabase = new SupabaseStorageService();
    const results = await Promise.all(uniqueKeys.map((key) => supabase.deleteFile(normalizeObjectKeyForDb(key)).catch(() => false)));
    return {
      deletedKeys: uniqueKeys.filter((_, index) => results[index] === true),
      failedKeys: uniqueKeys.filter((_, index) => results[index] !== true),
    };
  }

  if (args.legacyStorageProvider === "local") {
    const { deleteFile } = await import("../../utils/fileStorage");
    const results = await Promise.all(uniqueKeys.map((key) => deleteFile(key).catch(() => false)));
    return {
      deletedKeys: uniqueKeys.filter((_, index) => results[index] === true),
      failedKeys: uniqueKeys.filter((_, index) => results[index] !== true),
    };
  }

  return { deletedKeys: [], failedKeys: uniqueKeys };
}
