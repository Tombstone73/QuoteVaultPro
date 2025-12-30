import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Download, FileText, Loader2 } from "lucide-react";
import { getAttachmentDisplayName, isPdfAttachment } from "@/lib/attachments";
import { AttachmentPreviewMeta } from "@/components/AttachmentPreviewMeta";
import { isValidHttpUrl } from "@/lib/utils";

type AttachmentPage = {
  id: string;
  pageIndex: number;
  thumbStatus?: 'uploaded' | 'thumb_pending' | 'thumb_ready' | 'thumb_failed';
  thumbKey?: string | null;
  previewKey?: string | null;
  thumbError?: string | null;
  thumbUrl?: string | null;
  previewUrl?: string | null;
};

type AttachmentData = {
  id: string;
  fileName: string;
  fileUrl?: string;
  fileSize?: number | null;
  mimeType?: string | null;
  createdAt?: string;
  originalFilename?: string | null;
  thumbStatus?: 'uploaded' | 'thumb_pending' | 'thumb_ready' | 'thumb_failed';
  thumbKey?: string | null;
  previewKey?: string | null;
  thumbError?: string | null;
  originalUrl?: string | null;
  thumbUrl?: string | null;
  previewUrl?: string | null;
  pageCount?: number | null;
  pages?: AttachmentPage[];
};

interface AttachmentViewerDialogProps {
  attachment: AttachmentData | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDownload?: (attachment: AttachmentData) => void;
}

/**
 * Reusable attachment viewer dialog for displaying file previews with download capability
 * Used across quotes list, order details, and other attachment contexts
 */
export function AttachmentViewerDialog({ 
  attachment, 
  open, 
  onOpenChange,
  onDownload 
}: AttachmentViewerDialogProps) {
  if (!attachment) return null;

  const isPdf = isPdfAttachment(attachment);
  const isImage = attachment.mimeType?.startsWith("image/") ?? false;
  const isTiff =
    /image\/tiff/i.test(attachment.mimeType ?? "") ||
    /\.(tif|tiff)$/i.test(attachment.fileName ?? "");
  const isAi =
    /\.(ai)$/i.test(attachment.fileName ?? "") ||
    /(illustrator|postscript)/i.test(attachment.mimeType ?? "");
  const isPsd =
    /\.(psd)$/i.test(attachment.fileName ?? "") ||
    /(photoshop|x-photoshop)/i.test(attachment.mimeType ?? "");

  const isRenderableImageUrl = (url: string | null): url is string => {
    if (typeof url !== "string" || !isValidHttpUrl(url)) return false;
    const urlWithoutQuery = url.split("?")[0]?.split("#")[0] ?? "";
    return /\.(png|jpe?g|webp|gif)$/i.test(urlWithoutQuery);
  };

  const originalUrl =
    attachment.originalUrl ?? (attachment as any).originalURL ?? (attachment as any).url ?? attachment.fileUrl ?? null;
  const previewUrl = attachment.previewUrl ?? null;

  const imagePreviewUrl =
    (typeof previewUrl === "string" && isValidHttpUrl(previewUrl) ? previewUrl : null) ??
    (typeof originalUrl === "string" && isValidHttpUrl(originalUrl) ? originalUrl : null);

  const tiffPreviewUrl =
    (isRenderableImageUrl(previewUrl) ? previewUrl : null) ??
    (isRenderableImageUrl(attachment.thumbUrl ?? null) ? (attachment.thumbUrl as string) : null);

  const aiPsdPreviewUrl =
    (isRenderableImageUrl(previewUrl) ? previewUrl : null) ??
    (isRenderableImageUrl(attachment.thumbUrl ?? null) ? (attachment.thumbUrl as string) : null);

  const modalPreviewUrl = isPdf
    ? null
    : isTiff
    ? tiffPreviewUrl
    : isAi || isPsd
    ? aiPsdPreviewUrl
    : isImage
    ? imagePreviewUrl
    : null;

  const hasValidPreview = typeof modalPreviewUrl === "string" && isValidHttpUrl(modalPreviewUrl);
  const pdfThumbUrl =
    attachment.pages?.[0]?.thumbUrl ??
    attachment.thumbUrl ??
    null;
  const hasPdfThumb = isPdf && typeof pdfThumbUrl === "string" && isValidHttpUrl(pdfThumbUrl);
  const hasValidOriginal = typeof originalUrl === "string" && isValidHttpUrl(originalUrl);
  const fileName = getAttachmentDisplayName(attachment);

  const handleDownloadClick = () => {
    if (onDownload) {
      onDownload(attachment);
      return;
    }

    // Fallback: direct download via anchor
    if (originalUrl) {
      const anchor = document.createElement("a");
      anchor.href = originalUrl;
      anchor.download = fileName;
      anchor.target = "_blank";
      anchor.rel = "noreferrer";
      anchor.style.display = "none";
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{fileName}</DialogTitle>
          <DialogDescription>
            <div className="space-y-1">
              {attachment.mimeType ? (
                <div>
                  <span>File type: </span>
                  <span>{attachment.mimeType}</span>
                </div>
              ) : (
                <div>Preview attachment</div>
              )}
              <AttachmentPreviewMeta attachment={attachment} />
            </div>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {isPdf ? (
            hasPdfThumb ? (
              <div className="flex justify-center bg-muted/30 rounded-lg p-4">
                <img
                  src={pdfThumbUrl!}
                  alt={fileName}
                  className="max-w-full max-h-[60vh] object-contain"
                />
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground">
                <FileText className="w-16 h-16 mb-4 opacity-50" />
                <p className="text-sm mb-4">PDF preview not available</p>
                {hasValidOriginal && (
                  <div className="flex flex-col items-center gap-1">
                    <Button onClick={handleDownloadClick} variant="outline">
                      <Download className="w-4 h-4 mr-2" />
                      Download PDF
                    </Button>
                    <span className="text-xs text-muted-foreground">Downloads original file</span>
                  </div>
                )}
              </div>
            )
          ) : hasValidPreview ? (
            <div className="flex justify-center bg-muted/30 rounded-lg p-4">
              <img 
                src={modalPreviewUrl!} 
                alt={fileName}
                className="max-w-full max-h-[60vh] object-contain"
              />
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground">
              <FileText className="w-16 h-16 mb-4 opacity-50" />
              <p className="text-sm">Preview not available for this file</p>
            </div>
          )}
          
          <div className="flex items-center justify-between text-sm">
            <div className="space-y-1">
              <div>
                <span className="font-medium">Filename: </span>
                <span className="text-muted-foreground">{fileName}</span>
              </div>
              {attachment.mimeType && (
                <div>
                  <span className="font-medium">Type: </span>
                  <span className="text-muted-foreground">{attachment.mimeType}</span>
                </div>
              )}
              {attachment.fileSize && (
                <div>
                  <span className="font-medium">Size: </span>
                  <span className="text-muted-foreground">
                    {(attachment.fileSize / 1024).toFixed(1)} KB
                  </span>
                </div>
              )}
            </div>
            
            {hasValidOriginal && (
              <div className="flex flex-col items-end gap-1">
                <Button onClick={handleDownloadClick} variant="outline">
                  <Download className="w-4 h-4 mr-2" />
                  Download original
                </Button>
                <span className="text-xs text-muted-foreground">Downloads original file</span>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
