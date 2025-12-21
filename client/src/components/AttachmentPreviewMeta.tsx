import { getPdfPageCount } from "@/lib/attachments";

type AttachmentLike = {
  mimeType?: string | null;
  pageCount?: number | null;
};

/**
 * Renders the "Pages: N" metadata line for PDF attachments in preview modals
 * Only renders when attachment is a PDF with pageCount > 1
 */
export function AttachmentPreviewMeta({ attachment }: { attachment: AttachmentLike | null | undefined }) {
  if (!attachment) return null;

  const pageCount = getPdfPageCount(attachment);
  if (pageCount === null || pageCount <= 1) return null;

  return (
    <div>
      <span>Pages: </span>
      <span>{pageCount}</span>
    </div>
  );
}

