import { isSupabaseConfigured, SupabaseStorageService } from "../../supabaseStorage";
import { normalizeObjectKeyForDb } from "../../lib/supabaseObjectHelpers";
import { storagePlacementRepository } from "../../storage/storagePlacement.repo";
import { storageProviderConfigRepository } from "../../storage/storageProviderConfig.repo";
import { storageRegistry } from "./StorageRegistry";

export async function deleteStoredObjectKeys(args: {
  keys: Array<string | null | undefined>;
  fileRecordId?: string | null;
  sourcePlacementId?: string | null;
  legacyStorageProvider?: "local" | "s3" | "gcs" | "supabase" | null;
}): Promise<void> {
  const uniqueKeys = Array.from(
    new Set(
      args.keys
        .map((key) => (typeof key === "string" ? key.trim() : ""))
        .filter((key): key is string => key.length > 0),
    ),
  );
  if (uniqueKeys.length === 0) {
    return;
  }

  const placement = args.sourcePlacementId
    ? await storagePlacementRepository.getById(String(args.sourcePlacementId))
    : args.fileRecordId
      ? await storagePlacementRepository.getActiveCanonicalPlacementByFileRecordId(String(args.fileRecordId))
      : null;
  const providerConfig = placement?.providerConfigId
    ? await storageProviderConfigRepository.getById(String(placement.providerConfigId))
    : null;

  if (providerConfig) {
    const adapter = storageRegistry.getAdapter(providerConfig.providerType);
    await Promise.all(
      uniqueKeys.map((key) =>
        adapter.deleteObject({
          providerConfig,
          objectKey: providerConfig.providerType === "local_filesystem" ? null : normalizeObjectKeyForDb(key),
          localPathRef: providerConfig.providerType === "local_filesystem" ? key : null,
        }).catch(() => false),
      ),
    );
    return;
  }

  if (args.legacyStorageProvider === "supabase" && isSupabaseConfigured()) {
    const supabase = new SupabaseStorageService();
    await Promise.all(uniqueKeys.map((key) => supabase.deleteFile(normalizeObjectKeyForDb(key)).catch(() => false)));
    return;
  }

  if (args.legacyStorageProvider === "local") {
    const { deleteFile } = await import("../../utils/fileStorage");
    await Promise.all(uniqueKeys.map((key) => deleteFile(key).catch(() => false)));
  }
}
