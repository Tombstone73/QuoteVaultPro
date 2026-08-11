import { canonicalDerivativeReadResolver } from "../storage/CanonicalDerivativeReadResolver";
import { canonicalFileReadResolver } from "../storage/CanonicalFileReadResolver";
import { fileRecordRepository } from "../../storage/fileRecord.repo";
import { storageProviderConfigRepository } from "../../storage/storageProviderConfig.repo";
import { storageRegistry } from "../storage/StorageRegistry";

export type ArtworkAccessVariant = "original" | "preview" | "thumbnail";

export type ArtworkAccessResult = {
  buffer: Buffer;
  mimeType: string;
  filename: string;
};

/**
 * Canonical authenticated read path for physical artwork files.  Callers supply
 * only a file-record identity; provider/object paths stay inside this layer.
 */
export async function readArtworkFileForOrganization(args: {
  organizationId: string;
  fileRecordId: string;
  variant: ArtworkAccessVariant;
}): Promise<ArtworkAccessResult | null> {
  const fileRecord = await fileRecordRepository.getByIdForOrganization(args.organizationId, args.fileRecordId);
  if (!fileRecord) return null;

  const source = args.variant === "original"
    ? await canonicalFileReadResolver.resolveOriginal(args.fileRecordId)
    : await canonicalDerivativeReadResolver.resolveDerivative(args.fileRecordId, args.variant);

  if (source.status !== "available" || !source.providerConfigId || (!source.objectKey && !("localPathRef" in source && source.localPathRef))) {
    return null;
  }

  const providerConfig = await storageProviderConfigRepository.getById(source.providerConfigId);
  if (!providerConfig) return null;

  const buffer = await storageRegistry.getAdapter(providerConfig.providerType).readObject({
    providerConfig,
    objectKey: source.objectKey,
    localPathRef: "localPathRef" in source ? source.localPathRef : null,
  });

  return {
    buffer,
    mimeType: source.mimeType || fileRecord.mimeType || "application/octet-stream",
    filename: fileRecord.originalFilename || "artwork",
  };
}
