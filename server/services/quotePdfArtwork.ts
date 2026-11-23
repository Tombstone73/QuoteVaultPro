import { and, asc, eq } from "drizzle-orm";
import { fileRecords, quoteAttachments, quoteLineItems } from "@shared/schema";
import { db } from "../db";
import { readPdfArtworkThumbnail, withArtworkReadTimeout } from "./invoicePdfArtwork";

/** Called with a tenant-authorized saved Quote. Only customer-visible artwork
 * attached to that exact line can appear in the customer document. */
export async function getQuotePdfArtworkThumbnails(
  organizationId: string, quoteId: string,
): Promise<ReadonlyMap<string, string>> {
  const thumbnails = new Map<string, string>();
  try {
    const attachments = await withArtworkReadTimeout(db.selectDistinctOn([quoteAttachments.quoteLineItemId], {
      lineId: quoteLineItems.id, fileId: fileRecords.id,
    }).from(quoteAttachments)
      .innerJoin(quoteLineItems, and(eq(quoteLineItems.id, quoteAttachments.quoteLineItemId), eq(quoteLineItems.quoteId, quoteId)))
      .innerJoin(fileRecords, and(eq(fileRecords.id, quoteAttachments.fileRecordId), eq(fileRecords.organizationId, organizationId)))
      .where(and(
        eq(quoteAttachments.organizationId, organizationId),
        eq(quoteAttachments.quoteId, quoteId),
        eq(quoteAttachments.customerVisible, true),
        eq(quoteAttachments.productionRole, "artwork"),
        eq(quoteAttachments.thumbStatus, "thumb_ready"),
      )).orderBy(asc(quoteAttachments.quoteLineItemId), asc(quoteAttachments.createdAt), asc(quoteAttachments.id)), quoteId);
    await Promise.all(attachments.map(async ({ lineId, fileId }) => {
      try {
        const thumbnail = await readPdfArtworkThumbnail(organizationId, fileId);
        if (thumbnail) thumbnails.set(lineId, thumbnail);
      } catch (error) {
        console.warn("[QuotePdfArtwork] Thumbnail unavailable", { quoteId, lineId, error });
      }
    }));
  } catch (error) {
    console.warn("[QuotePdfArtwork] Artwork lookup unavailable", { quoteId, error });
  }
  return thumbnails;
}
