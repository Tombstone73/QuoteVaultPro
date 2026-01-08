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
  /** Hide bottom thumbnail filmstrip (default: true for list modal integration) */
  hideFilmstrip?: boolean;
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
  onDownload,
  hideFilmstrip = true
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
  
  // Keyboard navigation (unconditional hook, guard inside effect)
  useEffect(() => {
    if (!open || !isGalleryMode) return;
    
    const canGoPrev = isGalleryMode && selectedIndex > 0;
    const canGoNext = isGalleryMode && selectedIndex < (attachments?.length || 0) - 1;
    
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
  }, [open, isGalleryMode, attachments, selectedIndex]);

  // PDF warning effect (unconditional, with guard inside)
  useEffect(() => {
    if (import.meta.env.DEV) {
      const att = isGalleryMode ? attachments?.[selectedIndex] : singleAttachment;
      if (!att) return;
      const displayName = getAttachmentDisplayName(att);
      const isPdf = isPdfFile(att.mimeType, displayName);
      const objPath = att.objectPath as string | null | undefined;
      if (open && isPdf && !objPath) {
        console.warn('[AttachmentViewerDialog] PDF attachment missing objectPath:', att);
      }
    }
  }, [open, isGalleryMode, selectedIndex, singleAttachment, attachments]);

  // Reachability check effect (unconditional, with guard inside)
  useEffect(() => {
    if (!open) {
      setUrlReachable(null);
      return;
    }
    
    const att = isGalleryMode ? attachments?.[selectedIndex] : singleAttachment;
    if (!att) return;
    
    const displayName = getAttachmentDisplayName(att);
    const objPath = att.objectPath as string | null | undefined;
    const isPdf = isPdfFile(att.mimeType, displayName);
    if (!isPdf || !objPath) {
      setUrlReachable(null);
      return;
    }
    
    const pdfUrl = buildPdfViewUrl(objPath);
    if (!pdfUrl) {
      setUrlReachable(null);
      return;
    }
    
    let cancelled = false;
    
    checkPdfUrlReachable(pdfUrl).then((reachable) => {
      if (!cancelled) {
        setUrlReachable(reachable);
        if (!reachable) {
          setShowFallback(true);
        }
      }
    });
    
    return () => { cancelled = true; };
  }, [open, isGalleryMode, selectedIndex, singleAttachment, attachments]);

  // Reset state when switching attachments (unconditional, with guard inside)
  useEffect(() => {
    setShowFallback(false);
    setUrlReachable(null);
  }, [isGalleryMode ? attachments?.[selectedIndex]?.id : singleAttachment?.id, open]);
  
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

  const fileName = getAttachmentDisplayName(attachment);
  const objectPath = attachment.objectPath as string | null | undefined;
  
  // PACK P2: Use URL builder helpers
  const isPdf = isPdfFile(attachment.mimeType, fileName);
  const pdfViewUrl = isPdf ? buildPdfViewUrl(objectPath) : null;
  const pdfDownloadUrl = isPdf ? buildPdfDownloadUrl(objectPath, fileName) : null;

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
      <DialogContent className="max-w-[min(1100px,95vw)] max-h-[90vh] flex flex-col overflow-hidden">
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

        <div className="flex-1 overflow-hidden space-y-4">
          {/* Gallery Navigation layout using 3-column grid to avoid padding stealing stage width */}
          {isGalleryMode && (canGoPrev || canGoNext) ? (
            <div className="">
              {/* Images: standard img tag */}
              {imageViewUrl && isImage ? (
                <div className="grid grid-cols-[3.5rem,1fr,3.5rem] items-center">
                  {/* Left arrow column (fixed width) */}
                  <div className="h-full flex items-center justify-center">
                    {canGoPrev && (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={handlePrev}
                        title="Previous attachment (←)"
                        className="w-16 h-16"
                      >
                        <ChevronLeft className="w-8 h-8" />
                      </Button>
                    )}
                  </div>
                  {/* Stage column: min-w-0/min-h-0 prevent overflow; clamp height and hide scrollbars */}
                  <div className="min-w-0 min-h-0">
                    {/** min-w-0/min-h-0 ensure the grid cell can shrink without causing horizontal overflow */}
                    <div className="bg-muted/30 rounded-lg p-2 min-h-0 max-h-[calc(90vh-220px)] overflow-x-hidden overflow-y-hidden">
                      <img
                        src={imageViewUrl}
                        alt={fileName}
                        className="block mx-auto max-h-full max-w-full w-auto h-auto object-contain"
                      />
                    </div>
                  </div>
                  {/* Right arrow column (fixed width) */}
                  <div className="h-full flex items-center justify-center">
                    {canGoNext && (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={handleNext}
                        title="Next attachment (→)"
                        className="w-16 h-16"
                      >
                        <ChevronRight className="w-8 h-8" />
                      </Button>
                    )}
                  </div>
                </div>
              ) : null}
              
              {/* PDFs: Chrome-proof rendering with fallback */}
              {isPdf && pdfViewUrl && !showFallback ? (
                <div className="grid grid-cols-[3.5rem,1fr,3.5rem] items-center">
                  {/* Left arrow column */}
                  <div className="h-full flex items-center justify-center">
                    {canGoPrev && (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={handlePrev}
                        title="Previous attachment (←)"
                        className="w-16 h-16"
                      >
                        <ChevronLeft className="w-8 h-8" />
                      </Button>
                    )}
                  </div>
                  {/* Stage column */}
                  <div className="min-w-0 min-h-0">
                    {/** min-w-0/min-h-0 ensure shrinking without horizontal overflow; clamp height and hide scrollbars */}
                    <div className="bg-muted/30 rounded-lg p-2 space-y-2 min-h-0 max-h-[calc(90vh-220px)] overflow-x-hidden overflow-y-hidden">
                      <iframe
                        title="PDF Preview"
                        src={`${pdfViewUrl}#toolbar=1&navpanes=0`}
                        className="w-full h-full rounded-md border border-border bg-background"
                        allow="fullscreen"
                        onLoad={() => {
                          if (isDev) {
                            console.log('[AttachmentViewerDialog] PDF iframe loaded:', pdfViewUrl);
                          }
                        }}
                      />
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
                  </div>
                  {/* Right arrow column */}
                  <div className="h-full flex items-center justify-center">
                    {canGoNext && (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={handleNext}
                        title="Next attachment (→)"
                        className="w-16 h-16"
                      >
                        <ChevronRight className="w-8 h-8" />
                      </Button>
                    )}
                  </div>
                </div>
              ) : null}
              
              {/* Fallback UI for PDFs when iframe disabled */}
              {isPdf && (showFallback || !pdfViewUrl) ? (
                <div className="grid grid-cols-[3.5rem,1fr,3.5rem] items-center">
                  {/* Left arrow column */}
                  <div className="h-full flex items-center justify-center">
                    {canGoPrev && (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={handlePrev}
                        title="Previous attachment (←)"
                        className="w-16 h-16"
                      >
                        <ChevronLeft className="w-8 h-8" />
                      </Button>
                    )}
                  </div>
                  {/* Stage column */}
                  <div className="min-w-0 min-h-0">
                    {/** min-w-0/min-h-0 ensure shrinking without horizontal overflow; clamp height and hide scrollbars */}
                    <div className="flex flex-col items-center justify-center py-12 text-center space-y-4 bg-muted/30 rounded-lg min-h-0 max-h-[calc(90vh-220px)] overflow-x-hidden overflow-y-hidden">
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
                  </div>
                  {/* Right arrow column */}
                  <div className="h-full flex items-center justify-center">
                    {canGoNext && (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={handleNext}
                        title="Next attachment (→)"
                        className="w-16 h-16"
                      >
                        <ChevronRight className="w-8 h-8" />
                      </Button>
                    )}
                  </div>
                </div>
              ) : null}
              
              {/* Generic fallback for other file types */}
              {!isImage && !isPdf ? (
                <div className="grid grid-cols-[3.5rem,1fr,3.5rem] items-center text-muted-foreground">
                  {/* Left arrow column */}
                  <div className="h-full flex items-center justify-center">
                    {canGoPrev && (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={handlePrev}
                        title="Previous attachment (←)"
                        className="w-16 h-16"
                      >
                        <ChevronLeft className="w-8 h-8" />
                      </Button>
                    )}
                  </div>
                  {/* Stage column */}
                  <div className="min-w-0 min-h-0">
                    {/** min-w-0/min-h-0 ensure shrinking without horizontal overflow */}
                    <div className="flex flex-col items-center justify-center py-12 text-center min-h-0 max-h-[calc(90vh-220px)] overflow-x-hidden overflow-y-hidden">
                      <FileText className="w-16 h-16 mb-4 opacity-50" />
                      <p className="text-sm mb-4">Preview not available</p>
                      {(pdfDownloadUrl || genericDownloadUrl) && (
                        <Button onClick={handleDownloadClick} variant="outline">
                          <Download className="w-4 h-4 mr-2" />
                          Download
                        </Button>
                      )}
                    </div>
                  </div>
                  {/* Right arrow column */}
                  <div className="h-full flex items-center justify-center">
                    {canGoNext && (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={handleNext}
                        title="Next attachment (→)"
                        className="w-16 h-16"
                      >
                        <ChevronRight className="w-8 h-8" />
                      </Button>
                    )}
                  </div>
                </div>
              ) : null}
            </div>
          ) : (
            <>
              {/* Images without gallery mode */}
              {imageViewUrl && isImage ? (
                <div className="flex justify-center items-center bg-muted/30 rounded-lg p-2 min-h-0 max-h-[calc(90vh-220px)] overflow-x-hidden overflow-y-hidden">
                  <img src={imageViewUrl} alt={fileName} className="max-h-full max-w-full w-auto h-auto object-contain" />
                </div>
              ) : null}
              
              {/* PDFs without gallery mode */}
              {isPdf && pdfViewUrl && !showFallback ? (
                <div className="bg-muted/30 rounded-lg p-2 space-y-2 min-h-0 max-h-[calc(90vh-220px)] overflow-x-hidden overflow-y-hidden">
                  <iframe
                    title="PDF Preview"
                    src={`${pdfViewUrl}#toolbar=1&navpanes=0`}
                    className="w-full h-full rounded-md border border-border bg-background"
                    allow="fullscreen"
                    onLoad={() => {
                      if (isDev) {
                        console.log('[AttachmentViewerDialog] PDF iframe loaded:', pdfViewUrl);
                      }
                    }}
                  />
                  
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
              
              {/* Fallback UI for other modes */}
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
              
              {/* Generic fallback for non-image/non-PDF */}
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
            </>
          )}
          
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <div className="space-y-1 min-w-0">
              <div>
                <span className="font-medium">Filename: </span>
                <span className="text-muted-foreground truncate max-w-[60ch]">{fileName}</span>
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
              <div className="flex flex-col items-end gap-1 shrink-0">
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
