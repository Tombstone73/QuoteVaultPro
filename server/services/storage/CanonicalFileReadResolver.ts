import type { FileRecord, StoragePlacement } from "@shared/schema";
import { fileRecordRepository } from "../../storage/fileRecord.repo";
import { storagePlacementRepository } from "../../storage/storagePlacement.repo";
import { storageProviderConfigRepository } from "../../storage/storageProviderConfig.repo";

export type CanonicalFileReadStatus = "available" | "archived" | "restoring" | "missing";

export type CanonicalFileReadResult = {
  fileRecordId: string;
  status: CanonicalFileReadStatus;
  placementState: StoragePlacement["placementState"] | null;
  providerConfigId: string | null;
  providerType: "titan_managed" | "supabase" | "local_filesystem" | "s3" | "gcs" | "azure_blob" | null;
  bucket: string | null;
  objectKey: string | null;
  localPathRef: string | null;
  displayFilename: string | null;
  mimeType: string | null;
};

function deriveStatus(
  fileRecord: FileRecord | null,
  placement: StoragePlacement | null,
): CanonicalFileReadStatus {
  if (!fileRecord) {
    return "missing";
  }

  if (fileRecord.lifecycleState === "archived") {
    return "archived";
  }

  if (fileRecord.lifecycleState === "restore_pending") {
    return "restoring";
  }

  if (!placement) {
    return "missing";
  }

  if (placement.placementState === "active") {
    return "available";
  }

  if (placement.placementState === "restore_source") {
    return "restoring";
  }

  return "missing";
}

export class CanonicalFileReadResolver {
  async resolveOriginal(fileRecordId: string): Promise<CanonicalFileReadResult> {
    const fileRecord = await fileRecordRepository.getById(fileRecordId);
    const placement = fileRecord
      ? await storagePlacementRepository.getActiveCanonicalPlacementByFileRecordId(fileRecordId)
      : null;
    const providerConfig = placement?.providerConfigId
      ? await storageProviderConfigRepository.getById(placement.providerConfigId)
      : null;

    return {
      fileRecordId,
      status: deriveStatus(fileRecord, placement),
      placementState: placement?.placementState ?? null,
      providerConfigId: placement?.providerConfigId ?? null,
      providerType: providerConfig?.providerType ?? null,
      bucket: placement?.bucket ?? null,
      objectKey: placement?.objectKey ?? null,
      localPathRef: placement?.localPathRef ?? null,
      displayFilename: fileRecord?.originalFilename ?? null,
      mimeType: fileRecord?.mimeType ?? null,
    };
  }
}

export const canonicalFileReadResolver = new CanonicalFileReadResolver();