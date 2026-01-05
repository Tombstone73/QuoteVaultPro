/**
 * Shared utilities for attachment display and detection
 * Single source of truth for filename extraction, PDF detection, and page count handling
 */

import { isValidHttpUrl } from "@/lib/utils";

type AttachmentLike = {
  originalFilename?: string | null;
  fileName?: string;
  filename?: string;
  storagePath?: string | null;
  key?: string | null;
  url?: string | null;
  mimeType?: string | null;
  pageCount?: number | null;
};

type AttachmentPreviewLike = AttachmentLike & {
  previewUrl?: string | null;
  thumbUrl?: string | null;
  originalUrl?: string | null;
  thumbnailUrl?: string | null;
  pages?: Array<{ thumbUrl?: string | null }>;
};

/**
 * Get display name for an attachment with fallback priority:
 * 1) originalFilename
 * 2) fileName
 * 3) filename
 * 4) last segment of storagePath/key/url (split by "/")
 * 5) "Attachment"
 */
export function getAttachmentDisplayName(att: AttachmentLike | null | undefined): string {
  if (!att) return "Attachment";

  // Priority 1: originalFilename
  if (att.originalFilename) return att.originalFilename;

  // Priority 2: fileName
  if (att.fileName) return att.fileName;

  // Priority 3: filename
  if (att.filename) return att.filename;

  // Priority 4: Extract from storage path/key/url
  const pathSource = att.storagePath || att.key || att.url;
  if (pathSource && typeof pathSource === "string") {
    const segments = pathSource.split("/");
    const lastSegment = segments[segments.length - 1];
    if (lastSegment && lastSegment.length > 0) {
      return lastSegment;
    }
  }

  // Priority 5: Fallback
  return "Attachment";
}

/**
 * Check if attachment is a PDF by mimeType or filename extension
 */
export function isPdfAttachment(att: AttachmentLike | null | undefined): boolean {
  if (!att) return false;

  // Check mimeType
  if (att.mimeType) {
    const mimeLower = att.mimeType.toLowerCase();
    if (mimeLower.includes("pdf")) return true;
  }

  // Check filename extension
  const displayName = getAttachmentDisplayName(att);
  const nameLower = displayName.toLowerCase();
  return nameLower.endsWith(".pdf");
}

/**
 * Get PDF page count if available and valid
 * Returns null if not a PDF, pageCount is missing, or invalid
 */
export function getPdfPageCount(att: AttachmentLike | null | undefined): number | null {
  if (!att || !isPdfAttachment(att)) return null;

  const pageCount = att.pageCount;
  if (typeof pageCount === "number" && Number.isFinite(pageCount) && pageCount > 0) {
    return pageCount;
  }

  return null;
}

/**
 * Resolve a thumbnail/preview URL for rendering, using the same priority order
 * as Quotes line item attachments.
 *
 * - PDFs: pages[0].thumbUrl -> thumbUrl -> thumbnailUrl
 * - Non-PDF: previewUrl -> thumbUrl -> originalUrl
 *
 * Returns null if no usable signed URL is available.
 */
export function getAttachmentThumbnailUrl(att: AttachmentPreviewLike | null | undefined): string | null {
  if (!att) return null;

  const isPdf = isPdfAttachment(att);
  if (isPdf) {
    const pdfUrl = att.pages?.[0]?.thumbUrl ?? att.thumbUrl ?? att.thumbnailUrl ?? null;
    return isValidHttpUrl(pdfUrl) ? pdfUrl : null;
  }

  if (isValidHttpUrl(att.previewUrl)) return att.previewUrl;
  if (isValidHttpUrl(att.thumbUrl)) return att.thumbUrl;
  if (isValidHttpUrl(att.originalUrl)) return att.originalUrl;
  return null;
}

