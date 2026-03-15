import type { FileDerivative } from "@shared/schema";
import { isSupabaseConfigured } from "../../supabaseStorage";
import { fileDerivativeRepository } from "../../storage/fileDerivative.repo";
import { storagePlacementRepository } from "../../storage/storagePlacement.repo";

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

  await fileDerivativeRepository.replaceReady({
    fileRecordId,
    derivativeType: args.derivativeType,
    sourcePlacementId: canonicalPlacement?.id ?? null,
    bucket: canonicalPlacement?.bucket ?? (isSupabaseConfigured() ? DEFAULT_PRIVATE_BUCKET : null),
    objectKey: args.objectKey,
    mimeType: args.mimeType ?? null,
    sizeBytes: args.sizeBytes ?? null,
  });
}