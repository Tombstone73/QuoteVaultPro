import type { FileDerivative } from "@shared/schema";
import { fileDerivativeRepository } from "../../storage/fileDerivative.repo";

export type CanonicalDerivativeReadStatus = "available" | "pending" | "missing";

export type CanonicalDerivativeReadResult = {
  fileRecordId: string;
  derivativeType: FileDerivative["derivativeType"];
  derivativeId: string | null;
  status: CanonicalDerivativeReadStatus;
  bucket: string | null;
  objectKey: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
};

export class CanonicalDerivativeReadResolver {
  async resolveDerivative(
    fileRecordId: string,
    derivativeType: FileDerivative["derivativeType"],
  ): Promise<CanonicalDerivativeReadResult> {
    const derivative = await fileDerivativeRepository.getPreferredByFileRecordIdAndType(fileRecordId, derivativeType);

    return {
      fileRecordId,
      derivativeType,
      derivativeId: derivative?.id ?? null,
      status:
        derivative?.state === "ready" && !!derivative.objectKey
          ? "available"
          : derivative?.state === "pending"
            ? "pending"
            : "missing",
      bucket: derivative?.bucket ?? null,
      objectKey: derivative?.objectKey ?? null,
      mimeType: derivative?.mimeType ?? null,
      sizeBytes: derivative?.sizeBytes ?? null,
    };
  }
}

export const canonicalDerivativeReadResolver = new CanonicalDerivativeReadResolver();