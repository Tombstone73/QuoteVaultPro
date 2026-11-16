import { canonicalDerivativeReadResolver } from "../storage/CanonicalDerivativeReadResolver";
import { canonicalFileReadResolver } from "../storage/CanonicalFileReadResolver";
import { fileRecordRepository } from "../../storage/fileRecord.repo";
import { storageProviderConfigRepository } from "../../storage/storageProviderConfig.repo";
import { storageRegistry } from "../storage/StorageRegistry";

export type ArtworkAccessVariant = "original" | "preview" | "thumbnail";

export class ArtworkOriginalAccessError extends Error {
  constructor(public readonly code: "ARTWORK_ORIGINAL_MISSING" | "ARTWORK_ORIGINAL_RESTORING" | "ARTWORK_STORAGE_UNAVAILABLE", public readonly statusCode: 404 | 409 | 503) {
    super(code);
  }
}

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

  if (args.variant === "original" && (source.status === "archived" || source.status === "restoring")) {
    throw new ArtworkOriginalAccessError("ARTWORK_ORIGINAL_RESTORING", 409);
  }

  if (source.status !== "available" || !source.providerConfigId || (!source.objectKey && !("localPathRef" in source && source.localPathRef))) {
    if (args.variant === "original") throw new ArtworkOriginalAccessError("ARTWORK_ORIGINAL_MISSING", 404);
    return null;
  }

  const providerConfig = await storageProviderConfigRepository.getByIdForOrganization(args.organizationId, source.providerConfigId);
  if (!providerConfig) {
    if (args.variant === "original") throw new ArtworkOriginalAccessError("ARTWORK_STORAGE_UNAVAILABLE", 503);
    return null;
  }

  const adapter = storageRegistry.getAdapter(providerConfig.providerType);
  const object = { providerConfig, objectKey: source.objectKey, localPathRef: "localPathRef" in source ? source.localPathRef : null };
  let buffer: Buffer;
  try {
    buffer = await adapter.readObject(object);
  } catch (error) {
    if (args.variant !== "original") throw error;
    try {
      if (!await adapter.objectExists(object)) throw new ArtworkOriginalAccessError("ARTWORK_ORIGINAL_MISSING", 404);
    } catch (verificationError) {
      if (verificationError instanceof ArtworkOriginalAccessError) throw verificationError;
      throw new ArtworkOriginalAccessError("ARTWORK_STORAGE_UNAVAILABLE", 503);
    }
    throw new ArtworkOriginalAccessError("ARTWORK_STORAGE_UNAVAILABLE", 503);
  }

  return {
    buffer,
    mimeType: source.mimeType || fileRecord.mimeType || "application/octet-stream",
    filename: fileRecord.originalFilename || "artwork",
  };
}
