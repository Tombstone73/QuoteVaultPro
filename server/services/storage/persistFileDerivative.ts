import type { FileDerivative } from "@shared/schema";
import { isSupabaseConfigured } from "../../supabaseStorage";
import { fileDerivativeRepository } from "../../storage/fileDerivative.repo";
import { storagePlacementRepository } from "../../storage/storagePlacement.repo";
import { deleteStoredObjectKeys } from "./deleteStoredObjectKeys";

const DEFAULT_PRIVATE_BUCKET = "titan-private";

export async function persistReadyFileDerivative(args: {
  fileRecordId?: string | null;
  derivativeType: FileDerivative["derivativeType"];
  objectKey: string;
  mimeType?: string | null;
  sizeBytes?: number | null;
}): Promise<void> {
  const fileRecordId = args.fileRecordId ? String(args.fileRecordId) : null;
  if (!fileRecordId) {
    return;
  }

  const canonicalPlacement = await storagePlacementRepository.getActiveCanonicalPlacementByFileRecordId(fileRecordId);
  const existing = await fileDerivativeRepository.listByFileRecordIdAndType(fileRecordId, args.derivativeType);

  await fileDerivativeRepository.replaceReady({
    fileRecordId,
    derivativeType: args.derivativeType,
    sourcePlacementId: canonicalPlacement?.id ?? null,
    bucket: canonicalPlacement?.bucket ?? (isSupabaseConfigured() ? DEFAULT_PRIVATE_BUCKET : null),
    objectKey: args.objectKey,
    mimeType: args.mimeType ?? null,
    sizeBytes: args.sizeBytes ?? null,
  });

  const staleKeys = existing
    .map((row) => row.objectKey ?? null)
    .filter((key): key is string => typeof key === "string" && key.length > 0 && key !== args.objectKey);

  if (staleKeys.length > 0) {
    await deleteStoredObjectKeys({
      keys: staleKeys,
      fileRecordId,
      sourcePlacementId: canonicalPlacement?.id ?? null,
      legacyStorageProvider: isSupabaseConfigured() ? "supabase" : null,
    }).catch((error) => {
      console.warn("[persistReadyFileDerivative] Failed to remove superseded derivative objects", {
        fileRecordId,
        derivativeType: args.derivativeType,
        staleKeys,
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }
}