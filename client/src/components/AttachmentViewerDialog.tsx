import { useEffect, useMemo, useState } from "react";

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Download, FileText, ExternalLink, ChevronLeft, ChevronRight } from "lucide-react";
import { getAttachmentDisplayName, isPdfAttachment } from "@/lib/attachments";
import { AttachmentPreviewMeta } from "@/components/AttachmentPreviewMeta";
import { downloadFileFromUrl } from "@/lib/downloadFile";
import { buildPdfViewUrl, buildPdfDownloadUrl, isPdfFile, checkPdfUrlReachable } from "@/lib/pdfUrls";
import { getThumbSrc } from "@/lib/getThumbSrc";
import { cn } from "@/lib/utils";

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
  objectPath?: string | null;
  pageCount?: number | null;
  pages?: AttachmentPage[];
};

interface AttachmentViewerDialogProps {
  /** Single attachment (legacy mode) - if provided without attachments array, shows single item */
  attachment?: AttachmentData | null;
  /** Gallery mode: array of attachments to browse */
  attachments?: AttachmentData[];
  /** Gallery mode: initial index to select (default: 0) */
  initialIndex?: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDownload?: (attachment: AttachmentData) => void;
}

/**
 * Reusable attachment viewer dialog for displaying file previews with download capability
 * Used across quotes list, order details, and other attachment contexts
 * 
 * Supports two modes:
 * 1. Single mode: Pass `attachment` prop for single attachment viewing
 * 2. Gallery mode: Pass `attachments` array for browsing with left/right arrows
 */
export function AttachmentViewerDialog({ 
  attachment: singleAttachment,
  attachments,
  initialIndex = 0,
  open, 
  onOpenChange,
  onDownload 
}: AttachmentViewerDialogProps) {
  const isDev = import.meta.env.DEV;
  const [showFallback, setShowFallback] = useState(false);
  const [urlReachable, setUrlReachable] = useState<boolean | null>(null);
  
  // Gallery mode state
  const isGalleryMode = !!attachments && attachments.length > 0;
  const [selectedIndex, setSelectedIndex] = useState(initialIndex);
  
  // Reset selected index when dialog opens or initialIndex changes
  useEffect(() => {
    if (open) {
      setSelectedIndex(initialIndex);
    }
  }, [open, initialIndex]);
  
  // Derive current attachment from gallery or single mode
  const attachment = isGalleryMode 
    ? attachments[selectedIndex] ?? null
    : singleAttachment ?? null;
  
  if (!attachment) return null;
  
  // Navigation handlers
  const canGoPrev = isGalleryMode && selectedIndex > 0;
  const canGoNext = isGalleryMode && selectedIndex < attachments.length - 1;
  
  const handlePrev = () => {
    if (canGoPrev) {
      setSelectedIndex(i => Math.max(0, i - 1));
    }
  };
  
  const handleNext = () => {
    if (canGoNext && attachments) {
      setSelectedIndex(i => Math.min(attachments.length - 1, i + 1));
    }
  };
  
  // Keyboard navigation
  useEffect(() => {
    if (!open || !isGalleryMode) return;
    
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft' && canGoPrev) {
        e.preventDefault();
        handlePrev();
      } else if (e.key === 'ArrowRight' && canGoNext) {
        e.preventDefault();
        handleNext();
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, isGalleryMode, canGoPrev, canGoNext, selectedIndex]);

  const fileName = getAttachmentDisplayName(attachment);
  const objectPath = attachment.objectPath as string | null | undefined;
  
  // PACK P2: Use URL builder helpers
  const isPdf = isPdfFile(attachment.mimeType, fileName);
  const pdfViewUrl = isPdf ? buildPdfViewUrl(objectPath) : null;
  const pdfDownloadUrl = isPdf ? buildPdfDownloadUrl(objectPath, fileName) : null;
  
  // PACK P6: Warn if PDF is missing objectPath
  useEffect(() => {
    if (open && isPdf && !objectPath && isDev) {
      console.warn('[AttachmentViewerDialog] PDF attachment missing objectPath:', attachment);
    }
  }, [open, isPdf, objectPath, attachment, isDev]);

  // PACK P4: Lightweight reachability check on mount
  useEffect(() => {
    if (!open || !isPdf || !pdfViewUrl) {
      setUrlReachable(null);
      return;
    }
    
    // Check if URL is reachable
    let cancelled = false;
    
    checkPdfUrlReachable(pdfViewUrl).then((reachable) => {
      if (!cancelled) {
        setUrlReachable(reachable);
        if (!reachable) {
          setShowFallback(true);
        }
      }
    });
    
    return () => { cancelled = true; };
  }, [open, isPdf, pdfViewUrl]);

  // Reset state when switching attachments
  useEffect(() => {
    setShowFallback(false);
    setUrlReachable(null);
  }, [attachment?.id, open]);

  // For non-PDFs: derive preview URL from originalUrl/previewUrl
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
  const isImage = typeof effectiveMimeType === "string" && effectiveMimeType.startsWith("image/");
  
  const imageViewUrl = isImage ? (attachment.previewUrl ?? attachment.originalUrl ?? null) : null;
  
  // Fallback download URL for non-PDFs
  const genericDownloadUrl = !isPdf ? (attachment.originalUrl ?? null) : null;

  const handleDownloadClick = () => {
    if (onDownload) {
      onDownload(attachment);
      return;
    }

    const downloadUrl = isPdf ? pdfDownloadUrl : genericDownloadUrl;
    if (!downloadUrl) return;
    void downloadFileFromUrl(downloadUrl, fileName);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {fileName}
            {isGalleryMode && (
              <span className="text-sm font-normal text-muted-foreground ml-2">
                ({selectedIndex + 1} of {attachments.length})
              </span>
            )}
          </DialogTitle>
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
          {/* Gallery Navigation Arrows */}
          {isGalleryMode && (canGoPrev || canGoNext) && (
            <div className="relative">
              {canGoPrev && (
                <Button
                  variant="outline"
                  size="icon"
                  className="absolute left-2 top-1/2 -translate-y-1/2 z-10 bg-background/80 backdrop-blur-sm hover:bg-background/95"
                  onClick={handlePrev}
                  title="Previous attachment (←)"
                >
                  <ChevronLeft className="w-5 h-5" />
                </Button>
              )}
              {canGoNext && (
                <Button
                  variant="outline"
                  size="icon"
                  className="absolute right-2 top-1/2 -translate-y-1/2 z-10 bg-background/80 backdrop-blur-sm hover:bg-background/95"
                  onClick={handleNext}
                  title="Next attachment (→)"
                >
                  <ChevronRight className="w-5 h-5" />
                </Button>
              )}
            </div>
          )}
          {/* Images: standard img tag */}
          {imageViewUrl && isImage ? (
            <div className="flex justify-center bg-muted/30 rounded-lg p-4">
              <img src={imageViewUrl} alt={fileName} className="max-w-full max-h-[60vh] object-contain" />
            </div>
          ) : null}
          
          {/* PDFs: Chrome-proof rendering with fallback */}
          {isPdf && pdfViewUrl && !showFallback ? (
            <div className="bg-muted/30 rounded-lg p-2 space-y-2">
              {/* PACK P1-P2: NO SANDBOX, same-origin /objects URL only */}
              <iframe
                title="PDF Preview"
                src={`${pdfViewUrl}#toolbar=1&navpanes=0`}
                className="w-full h-[60vh] rounded-md border border-border bg-background"
                style={{ minHeight: '60vh' }}
                allow="fullscreen"
                onLoad={() => {
                  if (isDev) {
                    console.log('[AttachmentViewerDialog] PDF iframe loaded:', pdfViewUrl);
                  }
                }}
              />
              
              {/* PACK P3: Chrome-proof helper message (always visible) */}
              <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground px-2 py-1 bg-muted/50 rounded">
                <span>
                  {urlReachable === false 
                    ? "⚠️ Preview unavailable. Download to view." 
                    : "Preview may not display in some browsers. Use Download or Open in new tab."}
                </span>
                <button
                  onClick={() => setShowFallback(true)}
                  className="underline hover:text-foreground"
                  type="button"
                >
                  Show options
                </button>
              </div>
            </div>
          ) : null}
          
          {/* PACK P3: Fallback UI (no iframe, just actions) */}
          {isPdf && (showFallback || !pdfViewUrl) ? (
            <div className="flex flex-col items-center justify-center py-12 text-center space-y-4 bg-muted/30 rounded-lg">
              <FileText className="w-16 h-16 opacity-50 text-muted-foreground" />
              <div className="space-y-2">
                <p className="text-sm font-medium">
                  {!pdfViewUrl ? "PDF preview unavailable" : "Preview may be disabled by your browser"}
                </p>
                <p className="text-xs text-muted-foreground max-w-md">
                  {!pdfViewUrl 
                    ? "Missing file reference. Contact support if this persists."
                    : "Some browsers (like Chrome with 'Download PDFs' enabled) block embedded PDFs. Download the file to view it."}
                </p>
              </div>
              
              {/* PACK P1: NO "Open" button - just Download + optional new-tab link */}
              <div className="flex flex-col gap-2">
                {pdfDownloadUrl && (
                  <Button onClick={handleDownloadClick} variant="default" size="lg">
                    <Download className="w-4 h-4 mr-2" />
                    Download PDF
                  </Button>
                )}
                
                {pdfViewUrl && (
                  <a
                    href={pdfViewUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center justify-center gap-2 text-sm text-muted-foreground hover:text-foreground underline"
                  >
                    <ExternalLink className="w-3 h-3" />
                    Open in new tab
                  </a>
                )}
              </div>
              
              {!showFallback && pdfViewUrl && (
                <button
                  onClick={() => setShowFallback(false)}
                  className="text-xs text-muted-foreground underline hover:text-foreground"
                  type="button"
                >
                  Try preview again
                </button>
              )}
            </div>
          ) : null}
          
          {/* Generic fallback for other file types */}
          {!isImage && !isPdf ? (
            <div className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground">
              <FileText className="w-16 h-16 mb-4 opacity-50" />
              <p className="text-sm mb-4">Preview not available</p>
              {(pdfDownloadUrl || genericDownloadUrl) && (
                <Button onClick={handleDownloadClick} variant="outline">
                  <Download className="w-4 h-4 mr-2" />
                  Download
                </Button>
              )}
            </div>
          ) : null}
          
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
            
            {(pdfDownloadUrl || genericDownloadUrl) && (
              <div className="flex flex-col items-end gap-1">
                <Button onClick={handleDownloadClick} variant="outline">
                  <Download className="w-4 h-4 mr-2" />
                  Download original
                </Button>
                <span className="text-xs text-muted-foreground">Downloads original file</span>
              </div>
            )}
          </div>
          
          {/* Thumbnail Strip for Gallery Mode */}
          {isGalleryMode && attachments.length > 1 && (
            <div className="border-t border-border pt-4">
              <div className="flex gap-2 overflow-x-auto pb-2">
                {attachments.map((att, idx) => {
                  const thumbSrc = getThumbSrc(att as any);
                  const displayName = getAttachmentDisplayName(att);
                  const isSelected = idx === selectedIndex;
                  const isPdf = isPdfFile(att.mimeType, displayName);
                  
                  return (
                    <button
                      key={att.id}
                      type="button"
                      onClick={() => setSelectedIndex(idx)}
                      className={cn(
                        "flex-shrink-0 w-16 h-16 rounded border-2 overflow-hidden transition-all",
                        isSelected 
                          ? "border-primary ring-2 ring-primary ring-offset-2" 
                          : "border-border hover:border-primary/50"
                      )}
                      title={displayName}
                    >
                      {thumbSrc ? (
                        <img
                          src={thumbSrc}
                          alt={displayName}
                          className="w-full h-full object-cover"
                          loading="lazy"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center bg-muted">
                          <FileText className="w-6 h-6 text-muted-foreground" />
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
