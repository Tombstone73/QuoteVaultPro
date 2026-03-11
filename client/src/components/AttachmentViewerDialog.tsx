import { useEffect, useRef, useState } from "react";

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Download, FileText, ExternalLink, ChevronLeft, ChevronRight, ZoomIn, ZoomOut, X } from "lucide-react";
import { getAttachmentDisplayName, isPdfAttachment } from "@/lib/attachments";
import { AttachmentPreviewMeta } from "@/components/AttachmentPreviewMeta";
import { downloadFileFromUrl } from "@/lib/downloadFile";
import { buildPdfViewUrl, buildPdfDownloadUrl, isPdfFile, checkPdfUrlReachable } from "@/lib/pdfUrls";
import { apiFetchBlob } from "@/lib/queryClient";
import { cn } from "@/lib/utils";

export type AttachmentPage = {
  id: string;
  pageIndex: number;
  thumbStatus?: 'uploaded' | 'thumb_pending' | 'thumb_ready' | 'thumb_failed';
  thumbKey?: string | null;
  previewKey?: string | null;
  thumbError?: string | null;
  thumbUrl?: string | null;
  previewUrl?: string | null;
};

export type AttachmentData = {
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
  /** Show metadata/details panel on the right side */
  showMetaPanel?: boolean;
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
  hideFilmstrip = true,
  showMetaPanel = false,
}: AttachmentViewerDialogProps) {
  const isDev = import.meta.env.DEV;
  const [showFallback, setShowFallback] = useState(false);
  const [urlReachable, setUrlReachable] = useState<boolean | null>(null);
  const [imageBlobUrl, setImageBlobUrl] = useState<string | null>(null);
  const [imagePreviewLoading, setImagePreviewLoading] = useState(false);
  const [imagePreviewError, setImagePreviewError] = useState<string | null>(null);
  const [zoomLevel, setZoomLevel] = useState(1);
  const imageBlobUrlRef = useRef<string | null>(null);
  
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
    setZoomLevel(1);
  }, [isGalleryMode ? attachments?.[selectedIndex]?.id : singleAttachment?.id, open]);
  
  // Derive current attachment from gallery or single mode
  const attachment = isGalleryMode 
    ? attachments[selectedIndex] ?? null
    : singleAttachment ?? null;
  const attachmentId = attachment?.id ?? null;
  const fileName = attachment ? getAttachmentDisplayName(attachment) : "Attachment";
  const objectPath = (attachment?.objectPath as string | null | undefined) ?? null;
  
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

  // PACK P2: Use URL builder helpers
  const isPdf = isPdfFile(attachment?.mimeType, fileName);
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

  const effectiveMimeType = attachment?.mimeType ?? inferMimeType(fileName);
  const isImage = typeof effectiveMimeType === "string" && effectiveMimeType.startsWith("image/");
  
  const imageViewUrl = isImage ? (attachment?.previewUrl ?? attachment?.originalUrl ?? null) : null;
  
  // Fallback download URL for non-PDFs
  const genericDownloadUrl = !isPdf ? (attachment?.originalUrl ?? null) : null;
  const stageDownloadUrl = isPdf ? pdfDownloadUrl : genericDownloadUrl;

  const formatFileSize = (bytes?: number | null) => {
    if (!bytes || bytes <= 0) return "—";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  };

  const handleZoomIn = () => setZoomLevel((prev) => Math.min(prev + 0.25, 3));
  const handleZoomOut = () => setZoomLevel((prev) => Math.max(prev - 0.25, 0.5));
  const handleZoomReset = () => setZoomLevel(1);

  const handleDownloadClick = () => {
    if (!attachment) return;

    if (onDownload) {
      onDownload(attachment);
      return;
    }

    const downloadUrl = isPdf ? pdfDownloadUrl : genericDownloadUrl;
    if (!downloadUrl) return;
    void downloadFileFromUrl(downloadUrl, fileName);
  };

  const renderArrowButton = (direction: "prev" | "next") => {
    const isPrev = direction === "prev";
    const canNavigate = isPrev ? canGoPrev : canGoNext;
    if (!isGalleryMode || !canNavigate) return null;

    return (
      <Button
        type="button"
        variant="secondary"
        size="icon"
        onClick={isPrev ? handlePrev : handleNext}
        title={isPrev ? "Previous attachment (←)" : "Next attachment (→)"}
        className={cn(
          "absolute top-1/2 z-20 h-10 w-10 -translate-y-1/2 rounded-full border border-border/70 bg-background/90 shadow-lg hover:bg-background",
          isPrev ? "left-3" : "right-3"
        )}
      >
        {isPrev ? <ChevronLeft className="h-5 w-5" /> : <ChevronRight className="h-5 w-5" />}
      </Button>
    );
  };

  const renderPdfFallback = () => (
    <div className="flex h-full min-h-[360px] flex-col items-center justify-center rounded-lg bg-muted/30 px-6 py-12 text-center">
      <FileText className="mb-4 h-16 w-16 text-muted-foreground/70" />
      <div className="space-y-2">
        <p className="text-sm font-medium">
          {!pdfViewUrl ? "PDF preview unavailable" : "Preview may be disabled by your browser"}
        </p>
        <p className="max-w-md text-xs text-muted-foreground">
          {!pdfViewUrl
            ? "Missing file reference. Download the file to view it."
            : "Some browsers block embedded PDFs. Download the file or open it in a new tab instead."}
        </p>
      </div>
      <div className="mt-4 flex flex-col gap-2">
        {pdfDownloadUrl ? (
          <Button onClick={handleDownloadClick} variant="default" size="lg">
            <Download className="mr-2 h-4 w-4" />
            Download PDF
          </Button>
        ) : null}
        {pdfViewUrl ? (
          <a
            href={pdfViewUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center gap-2 text-sm text-muted-foreground underline hover:text-foreground"
          >
            <ExternalLink className="h-3 w-3" />
            Open in new tab
          </a>
        ) : null}
      </div>
    </div>
  );

  const renderMainStage = () => {
    if (isImage) {
      return (
        <div className="flex h-full min-h-[360px] items-center justify-center overflow-auto rounded-lg bg-muted/30 p-3">
          {imagePreviewLoading ? (
            <div className="flex h-[60vh] items-center justify-center text-sm text-muted-foreground">Loading preview...</div>
          ) : imageBlobUrl ? (
            <img
              src={imageBlobUrl}
              alt={fileName}
              className="block max-h-full max-w-full object-contain transition-transform duration-150 ease-out"
              style={{ transform: `scale(${zoomLevel})`, transformOrigin: "center center" }}
            />
          ) : imagePreviewError ? (
            <div className="flex h-[60vh] items-center justify-center text-sm text-muted-foreground">{imagePreviewError}</div>
          ) : (
            <div className="flex h-[60vh] items-center justify-center text-sm text-muted-foreground">Preview not available</div>
          )}
        </div>
      );
    }

    if (isPdf && pdfViewUrl && !showFallback) {
      return (
        <div className="flex h-full min-h-[360px] flex-col rounded-lg bg-muted/30 p-2">
          <iframe
            title="PDF Preview"
            src={`${pdfViewUrl}#toolbar=1&navpanes=0`}
            className="h-full min-h-[360px] w-full rounded-md border border-border bg-background"
            allow="fullscreen"
            onLoad={() => {
              if (isDev) {
                console.log('[AttachmentViewerDialog] PDF iframe loaded:', pdfViewUrl);
              }
            }}
          />
          <div className="mt-2 flex items-center justify-between gap-2 rounded bg-muted/50 px-2 py-1 text-xs text-muted-foreground">
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
      );
    }

    if (isPdf) {
      return renderPdfFallback();
    }

    return (
      <div className="flex h-full min-h-[360px] flex-col items-center justify-center rounded-lg bg-muted/30 px-6 py-12 text-center text-muted-foreground">
        <FileText className="mb-4 h-16 w-16 opacity-50" />
        <p className="text-sm">Preview not available</p>
        {stageDownloadUrl ? (
          <Button onClick={handleDownloadClick} variant="outline" className="mt-4">
            <Download className="mr-2 h-4 w-4" />
            Download
          </Button>
        ) : null}
      </div>
    );
  };

  const renderFilmstripThumbnail = (item: AttachmentData, index: number) => {
    const itemName = getAttachmentDisplayName(item);
    const itemIsPdf = isPdfFile(item.mimeType, itemName);
    const itemIsImage = typeof item.mimeType === "string" && item.mimeType.startsWith("image/");
    const thumbUrl = item.thumbUrl ?? item.pages?.[0]?.thumbUrl ?? null;

    return (
      <button
        key={`${item.id}-${index}`}
        type="button"
        onClick={() => setSelectedIndex(index)}
        className={cn(
          "group relative h-16 w-16 shrink-0 overflow-hidden rounded-md border bg-muted/30 transition-all",
          index === selectedIndex
            ? "border-primary ring-2 ring-primary/40"
            : "border-border hover:border-primary/60"
        )}
        title={itemName}
      >
        {thumbUrl ? (
          <img src={thumbUrl} alt={itemName} className="h-full w-full object-cover" loading="lazy" />
        ) : itemIsPdf ? (
          <div className="flex h-full w-full items-center justify-center bg-slate-700/60 text-[10px] font-bold text-white">PDF</div>
        ) : itemIsImage ? (
          <div className="flex h-full w-full items-center justify-center bg-slate-800 text-[10px] font-bold text-white">IMG</div>
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-slate-800 text-[10px] font-bold text-white">FILE</div>
        )}
      </button>
    );
  };

  useEffect(() => {
    const revokeBlobUrl = () => {
      if (!imageBlobUrlRef.current) return;
      URL.revokeObjectURL(imageBlobUrlRef.current);
      imageBlobUrlRef.current = null;
        <DialogContent className="max-h-[92vh] w-[min(1280px,96vw)] max-w-[min(1280px,96vw)] overflow-hidden p-0">

            <div className="border-b border-border px-6 py-4">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <DialogTitle className="min-w-0 truncate pr-10">
                    {fileName}
                    {isGalleryMode && (
                      <span className="ml-2 text-sm font-normal text-muted-foreground">
                        ({selectedIndex + 1} of {attachments.length})
                      </span>
                    )}
                  </DialogTitle>
                  <DialogDescription className="mt-1">
                    <div className="space-y-1">
                      {attachment.mimeType ? (
                        <div>
                          <span>File type: </span>
                          <span>{attachment.mimeType}</span>
                        </div>
                      ) : (
                        <div>Preview attachment</div>
                      )}
                      {!showMetaPanel ? <AttachmentPreviewMeta attachment={attachment} /> : null}
                    </div>
                  </DialogDescription>
                </div>
                <div className="flex shrink-0 items-center gap-2 pr-8">
                  {isImage ? (
                    <>
                      <Button type="button" variant="outline" size="icon" onClick={handleZoomOut} title="Zoom out">
                        <ZoomOut className="h-4 w-4" />
                      </Button>
                      <Button type="button" variant="outline" size="sm" onClick={handleZoomReset} title="Reset zoom">
                        {Math.round(zoomLevel * 100)}%
                      </Button>
                      <Button type="button" variant="outline" size="icon" onClick={handleZoomIn} title="Zoom in">
                        <ZoomIn className="h-4 w-4" />
                      </Button>
                    </>
                  ) : null}
                  {stageDownloadUrl ? (
                    <Button onClick={handleDownloadClick} variant="outline">
                      <Download className="mr-2 h-4 w-4" />
                      Download
                    </Button>
                  ) : null}
                  <Button type="button" variant="ghost" size="icon" onClick={() => onOpenChange(false)} title="Close viewer">
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </div>
    void (async () => {
      try {
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-6 py-4">
            <div className={cn("flex min-h-0 flex-1 gap-4", showMetaPanel ? "lg:flex-row" : "flex-col")}>
              <div className="relative min-h-0 flex-1 overflow-hidden">
                {renderArrowButton("prev")}
                {renderMainStage()}
                {renderArrowButton("next")}
              </div>

              {showMetaPanel ? (
                <aside className="flex w-full shrink-0 flex-col gap-4 rounded-lg border border-border bg-muted/20 p-4 lg:w-72">
                  <div>
                    <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Details</h3>
                    <div className="mt-3 space-y-2 text-sm">
                      <div>
                        <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">File name</div>
                        <div className="break-words text-foreground">{fileName}</div>
                      </div>
                      <div>
                        <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Type</div>
                        <div>{attachment.mimeType || "Unknown"}</div>
                      </div>
                      <div>
                        <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Size</div>
                        <div>{formatFileSize(attachment.fileSize)}</div>
                      </div>
                      <div>
                        <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Created</div>
                        <div>{attachment.createdAt ? new Date(attachment.createdAt).toLocaleString() : "—"}</div>
                      </div>
                      {isGalleryMode ? (
                        <div>
                          <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Collection position</div>
                          <div>{selectedIndex + 1} of {attachments.length}</div>
                        </div>
                      ) : null}
                      {attachment.pageCount ? (
                        <div>
                          <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Pages</div>
                          <div>{attachment.pageCount}</div>
                        </div>
                      ) : null}
                    </div>
                  </div>

                  <div className="rounded-md border border-border bg-background/40 p-3">
                    <AttachmentPreviewMeta attachment={attachment} />
                  </div>

                  {stageDownloadUrl ? (
                    <Button onClick={handleDownloadClick} className="mt-auto" variant="outline">
                      <Download className="mr-2 h-4 w-4" />
                      Download original
                    </Button>
                  ) : null}
                </aside>
              ) : null}
            </div>

            {!hideFilmstrip && isGalleryMode && attachments.length > 1 ? (
              <div className="mt-4 border-t border-border pt-4">
                <div className="mb-2 text-xs font-bold uppercase tracking-widest text-muted-foreground">Thumbnails</div>
                <div className="flex gap-2 overflow-x-auto pb-2">
                  {attachments.map((item, index) => renderFilmstripThumbnail(item, index))}
                </div>
              </div>
            ) : null}

            {!showMetaPanel ? (
              <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-sm">
                <div className="min-w-0 space-y-1">
                  <div>
                    <span className="font-medium">Filename: </span>
                    <span className="max-w-[60ch] truncate text-muted-foreground">{fileName}</span>
                  </div>
                  {attachment.mimeType ? (
                    <div>
                      <span className="font-medium">Type: </span>
                      <span className="text-muted-foreground">{attachment.mimeType}</span>
                    </div>
                  ) : null}
                  {attachment.fileSize ? (
                    <div>
                      <span className="font-medium">Size: </span>
                      <span className="text-muted-foreground">{formatFileSize(attachment.fileSize)}</span>
                    </div>
                  ) : null}
                </div>

                {stageDownloadUrl ? (
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <Button onClick={handleDownloadClick} variant="outline">
                      <Download className="mr-2 h-4 w-4" />
                      Download original
                    </Button>
                    <span className="text-xs text-muted-foreground">Downloads original file</span>
                  </div>
                ) : null}
              </div>
            ) : null}
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
