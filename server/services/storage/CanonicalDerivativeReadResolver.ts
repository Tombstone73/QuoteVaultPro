import type { FileDerivative } from "@shared/schema";
import { fileDerivativeRepository } from "../../storage/fileDerivative.repo";
import { storagePlacementRepository } from "../../storage/storagePlacement.repo";

export type CanonicalDerivativeReadStatus = "available" | "pending" | "missing" | "failed";

export type CanonicalDerivativeReadResult = {
  fileRecordId: string;
  derivativeType: FileDerivative["derivativeType"];
  derivativeId: string | null;
  status: CanonicalDerivativeReadStatus;
  bucket: string | null;
  objectKey: string | null;
  providerConfigId: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
};

export class CanonicalDerivativeReadResolver {
  async resolveDerivative(
    fileRecordId: string,
    derivativeType: FileDerivative["derivativeType"],
  ): Promise<CanonicalDerivativeReadResult> {
    const derivative = await fileDerivativeRepository.getPreferredByFileRecordIdAndType(fileRecordId, derivativeType);
    const sourcePlacement = derivative?.sourcePlacementId
      ? await storagePlacementRepository.getById(String(derivative.sourcePlacementId))
      : null;

    return {
      fileRecordId,
      derivativeType,
      derivativeId: derivative?.id ?? null,
      status:
        derivative?.state === "ready" && !!derivative.objectKey
          ? "available"
          : derivative?.state === "pending"
            ? "pending"
            : derivative?.state === "failed"
              ? "failed"
            : "missing",
      bucket: derivative?.bucket ?? null,
      objectKey: derivative?.objectKey ?? null,
      providerConfigId: sourcePlacement?.providerConfigId ?? null,
      mimeType: derivative?.mimeType ?? null,
      sizeBytes: derivative?.sizeBytes ?? null,
    };
  }
}

export const canonicalDerivativeReadResolver = new CanonicalDerivativeReadResolver();
