import { and, eq, lte, or } from "drizzle-orm";
import { isEpsArtwork, isVectorArtwork } from "@shared/artworkPreview";
import { orderAttachments, orders, quoteAttachments } from "@shared/schema";
import { db } from "../../db";
import { fileRecordRepository } from "../../storage/fileRecord.repo";
import { isSupportedImageType, isThumbnailGenerationEnabled } from "../thumbnailGenerator";
import { canonicalDerivativeReadResolver } from "../storage/CanonicalDerivativeReadResolver";
import { canonicalFileReadResolver } from "../storage/CanonicalFileReadResolver";
import {
  THUMBNAIL_PENDING_RETRY_MS,
  triggerThumbnailGenerationForAuthorizedRead,
} from "../../workers/thumbnailWorker";

// New uploads already trigger rendering. Give that path time to complete
// before a missing read requests recovery for the same attachment.
export const THUMBNAIL_UPLOADED_RECOVERY_AGE_MS = 5 * 60 * 1000;

/** Queue only the requested, tenant-owned image after a missing derivative read. */
export async function requestArtworkDerivativeRecovery(args: {
  organizationId: string;
  fileRecordId: string;
  variant: "thumbnail" | "preview";
}): Promise<void> {
  if (!isThumbnailGenerationEnabled()) {
    console.info("[ArtworkRecovery] Thumbnail generation disabled", { fileRecordId: args.fileRecordId });
    return;
  }

  const record = await fileRecordRepository.getByIdForOrganization(args.organizationId, args.fileRecordId);
  if (!record) return;
  const fileName = record.originalFilename;
  if (isEpsArtwork(fileName, record.mimeType) ||
      (!isSupportedImageType(record.mimeType, fileName) && !isVectorArtwork(fileName, record.mimeType))) return;

  const [derivative, original] = await Promise.all([
    canonicalDerivativeReadResolver.resolveDerivative(args.fileRecordId, args.variant),
    canonicalFileReadResolver.resolveOriginal(args.fileRecordId),
  ]);
  // A failed derivative needs the explicit repair workflow; a missing original
  // cannot be repaired by requeueing a thumbnail request.
  if ((derivative.status !== "missing" && derivative.status !== "pending") ||
      original.status !== "available") return;

  const staleBefore = new Date(Date.now() - THUMBNAIL_PENDING_RETRY_MS);
  const uploadedBefore = new Date(Date.now() - THUMBNAIL_UPLOADED_RECOVERY_AGE_MS);
  const recoverable = (table: typeof quoteAttachments | typeof orderAttachments) => or(
    and(eq(table.thumbStatus, "uploaded"), lte(table.updatedAt, uploadedBefore)),
    and(eq(table.thumbStatus, "thumb_pending"), lte(table.updatedAt, staleBefore)),
  );
  const [quote] = await db.select({ id: quoteAttachments.id })
    .from(quoteAttachments)
    .where(and(
      eq(quoteAttachments.organizationId, args.organizationId),
      eq(quoteAttachments.fileRecordId, args.fileRecordId),
      recoverable(quoteAttachments),
    )).limit(1);
  if (quote) {
    triggerThumbnailGenerationForAuthorizedRead({ attachmentType: "quote", attachmentId: quote.id });
    return;
  }

  const [order] = await db.select({ id: orderAttachments.id })
    .from(orderAttachments)
    .innerJoin(orders, eq(orders.id, orderAttachments.orderId))
    .where(and(
      eq(orders.organizationId, args.organizationId),
      eq(orderAttachments.fileRecordId, args.fileRecordId),
      recoverable(orderAttachments),
    )).limit(1);
  if (order) {
    triggerThumbnailGenerationForAuthorizedRead({ attachmentType: "order", attachmentId: order.id });
  } else {
    console.info("[ArtworkRecovery] No eligible attachment for authorized derivative read", {
      fileRecordId: args.fileRecordId,
      variant: args.variant,
    });
  }
}
