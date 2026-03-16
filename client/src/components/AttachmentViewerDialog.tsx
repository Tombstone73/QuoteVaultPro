import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent } from "react";

import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { AttachmentPreviewMeta } from "@/components/AttachmentPreviewMeta";
import { downloadFileFromUrl } from "@/lib/downloadFile";
import { buildPdfDownloadUrl, buildPdfViewUrl, isPdfFile } from "@/lib/pdfUrls";
import { apiFetchBlob } from "@/lib/queryClient";
import { resolveObjectsPublicUrl } from "@/lib/apiConfig";
import { cn } from "@/lib/utils";
import { ChevronLeft, ChevronRight, Download, ExternalLink, FileText, House, Printer, RotateCcw, RotateCw, X, ZoomIn, ZoomOut } from "lucide-react";

export type AttachmentPage = {
  id: string;
  pageIndex: number;
  thumbStatus?: "uploaded" | "thumb_pending" | "thumb_ready" | "thumb_failed";
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
  thumbStatus?: "uploaded" | "thumb_pending" | "thumb_ready" | "thumb_failed";
  thumbKey?: string | null;
  previewKey?: string | null;
  thumbError?: string | null;
  originalUrl?: string | null;
  downloadUrl?: string | null;
  thumbUrl?: string | null;
  previewUrl?: string | null;
  objectPath?: string | null;
  pageCount?: number | null;
  pages?: AttachmentPage[];
};

interface AttachmentViewerDialogProps {
  attachment?: AttachmentData | null;
  attachments?: AttachmentData[];
  initialIndex?: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDownload?: (attachment: AttachmentData) => void;
  hideFilmstrip?: boolean;
  showMetaPanel?: boolean;
}

function getAttachmentName(attachment: AttachmentData | null | undefined) {
  if (!attachment) return "Attachment";
  return attachment.originalFilename || attachment.fileName || "Attachment";
}

function inferMimeType(name: string): string | null {
  const n = (name || "").toLowerCase();
  if (n.endsWith(".pdf")) return "application/pdf";
  if (n.endsWith(".png")) return "image/png";
  if (n.endsWith(".jpg") || n.endsWith(".jpeg")) return "image/jpeg";
  if (n.endsWith(".webp")) return "image/webp";
  if (n.endsWith(".gif")) return "image/gif";
  if (n.endsWith(".svg")) return "image/svg+xml";
  return null;
}

function formatFileSize(bytes?: number | null) {
  if (!bytes || bytes <= 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function normalizeThumbnailUrl(value?: string | null) {
  if (!value) return undefined;
  return resolveObjectsPublicUrl(value) ?? value;
}

function FilmstripThumbnail({
  item,
  isActive,
  onClick,
}: {
  item: AttachmentData;
  isActive: boolean;
  onClick: () => void;
}) {
  const itemName = getAttachmentName(item);
  const itemMimeType = item.mimeType ?? inferMimeType(itemName);
  const itemIsPdf = isPdfFile(itemMimeType, itemName);
  const itemIsImage = typeof itemMimeType === "string" && itemMimeType.startsWith("image/");
  const normalizedThumbUrl = normalizeThumbnailUrl(item.thumbUrl ?? item.pages?.[0]?.thumbUrl ?? null);
  const [thumbFailed, setThumbFailed] = useState(false);

  useEffect(() => {
    setThumbFailed(false);
  }, [normalizedThumbUrl]);

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "relative h-16 w-16 shrink-0 overflow-hidden rounded-md border bg-muted/30 transition-all",
        isActive ? "border-primary ring-2 ring-primary/40" : "border-border hover:border-primary/60"
      )}
      title={itemName}
    >
      {normalizedThumbUrl && !thumbFailed ? (
        <img
          src={normalizedThumbUrl}
          alt={itemName}
          className="h-full w-full object-cover"
          loading="lazy"
          onError={() => setThumbFailed(true)}
        />
      ) : itemIsPdf ? (
        <div className="flex h-full w-full items-center justify-center bg-slate-700/60 text-[10px] font-bold text-white">PDF</div>
      ) : itemIsImage ? (
        <div className="flex h-full w-full items-center justify-center bg-slate-800 text-[10px] font-bold text-white">IMG</div>
      ) : (
        <div className="flex h-full w-full items-center justify-center bg-slate-800 text-[10px] font-bold text-white">FILE</div>
      )}
    </button>
  );
}

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
  const [selectedIndex, setSelectedIndex] = useState(initialIndex);
  const [imageBlobUrl, setImageBlobUrl] = useState<string | null>(null);
  const [imagePreviewLoading, setImagePreviewLoading] = useState(false);
  const [imagePreviewError, setImagePreviewError] = useState<string | null>(null);
  const [zoomLevel, setZoomLevel] = useState(1);
  const [panX, setPanX] = useState(0);
  const [panY, setPanY] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [pdfDocument, setPdfDocument] = useState<any | null>(null);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [pdfPageNumber, setPdfPageNumber] = useState(1);
  const [pdfPageCount, setPdfPageCount] = useState(0);
  const [pdfZoomLevel, setPdfZoomLevel] = useState(1);
  const [pdfRenderedScale, setPdfRenderedScale] = useState(1);
  const [pdfRotation, setPdfRotation] = useState(0);
  const [pdfFitMode, setPdfFitMode] = useState<"page" | "width" | "custom">("page");
  const [pdfStageSize, setPdfStageSize] = useState({ width: 0, height: 0 });
  const [pdfMetadata, setPdfMetadata] = useState<Record<string, string | number | null>>({});
  const imageBlobUrlRef = useRef<string | null>(null);
  const dragPointerIdRef = useRef<number | null>(null);
  const dragOriginRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const pdfStageRef = useRef<HTMLDivElement | null>(null);
  const pdfCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const pdfRenderTaskRef = useRef<any | null>(null);

  const galleryAttachments = attachments?.length ? attachments : undefined;
  const attachmentCount = galleryAttachments?.length ?? (singleAttachment ? 1 : 0);

  useEffect(() => {
    if (open) {
      setSelectedIndex(initialIndex);
    }
  }, [initialIndex, open]);

  const currentAttachment = useMemo(() => {
    if (galleryAttachments) {
      return galleryAttachments[selectedIndex] ?? galleryAttachments[0] ?? null;
    }
    return singleAttachment ?? null;
  }, [galleryAttachments, selectedIndex, singleAttachment]);

  const fileName = getAttachmentName(currentAttachment);
  const effectiveMimeType = currentAttachment?.mimeType ?? inferMimeType(fileName);
  const isPdf = isPdfFile(effectiveMimeType, fileName);
  const isImage = typeof effectiveMimeType === "string" && effectiveMimeType.startsWith("image/");
  const imageViewUrl = isImage ? currentAttachment?.previewUrl ?? currentAttachment?.originalUrl ?? null : null;
  const objectPath = currentAttachment?.objectPath ?? null;
  const pdfViewUrl = isPdf ? buildPdfViewUrl(objectPath) : null;
  const pdfDownloadUrl = isPdf ? buildPdfDownloadUrl(objectPath, fileName) : null;
  const pdfSourceUrl = isPdf
    ? currentAttachment?.originalUrl ?? currentAttachment?.previewUrl ?? currentAttachment?.fileUrl ?? pdfViewUrl
    : null;
  const genericDownloadUrl = !isPdf ? currentAttachment?.downloadUrl ?? currentAttachment?.originalUrl ?? currentAttachment?.fileUrl ?? null : null;
  const downloadUrl = isPdf
    ? currentAttachment?.downloadUrl ?? pdfDownloadUrl ?? currentAttachment?.originalUrl ?? currentAttachment?.fileUrl ?? null
    : genericDownloadUrl;
  const canGoPrev = !!galleryAttachments && selectedIndex > 0;
  const canGoNext = !!galleryAttachments && selectedIndex < galleryAttachments.length - 1;

  useEffect(() => {
    if (!open || !galleryAttachments) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "ArrowLeft" && canGoPrev) {
        event.preventDefault();
        setSelectedIndex((value) => Math.max(0, value - 1));
      }
      if (event.key === "ArrowRight" && canGoNext) {
        event.preventDefault();
        setSelectedIndex((value) => Math.min(galleryAttachments.length - 1, value + 1));
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [canGoNext, canGoPrev, galleryAttachments, open]);

  useEffect(() => {
    setZoomLevel(1);
    setPanX(0);
    setPanY(0);
    setIsDragging(false);
    setPdfDocument(null);
    setPdfLoading(false);
    setPdfError(null);
    setPdfPageNumber(1);
    setPdfPageCount(currentAttachment?.pageCount ?? 0);
    setPdfZoomLevel(1);
    setPdfRenderedScale(1);
    setPdfRotation(0);
    setPdfFitMode("page");
    setPdfMetadata({});
    dragPointerIdRef.current = null;
  }, [currentAttachment?.id, open]);

  useEffect(() => {
    if (zoomLevel <= 1) {
      setPanX(0);
      setPanY(0);
      setIsDragging(false);
      dragPointerIdRef.current = null;
    }
  }, [zoomLevel]);

  useEffect(() => {
    const revokeBlobUrl = () => {
      if (!imageBlobUrlRef.current) return;
      URL.revokeObjectURL(imageBlobUrlRef.current);
      imageBlobUrlRef.current = null;
    };

    revokeBlobUrl();
    setImageBlobUrl(null);
    setImagePreviewLoading(false);
    setImagePreviewError(null);

    if (!open || !currentAttachment?.id || !isImage) {
      return () => revokeBlobUrl();
    }

    if (!imageViewUrl) {
      setImagePreviewError("Preview URL unavailable.");
      return () => revokeBlobUrl();
    }

    let cancelled = false;
    setImagePreviewLoading(true);

    void (async () => {
      try {
        const blob = await apiFetchBlob(imageViewUrl, { method: "GET", credentials: "include" });
        if (cancelled) return;
        const objectUrl = URL.createObjectURL(blob);
        imageBlobUrlRef.current = objectUrl;
        setImageBlobUrl(objectUrl);
      } catch (error) {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : "Failed to load preview";
        setImagePreviewError("Unable to load image preview. Use Download original.");
        if (isDev) {
          console.log(`[AttachmentViewerDialog] image preview fetch failed url=${imageViewUrl} error=${message}`);
        }
      } finally {
        if (!cancelled) {
          setImagePreviewLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      revokeBlobUrl();
    };
  }, [currentAttachment?.id, imageViewUrl, isDev, isImage, open]);

  useEffect(() => {
    if (!open || !isPdf || !currentAttachment?.id || !pdfSourceUrl) {
      return;
    }

    let cancelled = false;
    let loadedDocument: any | null = null;

    setPdfLoading(true);
    setPdfError(null);

    void (async () => {
      try {
        const [pdfjs, pdfBlob] = await Promise.all([
          import("pdfjs-dist"),
          apiFetchBlob(pdfSourceUrl, { method: "GET", credentials: "include" }),
        ]);

        if (cancelled) return;

        pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

        const loadingTask = pdfjs.getDocument({
          data: new Uint8Array(await pdfBlob.arrayBuffer()),
          useWorkerFetch: false,
          isEvalSupported: false,
        });

        loadedDocument = await loadingTask.promise;
        if (cancelled) {
          await loadedDocument.destroy();
          return;
        }

        setPdfDocument(loadedDocument);
        setPdfPageCount(loadedDocument.numPages ?? currentAttachment.pageCount ?? 0);
        setPdfPageNumber(1);

        try {
          const [metadataResult, firstPage] = await Promise.all([
            loadedDocument.getMetadata().catch(() => null),
            loadedDocument.getPage(1).catch(() => null),
          ]);

          if (!cancelled) {
            const info = metadataResult?.info ?? {};
            setPdfMetadata({
              title: typeof info.Title === "string" ? info.Title : null,
              author: typeof info.Author === "string" ? info.Author : null,
              creator: typeof info.Creator === "string" ? info.Creator : null,
              producer: typeof info.Producer === "string" ? info.Producer : null,
              subject: typeof info.Subject === "string" ? info.Subject : null,
              pageWidth: firstPage ? Math.round(firstPage.getViewport({ scale: 1 }).width) : null,
              pageHeight: firstPage ? Math.round(firstPage.getViewport({ scale: 1 }).height) : null,
            });
          }
        } catch {
          // ignore metadata failures
        }
      } catch (error) {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : "Unable to load PDF preview.";
        setPdfError(message);
        if (isDev) {
          console.warn("[AttachmentViewerDialog] PDF.js load failed", error);
        }
      } finally {
        if (!cancelled) {
          setPdfLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      if (pdfRenderTaskRef.current) {
        try {
          pdfRenderTaskRef.current.cancel();
        } catch {
          // ignore
        }
        pdfRenderTaskRef.current = null;
      }
      if (loadedDocument) {
        void loadedDocument.destroy().catch(() => undefined);
      }
    };
  }, [currentAttachment?.id, currentAttachment?.pageCount, isDev, isPdf, open, pdfSourceUrl]);

  useEffect(() => {
    if (!open || !isPdf || !pdfDocument || !pdfStageRef.current) {
      return;
    }

    const element = pdfStageRef.current;
    const updateSize = () => {
      const rect = element.getBoundingClientRect();
      const nextWidth = Math.round(rect.width);
      const nextHeight = Math.round(rect.height);
      setPdfStageSize((current) => {
        if (current.width === nextWidth && current.height === nextHeight) {
          return current;
        }
        return { width: nextWidth, height: nextHeight };
      });
    };

    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(element);

    return () => {
      observer.disconnect();
    };
  }, [currentAttachment?.id, isPdf, open, pdfDocument]);

  useEffect(() => {
    if (!open || !isPdf || !pdfDocument || !pdfCanvasRef.current || !pdfStageSize.width || !pdfStageSize.height) {
      return;
    }

    let cancelled = false;

    void (async () => {
      try {
        const page = await pdfDocument.getPage(pdfPageNumber);
        if (cancelled) return;

        const rotation = (page.rotate ?? 0) + pdfRotation;
        const baseViewport = page.getViewport({ scale: 1, rotation });
        const availableWidth = Math.max(pdfStageSize.width - 32, 120);
        const availableHeight = Math.max(pdfStageSize.height - 32, 120);

        const fitWidthScale = availableWidth / Math.max(baseViewport.width, 1);
        const fitPageScale = Math.min(fitWidthScale, availableHeight / Math.max(baseViewport.height, 1));

        const nextScale =
          pdfFitMode === "width"
            ? fitWidthScale
            : pdfFitMode === "page"
            ? fitPageScale
            : pdfZoomLevel;

        const clampedScale = Math.min(4, Math.max(0.4, nextScale));
        const viewport = page.getViewport({ scale: clampedScale, rotation });
        const canvas = pdfCanvasRef.current;
        if (!canvas) return;

        const context = canvas.getContext("2d");
        if (!context) {
          setPdfError("Canvas preview unavailable.");
          return;
        }

        const devicePixelRatio = window.devicePixelRatio || 1;
        canvas.width = Math.floor(viewport.width * devicePixelRatio);
        canvas.height = Math.floor(viewport.height * devicePixelRatio);
        canvas.style.width = `${Math.floor(viewport.width)}px`;
        canvas.style.height = `${Math.floor(viewport.height)}px`;
        context.setTransform(1, 0, 0, 1, 0, 0);
        context.clearRect(0, 0, canvas.width, canvas.height);

        if (pdfRenderTaskRef.current) {
          try {
            pdfRenderTaskRef.current.cancel();
          } catch {
            // ignore
          }
        }

        const renderTask = page.render({
          canvasContext: context,
          viewport,
          transform: devicePixelRatio === 1 ? undefined : [devicePixelRatio, 0, 0, devicePixelRatio, 0, 0],
        });

        pdfRenderTaskRef.current = renderTask;
        await renderTask.promise;
        if (cancelled) return;
        setPdfRenderedScale(clampedScale);
        setPdfError(null);
      } catch (error: any) {
        if (cancelled || error?.name === "RenderingCancelledException") {
          return;
        }
        const message = error instanceof Error ? error.message : "Unable to render PDF page.";
        setPdfError(message);
        if (isDev) {
          console.warn("[AttachmentViewerDialog] PDF.js render failed", error);
        }
      }
    })();

    return () => {
      cancelled = true;
      if (pdfRenderTaskRef.current) {
        try {
          pdfRenderTaskRef.current.cancel();
        } catch {
          // ignore
        }
        pdfRenderTaskRef.current = null;
      }
    };
  }, [isDev, isPdf, open, pdfDocument, pdfFitMode, pdfPageNumber, pdfRotation, pdfStageSize.height, pdfStageSize.width, pdfZoomLevel]);

  if (!currentAttachment) return null;

  const handleDownloadClick = () => {
    if (onDownload) {
      onDownload(currentAttachment);
      return;
    }
    if (!downloadUrl) return;
    void downloadFileFromUrl(downloadUrl, fileName);
  };

  const clampZoom = (value: number) => Math.min(3, Math.max(0.5, value));
  const canPanImage = isImage && zoomLevel > 1 && !!imageBlobUrl;
  const clampPdfZoom = (value: number) => Math.min(4, Math.max(0.4, value));
  const pdfCanGoPrev = isPdf && pdfPageNumber > 1;
  const pdfCanGoNext = isPdf && pdfPageCount > 0 && pdfPageNumber < pdfPageCount;

  const resetImageView = () => {
    setZoomLevel(1);
    setPanX(0);
    setPanY(0);
    setIsDragging(false);
    dragPointerIdRef.current = null;
  };

  const handleImageWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    if (!isImage) return;
    event.preventDefault();
    event.stopPropagation();
    setZoomLevel((value) => clampZoom(value + (event.deltaY < 0 ? 0.1 : -0.1)));
  };

  const handleImagePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!canPanImage) return;
    event.preventDefault();
    dragPointerIdRef.current = event.pointerId;
    dragOriginRef.current = {
      x: event.clientX - panX,
      y: event.clientY - panY,
    };
    setIsDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handleImagePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!canPanImage || !isDragging || dragPointerIdRef.current !== event.pointerId) return;
    event.preventDefault();
    setPanX(event.clientX - dragOriginRef.current.x);
    setPanY(event.clientY - dragOriginRef.current.y);
  };

  const stopImageDragging = (event?: ReactPointerEvent<HTMLDivElement>) => {
    if (event && dragPointerIdRef.current === event.pointerId) {
      try {
        event.currentTarget.releasePointerCapture(event.pointerId);
      } catch {
        // no-op
      }
    }
    dragPointerIdRef.current = null;
    setIsDragging(false);
  };

  const renderArrowButton = (direction: "prev" | "next") => {
    const isPrev = direction === "prev";
    const enabled = isPrev ? canGoPrev : canGoNext;
    if (!galleryAttachments || !enabled) return null;

    return (
      <Button
        type="button"
        variant="secondary"
        size="icon"
        onClick={() => setSelectedIndex((value) => value + (isPrev ? -1 : 1))}
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
        <p className="text-sm font-medium">{pdfError ? "PDF preview unavailable" : !pdfViewUrl ? "PDF preview unavailable" : "Preview may be disabled by your browser"}</p>
        <p className="max-w-md text-xs text-muted-foreground">
          {pdfError
            ? pdfError
            : !pdfViewUrl
            ? "Missing file reference. Download the file to view it."
            : "Some browsers block embedded PDFs. Download the file or open it in a new tab instead."}
        </p>
      </div>
      <div className="mt-4 flex flex-col gap-2">
        {downloadUrl ? (
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

  const renderStage = () => {
    if (isImage) {
      return (
        <div
          className={cn(
            "flex h-full min-h-[360px] items-center justify-center overflow-hidden rounded-lg bg-muted/30 p-3",
            canPanImage ? (isDragging ? "cursor-grabbing" : "cursor-grab") : "cursor-default"
          )}
          onWheel={handleImageWheel}
          onPointerDown={handleImagePointerDown}
          onPointerMove={handleImagePointerMove}
          onPointerUp={stopImageDragging}
          onPointerLeave={stopImageDragging}
          onPointerCancel={stopImageDragging}
        >
          {imagePreviewLoading ? (
            <div className="flex h-[60vh] items-center justify-center text-sm text-muted-foreground">Loading preview...</div>
          ) : imageBlobUrl ? (
            <img
              src={imageBlobUrl}
              alt={fileName}
              className={cn(
                "block max-h-full max-w-full object-contain transition-transform duration-150 ease-out select-none",
                canPanImage ? (isDragging ? "cursor-grabbing" : "cursor-grab") : "cursor-default"
              )}
              draggable={false}
              style={{ transform: `translate(${panX}px, ${panY}px) scale(${zoomLevel})`, transformOrigin: "center center" }}
            />
          ) : imagePreviewError ? (
            <div className="flex h-[60vh] items-center justify-center text-sm text-muted-foreground">{imagePreviewError}</div>
          ) : (
            <div className="flex h-[60vh] items-center justify-center text-sm text-muted-foreground">Preview not available</div>
          )}
        </div>
      );
    }

    if (isPdf && pdfDocument && !pdfError) {
      return (
        <div className="flex h-full min-h-[360px] flex-col rounded-lg bg-muted/30">
          <div ref={pdfStageRef} className="flex min-h-[360px] flex-1 items-center justify-center overflow-auto rounded-lg border border-border bg-zinc-950/90 p-4">
            {pdfLoading ? (
              <div className="text-sm text-muted-foreground">Loading PDF…</div>
            ) : (
              <canvas ref={pdfCanvasRef} className="max-w-full rounded-md bg-white shadow-2xl" />
            )}
          </div>
        </div>
      );
    }

    if (isPdf) {
      if (pdfLoading) {
        return (
          <div className="flex h-full min-h-[360px] items-center justify-center rounded-lg bg-muted/30 px-6 py-12 text-center text-sm text-muted-foreground">
            Loading PDF…
          </div>
        );
      }
      return renderPdfFallback();
    }

    return (
      <div className="flex h-full min-h-[360px] flex-col items-center justify-center rounded-lg bg-muted/30 px-6 py-12 text-center text-muted-foreground">
        <FileText className="mb-4 h-16 w-16 opacity-50" />
        <p className="text-sm">Preview not available</p>
        {downloadUrl ? (
          <Button onClick={handleDownloadClick} variant="outline" className="mt-4">
            <Download className="mr-2 h-4 w-4" />
            Download
          </Button>
        ) : null}
      </div>
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent hideClose className="h-[94vh] max-h-[94vh] w-[min(1600px,98vw)] max-w-[min(1600px,98vw)] overflow-hidden p-0">
        <DialogHeader className="border-b border-border px-6 py-4 text-left">
          <div className="flex flex-col gap-4 pr-8 xl:flex-row xl:items-start xl:justify-between">
            <div className="min-w-0">
              <DialogTitle className="truncate pr-4">
                {fileName}
                {galleryAttachments ? (
                  <span className="ml-2 text-sm font-normal text-muted-foreground">
                    ({selectedIndex + 1} of {attachmentCount})
                  </span>
                ) : null}
              </DialogTitle>
              <DialogDescription className="mt-1">
                <div className="space-y-1">
                  <div>{effectiveMimeType ? `File type: ${effectiveMimeType}` : "Preview attachment"}</div>
                  {!showMetaPanel ? <AttachmentPreviewMeta attachment={currentAttachment} /> : null}
                </div>
              </DialogDescription>
            </div>

            <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 xl:max-w-[55%]">
              {isImage ? (
                <>
                  <Button type="button" variant="outline" size="icon" onClick={() => setZoomLevel((value) => Math.max(value - 0.25, 0.5))} title="Zoom out">
                    <ZoomOut className="h-4 w-4" />
                  </Button>
                  <Button type="button" variant="outline" size="icon" onClick={resetImageView} title="Reset view">
                    <House className="h-4 w-4" />
                  </Button>
                  <Button type="button" variant="outline" size="sm" onClick={() => setZoomLevel(1)} title="Reset zoom">
                    {Math.round(zoomLevel * 100)}%
                  </Button>
                  <Button type="button" variant="outline" size="icon" onClick={() => setZoomLevel((value) => Math.min(value + 0.25, 3))} title="Zoom in">
                    <ZoomIn className="h-4 w-4" />
                  </Button>
                </>
              ) : isPdf ? (
                <>
                  <Button type="button" variant="outline" size="icon" onClick={() => setPdfPageNumber((value) => Math.max(1, value - 1))} disabled={!pdfCanGoPrev} title="Previous page">
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <Button type="button" variant="outline" size="sm" className="min-w-[92px]" disabled={pdfPageCount <= 0} title="Current page">
                    {pdfPageCount > 0 ? `Page ${pdfPageNumber}/${pdfPageCount}` : "PDF"}
                  </Button>
                  <Button type="button" variant="outline" size="icon" onClick={() => setPdfPageNumber((value) => Math.min(pdfPageCount || value, value + 1))} disabled={!pdfCanGoNext} title="Next page">
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                  <Button type="button" variant="outline" size="icon" onClick={() => setPdfFitMode("width")} title="Fit width">
                    <House className="h-4 w-4" />
                  </Button>
                  <Button type="button" variant="outline" size="sm" onClick={() => setPdfFitMode("page")} title="Fit page">
                    Fit
                  </Button>
                  <Button type="button" variant="outline" size="icon" onClick={() => {
                    setPdfFitMode("custom");
                    setPdfZoomLevel((value) => clampPdfZoom(value - 0.1));
                  }} title="Zoom out">
                    <ZoomOut className="h-4 w-4" />
                  </Button>
                  <Button type="button" variant="outline" size="sm" onClick={() => {
                    setPdfFitMode("custom");
                    setPdfZoomLevel(1);
                  }} title="Reset PDF zoom">
                    {Math.round(pdfRenderedScale * 100)}%
                  </Button>
                  <Button type="button" variant="outline" size="icon" onClick={() => {
                    setPdfFitMode("custom");
                    setPdfZoomLevel((value) => clampPdfZoom(value + 0.1));
                  }} title="Zoom in">
                    <ZoomIn className="h-4 w-4" />
                  </Button>
                  <Button type="button" variant="outline" size="icon" onClick={() => setPdfRotation((value) => value - 90)} title="Rotate left">
                    <RotateCcw className="h-4 w-4" />
                  </Button>
                  <Button type="button" variant="outline" size="icon" onClick={() => setPdfRotation((value) => value + 90)} title="Rotate right">
                    <RotateCw className="h-4 w-4" />
                  </Button>
                  {pdfViewUrl || pdfSourceUrl ? (
                    <Button type="button" variant="outline" size="icon" onClick={() => {
                      const url = pdfViewUrl ?? pdfSourceUrl;
                      if (!url) return;
                      window.open(url, "_blank", "noopener,noreferrer");
                    }} title="Open / print PDF">
                      <Printer className="h-4 w-4" />
                    </Button>
                  ) : null}
                </>
              ) : null}
              {downloadUrl ? (
                <Button onClick={handleDownloadClick} variant="outline">
                  <Download className="mr-2 h-4 w-4" />
                  Download
                </Button>
              ) : null}
              {isPdf && (pdfViewUrl || pdfSourceUrl) ? (
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => {
                    const url = pdfViewUrl ?? pdfSourceUrl;
                    if (!url) return;
                    window.open(url, "_blank", "noopener,noreferrer");
                  }}
                  title="Open in new tab"
                >
                  <ExternalLink className="h-4 w-4" />
                </Button>
              ) : null}
              <Button type="button" variant="ghost" size="icon" onClick={() => onOpenChange(false)} title="Close viewer">
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-6 py-4">
          <div className={cn("flex min-h-0 flex-1 gap-4", showMetaPanel ? "xl:flex-row" : "flex-col")}>
            <div className="relative min-h-0 flex-1 overflow-hidden">
              {renderArrowButton("prev")}
              {renderStage()}
              {renderArrowButton("next")}
            </div>

            {showMetaPanel ? (
              <aside className="flex w-full shrink-0 flex-col gap-4 rounded-lg border border-border bg-muted/20 p-4 xl:w-80">
                <div>
                  <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Details</h3>
                  <div className="mt-3 space-y-2 text-sm">
                    <div>
                      <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">File name</div>
                      <div className="break-words text-foreground">{fileName}</div>
                    </div>
                    <div>
                      <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Type</div>
                      <div>{effectiveMimeType || "Unknown"}</div>
                    </div>
                    <div>
                      <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Size</div>
                      <div>{formatFileSize(currentAttachment.fileSize)}</div>
                    </div>
                    <div>
                      <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Created</div>
                      <div>{currentAttachment.createdAt ? new Date(currentAttachment.createdAt).toLocaleString() : "—"}</div>
                    </div>
                    {galleryAttachments ? (
                      <div>
                        <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Collection position</div>
                        <div>{selectedIndex + 1} of {attachmentCount}</div>
                      </div>
                    ) : null}
                    {currentAttachment.pageCount ? (
                      <div>
                        <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Pages</div>
                        <div>{pdfPageCount || currentAttachment.pageCount}</div>
                      </div>
                    ) : null}
                    {isPdf && pdfMetadata.title ? (
                      <div>
                        <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Document title</div>
                        <div>{pdfMetadata.title}</div>
                      </div>
                    ) : null}
                    {isPdf && pdfMetadata.author ? (
                      <div>
                        <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Author</div>
                        <div>{pdfMetadata.author}</div>
                      </div>
                    ) : null}
                    {isPdf && pdfMetadata.producer ? (
                      <div>
                        <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Producer</div>
                        <div>{pdfMetadata.producer}</div>
                      </div>
                    ) : null}
                  </div>
                </div>

                <div className="rounded-md border border-border bg-background/40 p-3">
                  <AttachmentPreviewMeta attachment={currentAttachment} />
                </div>

                {downloadUrl ? (
                  <Button onClick={handleDownloadClick} className="mt-auto" variant="outline">
                    <Download className="mr-2 h-4 w-4" />
                    Download original
                  </Button>
                ) : null}
              </aside>
            ) : null}
          </div>

          {!hideFilmstrip && galleryAttachments && galleryAttachments.length > 1 ? (
            <div className="mt-4 border-t border-border pt-4">
              <div className="mb-2 text-xs font-bold uppercase tracking-widest text-muted-foreground">Thumbnails</div>
              <div className="flex gap-2 overflow-x-auto pb-2">
                {galleryAttachments.map((item, index) => (
                  <FilmstripThumbnail
                    key={`${item.id}-${index}`}
                    item={item}
                    isActive={index === selectedIndex}
                    onClick={() => setSelectedIndex(index)}
                  />
                ))}
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
                {effectiveMimeType ? (
                  <div>
                    <span className="font-medium">Type: </span>
                    <span className="text-muted-foreground">{effectiveMimeType}</span>
                  </div>
                ) : null}
                {currentAttachment.fileSize ? (
                  <div>
                    <span className="font-medium">Size: </span>
                    <span className="text-muted-foreground">{formatFileSize(currentAttachment.fileSize)}</span>
                  </div>
                ) : null}
              </div>

              {downloadUrl ? (
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
        </div>
      </DialogContent>
    </Dialog>
  );
}
