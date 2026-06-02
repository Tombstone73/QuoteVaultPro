import {
  buildFileUploadDisplayFilename,
  numericJobNumberFromFull,
  type FileUploadNamingPolicy,
} from "@shared/fileUploadNaming";

export type CanonicalOriginalFileInput = {
  id?: string | null;
  fileRecordId?: string | null;
  checksum?: string | null;
  storageKey?: string | null;
  storagePath?: string | null;
  relativePath?: string | null;
  fileUrl?: string | null;
  fileKey?: string | null;
  objectPath?: string | null;
  originalFilename?: string | null;
  fileName?: string | null;
  mimeType?: string | null;
  sizeBytes?: number | null;
  fileSize?: number | null;
};

function normalizedText(value: unknown): string {
  return String(value ?? "").trim();
}

function normalizedLower(value: unknown): string {
  return normalizedText(value).toLowerCase();
}

function stableStorageValue(file: CanonicalOriginalFileInput): string {
  return (
    normalizedText(file.storageKey) ||
    normalizedText(file.storagePath) ||
    normalizedText(file.relativePath) ||
    normalizedText(file.fileUrl) ||
    normalizedText(file.fileKey) ||
    normalizedText(file.objectPath)
  );
}

export function getCanonicalOriginalFileIdentity(file: CanonicalOriginalFileInput): string | null {
  const fileRecordId = normalizedText(file.fileRecordId);
  if (fileRecordId) return `file-record:${fileRecordId}`;

  const checksum = normalizedLower(file.checksum);
  if (checksum) return `checksum:${checksum}`;

  const storageValue = stableStorageValue(file);
  if (storageValue) return `storage:${storageValue.toLowerCase()}`;

  const filename = normalizedLower(file.originalFilename || file.fileName);
  const size = Number(file.sizeBytes ?? file.fileSize ?? 0);
  const mimeType = normalizedLower(file.mimeType);
  if (filename || size > 0 || mimeType) {
    return `legacy:${filename}:${Number.isFinite(size) ? size : 0}:${mimeType}`;
  }

  return null;
}

export function buildOrderOriginalArtworkDisplayFilename(params: {
  originalFilename?: string | null;
  fileName?: string | null;
  orderNumber?: string | null;
  namingPolicy: FileUploadNamingPolicy;
}): string {
  const originalFilename = normalizedText(params.originalFilename || params.fileName) || "file";
  const fullJobNumber = normalizedText(params.orderNumber);

  return buildFileUploadDisplayFilename({
    originalFilename,
    fullJobNumber,
    numericJobNumber: numericJobNumberFromFull(fullJobNumber),
    fileUploadJobPrefixMode: params.namingPolicy.fileUploadJobPrefixMode,
    prepressLabel: "none",
  });
}

export function withOrderOriginalArtworkDisplayFilename<T extends Record<string, any>>(
  file: T,
  params: {
    orderNumber?: string | null;
    namingPolicy: FileUploadNamingPolicy;
  },
): T & { displayFilename: string; computedDisplayFilename: string } {
  const displayFilename = buildOrderOriginalArtworkDisplayFilename({
    originalFilename: file.originalFilename,
    fileName: file.fileName,
    orderNumber: params.orderNumber,
    namingPolicy: params.namingPolicy,
  });

  return {
    ...file,
    displayFilename,
    computedDisplayFilename: displayFilename,
  };
}

export function dedupeByCanonicalOriginalFileIdentity<T extends CanonicalOriginalFileInput>(
  files: T[],
  options?: {
    seedIdentities?: Iterable<string | null | undefined>;
  },
): T[] {
  const seen = new Set<string>();
  for (const identity of Array.from(options?.seedIdentities ?? [])) {
    if (identity) seen.add(identity);
  }

  const deduped: T[] = [];
  for (const file of files) {
    const identity = getCanonicalOriginalFileIdentity(file);
    if (identity && seen.has(identity)) continue;
    if (identity) seen.add(identity);
    deduped.push(file);
  }

  return deduped;
}
