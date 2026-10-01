import { and, desc, eq, inArray } from "drizzle-orm";
import { fileDerivatives, fileRecords, type FileDerivative } from "@shared/schema";
import { db } from "../../db";
import type { ResolvedLineItemArtwork } from "./LineItemArtworkReadResolver";

export type FulfillmentArtworkProjection = {
  id: string;
  relationshipId: string;
  fileRecordId: string;
  fileName: string;
  mimeType: string | null;
  sizeBytes: number | null;
  side: ResolvedLineItemArtwork["side"];
  role: ResolvedLineItemArtwork["role"];
  source: "canonical";
  fileUrl: string;
  originalUrl: string;
  downloadUrl: string;
  previewUrl: string;
  thumbUrl: string;
  thumbnailUrl: string;
  thumbKey: null;
  previewKey: null;
  objectPath: null;
  previewStatus: "ready" | "pending" | "failed" | null;
  previewError: string | null;
  thumbnailStatus: "ready" | "pending" | "failed" | null;
};

type DerivativeMetadata = Pick<FileDerivative, "fileRecordId" | "derivativeType" | "state" | "objectKey" | "errorText">;

/** Caller supplies tenant-authorized canonical resolver results, in their existing order. */
export async function buildFulfillmentArtworkProjection(
  organizationId: string,
  artwork: ResolvedLineItemArtwork[],
  executor: any = db,
): Promise<FulfillmentArtworkProjection[]> {
  if (!artwork.length) return [];

  const fileRecordIds = Array.from(new Set(artwork.map((item) => item.fileRecordId)));
  const derivatives: DerivativeMetadata[] = await executor
    .select({
      fileRecordId: fileDerivatives.fileRecordId,
      derivativeType: fileDerivatives.derivativeType,
      state: fileDerivatives.state,
      objectKey: fileDerivatives.objectKey,
      errorText: fileDerivatives.errorText,
    })
    .from(fileDerivatives)
    .innerJoin(fileRecords, and(eq(fileRecords.id, fileDerivatives.fileRecordId), eq(fileRecords.organizationId, organizationId)))
    .where(and(inArray(fileDerivatives.fileRecordId, fileRecordIds), inArray(fileDerivatives.derivativeType, ["preview", "thumbnail"])))
    .orderBy(desc(fileDerivatives.updatedAt), desc(fileDerivatives.createdAt));

  const preferred = new Map<string, Partial<Record<"preview" | "thumbnail", DerivativeMetadata>>>();
  // Match getPreferredByFileRecordIdAndType: ready with an object key, pending, failed.
  const rank = (row: DerivativeMetadata) => row.state === "ready" && !!row.objectKey
    ? 0 : row.state === "pending" ? 1 : row.state === "failed" ? 2 : 3;
  for (const row of derivatives) {
    if (row.derivativeType !== "preview" && row.derivativeType !== "thumbnail") continue;
    if (rank(row) === 3) continue;
    const byType = preferred.get(row.fileRecordId) ?? {};
    const existing = byType[row.derivativeType];
    if (!existing || rank(row) < rank(existing)) byType[row.derivativeType] = row;
    preferred.set(row.fileRecordId, byType);
  }

  return artwork.map((item) => {
    const byType = preferred.get(item.fileRecordId);
    const previewStatus = byType?.preview?.state as FulfillmentArtworkProjection["previewStatus"] | undefined;
    const thumbnailStatus = byType?.thumbnail?.state as FulfillmentArtworkProjection["thumbnailStatus"] | undefined;
    const errorText = byType?.preview?.errorText;
    const originalUrl = `/api/artwork/file-records/${encodeURIComponent(item.fileRecordId)}/content`;
    return {
      id: item.relationshipId,
      relationshipId: item.relationshipId,
      fileRecordId: item.fileRecordId,
      fileName: item.file.originalFilename ?? item.relationshipId,
      mimeType: item.file.mimeType,
      sizeBytes: item.file.sizeBytes,
      side: item.side,
      role: item.role,
      source: "canonical",
      fileUrl: originalUrl,
      originalUrl,
      downloadUrl: `${originalUrl}?download=1`,
      previewUrl: `${originalUrl}?variant=preview`,
      thumbUrl: `${originalUrl}?variant=thumbnail`,
      thumbnailUrl: `${originalUrl}?variant=thumbnail`,
      thumbKey: null,
      previewKey: null,
      objectPath: null,
      previewStatus: previewStatus ?? null,
      previewError: previewStatus === "failed"
        ? (errorText && errorText.trim() === errorText && /^preview_[a-z_]{1,64}$/.test(errorText) ? errorText : "preview_generation_failed")
        : null,
      thumbnailStatus: thumbnailStatus ?? null,
    };
  });
}
