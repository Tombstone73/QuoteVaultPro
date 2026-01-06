import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Download, FileText, Loader2 } from "lucide-react";
import { getAttachmentDisplayName, isPdfAttachment } from "@/lib/attachments";
import { AttachmentPreviewMeta } from "@/components/AttachmentPreviewMeta";
import { downloadFileFromUrl } from "@/lib/downloadFile";

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
  downloadUrl?: string | null;
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

  const fileName = getAttachmentDisplayName(attachment);
  const originalUrl =
    attachment.originalUrl ?? (attachment as any).originalURL ?? (attachment as any).url ?? null;

  const rawDownloadUrl = (attachment.downloadUrl ?? null) as string | null;

  const isRenderableUrl = (value: unknown): value is string => {
    if (typeof value !== "string" || !value.length) return false;
    if (value.startsWith("http://") || value.startsWith("https://")) return true;
    // Same-origin proxies (local object storage, etc.)
    if (value.startsWith("/")) return true;
    return false;
  };

  const previewUrl = isRenderableUrl(originalUrl) ? originalUrl : null;
  const downloadHref = isRenderableUrl(rawDownloadUrl)
    ? rawDownloadUrl
    : (previewUrl && previewUrl.startsWith("/objects/")
        ? `/api/objects/download?key=${encodeURIComponent(previewUrl.slice("/objects/".length))}&filename=${encodeURIComponent(fileName)}`
        : previewUrl);

  const inferMimeType = (name: string): string | null => {
    const n = (name || "").toLowerCase();
    if (n.endsWith(".pdf")) return "application/pdf";
    if (n.endsWith(".png")) return "image/png";
    if (n.endsWith(".jpg") || n.endsWith(".jpeg")) return "image/jpeg";
    if (n.endsWith(".webp")) return "image/webp";
    if (n.endsWith(".gif")) return "image/gif";
    if (n.endsWith(".svg")) return "image/svg+xml";
    return null;
  };

  const effectiveMimeType = attachment.mimeType ?? inferMimeType(fileName);
  const isPdf = effectiveMimeType === "application/pdf" || isPdfAttachment(attachment);
  const isImage = typeof effectiveMimeType === "string" && effectiveMimeType.startsWith("image/");

  const handleDownloadClick = () => {
    if (onDownload) {
      onDownload(attachment);
      return;
    }

    if (!downloadHref) return;
    void downloadFileFromUrl(downloadHref, fileName);
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
          {previewUrl && isImage ? (
            <div className="flex justify-center bg-muted/30 rounded-lg p-4">
              <img src={previewUrl} alt={fileName} className="max-w-full max-h-[60vh] object-contain" />
            </div>
          ) : previewUrl && isPdf ? (
            <div className="bg-muted/30 rounded-lg p-2 space-y-2">
              <iframe title={fileName} src={previewUrl} className="w-full h-[70vh] rounded" />
              <div className="text-xs text-muted-foreground">
                If the PDF does not render,{' '}
                <a
                  href={previewUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="underline underline-offset-2"
                >
                  open it in a new tab
                </a>
                .
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground">
              <FileText className="w-16 h-16 mb-4 opacity-50" />
              <p className="text-sm mb-4">Preview not available</p>
              {downloadHref && (
                <div className="flex flex-col items-center gap-1">
                  <Button onClick={handleDownloadClick} variant="outline">
                    <Download className="w-4 h-4 mr-2" />
                    Download
                  </Button>
                  <span className="text-xs text-muted-foreground">Downloads original file</span>
                </div>
              )}
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
            
            {downloadHref && (
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
