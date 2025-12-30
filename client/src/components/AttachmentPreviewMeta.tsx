import { getPdfPageCount } from "@/lib/attachments";

type AttachmentLike = {
  mimeType?: string | null;
  pageCount?: number | null;
};

/**
 * Renders the "Pages: N" metadata line for PDF attachments in preview modals
 * Only renders when attachment is a PDF with pageCount > 1
 * Multi-page PDFs are flagged with bold red text as a production risk indicator
 */
export function AttachmentPreviewMeta({ attachment }: { attachment: AttachmentLike | null | undefined }) {
  if (!attachment) return null;

  const pageCount = getPdfPageCount(attachment);
  if (pageCount === null || pageCount <= 1) return null;

  // Multi-page PDFs are a production risk - flag them visually
  const isMultiPage = pageCount > 1;

  return (
    <div className={isMultiPage ? "font-bold text-red-600 dark:text-red-500" : ""}>
      <span>Pages: </span>
      <span>{pageCount}</span>
    </div>
  );
}

