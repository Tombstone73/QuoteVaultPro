import { buildArtworkAccessUrl } from "@/lib/artworkAccess";
import { getThumbSrc } from "@/lib/getThumbSrc";

type CanonicalAttachmentThumbnail = {
  fileRecordId?: string | null;
  [key: string]: unknown;
};

/** Resolves the canonical derivative before compatibility thumbnail fields. */
export function getLineItemThumbnailUrl(attachment: CanonicalAttachmentThumbnail): string | null {
  return buildArtworkAccessUrl(attachment.fileRecordId, "thumbnail") ?? getThumbSrc(attachment);
}
