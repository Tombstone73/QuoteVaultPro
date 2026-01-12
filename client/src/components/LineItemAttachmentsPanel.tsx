import { useState, useRef, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Paperclip, Upload, Download, X, Loader2, Image, FileText, File, ChevronDown, ChevronUp, Sparkles } from "lucide-react";
import { cn, isValidHttpUrl } from "@/lib/utils";
import { getAttachmentDisplayName, isPdfAttachment, getPdfPageCount } from "@/lib/attachments";
import { hasAnyUnsettledAttachment } from "@/lib/attachments/attachmentStatus";
import { AttachmentPreviewMeta } from "@/components/AttachmentPreviewMeta";
import { AttachmentViewerDialog } from "@/components/AttachmentViewerDialog";
import { downloadFileFromUrl } from "@/lib/downloadFile";
import { getThumbSrc } from "@/lib/getThumbSrc";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { setPendingExpandedLineItemId } from "@/lib/ui/persistExpandedLineItem";
import { SUPABASE_MAX_UPLOAD_BYTES } from "@/lib/config/storage";
import { fileToBase64 } from "@/lib/uploads/fileToBase64";
import { LargeFileLocalDevWarningDialog } from "@/components/LargeFileLocalDevWarningDialog";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

type StorageTarget = "supabase" | "local_dev";

const LOCAL_ORIGINAL_NOT_PRESENT = "local_original_not_present";

// Helper: Check if error message indicates thumbnail generation is unavailable (not failed)
function isThumbsUnavailableError(msg: string | null | undefined): boolean {
  if (!msg) return false;
  const lowerMsg = msg.toLowerCase();
  return lowerMsg.includes('temporarily unavailable') ||
         lowerMsg.includes('dependencies not installed') ||
         lowerMsg.includes('sharp unavailable');
}

function isLocalPreviewUnavailableError(msg: string | null | undefined): boolean {
  if (!msg) return false;
  return msg.toLowerCase().includes(LOCAL_ORIGINAL_NOT_PRESENT);
}

type AttachmentPage = {
  id: string;
  pageIndex: number;
  thumbStatus: 'uploaded' | 'thumb_pending' | 'thumb_ready' | 'thumb_failed';
  thumbKey?: string | null;
  previewKey?: string | null;
  thumbError?: string | null;
  thumbUrl?: string | null;
  previewUrl?: string | null;
};

type LineItemAttachment = {
  id: string;
  source?: 'attachment' | 'asset';
  fileName: string;
  fileUrl: string;
  fileSize?: number | null;
  mimeType?: string | null;
  createdAt: string;
  originalFilename?: string | null;
  storageProvider?: string | null;
  // Thumbnail scaffolding fields (migration 0034)
  thumbStatus?: 'uploaded' | 'thumb_pending' | 'thumb_ready' | 'thumb_failed';
  thumbKey?: string | null;
  previewKey?: string | null;
  thumbError?: string | null;
  // Server-generated signed URLs (added for proper image rendering)
  originalUrl?: string | null;
  thumbUrl?: string | null;
  previewUrl?: string | null;
  // Object path for constructing /objects URLs (same-origin proxy)
  objectPath?: string | null;
  // PDF multi-page support
  pageCount?: number | null;
  pages?: AttachmentPage[];
};

interface LineItemAttachmentsPanelProps {
  /** The quote ID (may be null for temporary line items) */
  quoteId: string | null;
  /** Parent type for the attachments panel. Defaults to quote behavior. */
  parentType?: "quote" | "order";
  /** Order ID when parentType is "order" */
  orderId?: string | null;
  /** The line item ID - required, artwork is keyed off this */
  lineItemId: string | undefined;
  /** Product name for display */
  productName?: string;
  /** Whether the panel is expanded by default */
  defaultExpanded?: boolean;
  /** Optional function to ensure quote is created before upload (for new quotes) */
  ensureQuoteId?: () => Promise<string>;
  /** Optional function to ensure line item is persisted before upload (for TEMP line items) */
  ensureLineItemId?: () => Promise<{ quoteId: string; lineItemId: string }>;
  /** The line item key (tempId or id) - used for persisting expansion state across route transitions */
  lineItemKey?: string;
}

export function LineItemAttachmentsPanel({
  quoteId,
  parentType = "quote",
  orderId,
  lineItemId,
  productName,
  defaultExpanded = false,
  ensureQuoteId,
  ensureLineItemId,
  lineItemKey,
}: LineItemAttachmentsPanelProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  const [userClosed, setUserClosed] = useState(false); // Track if user explicitly closed the panel
  const [isCreatingQuote, setIsCreatingQuote] = useState(false);
  const [isPersistingLineItem, setIsPersistingLineItem] = useState(false);
  const [previewFile, setPreviewFile] = useState<LineItemAttachment | null>(null);
  const [pendingFiles, setPendingFiles] = useState<File[] | null>(null);
  const [largeFileDialogOpen, setLargeFileDialogOpen] = useState(false);
  // Store ensured IDs to use during upload (props may not have updated yet)
  const ensuredIdsRef = useRef<{ quoteId: string | null; lineItemId: string | null }>({
    quoteId: null,
    lineItemId: null,
  });

  // Polling guard: bounded window to prevent runaway polling
  const pollingGuardRef = useRef<{ startAt: number | null; attempts: number }>({
    startAt: null,
    attempts: 0,
  });

  // Build API path for this line item's files.
  // SAFETY: Do not construct path with undefined lineItemId.
  const filesApiPath = lineItemId
    ? (parentType === "order"
        ? (orderId ? `/api/orders/${orderId}/line-items/${lineItemId}/files` : null)
        : (quoteId
            ? `/api/quotes/${quoteId}/line-items/${lineItemId}/files`
            : `/api/line-items/${lineItemId}/files`))
    : null;

  // Fetch system status to check if thumbnails are enabled
  const { data: systemStatus } = useQuery<{ thumbnailsEnabled: boolean }>({
    queryKey: ['/api/system/status'],
    queryFn: async () => {
      const response = await fetch('/api/system/status', { credentials: 'include' });
      if (!response.ok) return { thumbnailsEnabled: true }; // Default to enabled on error
      return response.json();
    },
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes
  });

  const thumbnailsEnabled = systemStatus?.thumbnailsEnabled ?? true; // Default to enabled

  // Fetch attachments for this line item
  // Includes bounded polling for thumbnail generation and page count detection
  const { data: attachments = [], isLoading } = useQuery<LineItemAttachment[]>({
    queryKey: filesApiPath ? [filesApiPath] : ["disabled-attachments"],
    queryFn: async () => {
      if (!filesApiPath) return [];
      const response = await fetch(filesApiPath, { credentials: "include" });
      if (!response.ok) throw new Error("Failed to load line item files");
      const json = await response.json();

      if (parentType === "order") {
        const attachments = Array.isArray(json?.data) ? json.data : [];
        const assets = Array.isArray(json?.assets) ? json.assets : [];

        const mappedAttachments = attachments.map((a: any) => ({
          ...a,
          source: 'attachment' as const,
        })) as LineItemAttachment[];

        const mappedAssets = assets.map((a: any) => ({
          id: a.id,
          source: 'asset' as const,
          fileName: a.fileName || a.originalFilename || "file",
          originalFilename: a.originalFilename || a.fileName || null,
          fileUrl: a.fileUrl || a.fileKey || a.key || "",
          fileSize: a.fileSize ?? a.sizeBytes ?? null,
          mimeType: a.mimeType ?? null,
          createdAt: a.createdAt || new Date().toISOString(),
          originalUrl: a.originalUrl ?? null,
          downloadUrl: a.downloadUrl ?? null,
          thumbUrl: a.thumbUrl ?? a.thumbnailUrl ?? null,
          previewUrl: a.previewUrl ?? null,
          // Contract aliases (server-side applyThumbnailContract)
          thumbnailUrl: a.thumbnailUrl ?? null,
          previewThumbnailUrl: a.previewThumbnailUrl ?? null,

          // Map canonical asset preview pipeline state into existing attachment-style fields
          // so the existing polling logic continues to work for order assets.
          thumbStatus:
            a.previewStatus === "ready"
              ? ("thumb_ready" as const)
              : a.previewStatus === "pending"
              ? ("thumb_pending" as const)
              : a.previewStatus === "failed"
              ? ("thumb_failed" as const)
              : undefined,
          thumbError: a.previewError ?? a.thumbError,

          // Preserve optional fields if present
          thumbKey: a.thumbKey,
          previewKey: a.previewKey,
          pageCount: a.pageCount,
          pages: a.pages,
        } as LineItemAttachment));

        return [...mappedAttachments, ...mappedAssets] as LineItemAttachment[];
      }

      return json.data || [];
    },
    enabled: !!filesApiPath,
    refetchInterval: (query) => {
      // Bounded polling for thumbnail/pageCount processing
      const MAX_POLL_MS = 60_000; // 60 seconds max
      const MAX_ATTEMPTS = 40; // 40 attempts at 1500ms = 60s
      const POLL_INTERVAL_MS = 1500; // 1.5 seconds

      const data = query.state.data as LineItemAttachment[] | undefined;
      if (!data || data.length === 0) {
        // No attachments: reset guard and stop polling
        pollingGuardRef.current = { startAt: null, attempts: 0 };
        return false;
      }

      const needsPolling = hasAnyUnsettledAttachment(data);

      if (!needsPolling) {
        // All attachments settled: reset guard and stop polling
        pollingGuardRef.current = { startAt: null, attempts: 0 };
        return false;
      }

      // Has unsettled attachments: initialize guard if needed
      if (pollingGuardRef.current.startAt === null) {
        pollingGuardRef.current.startAt = Date.now();
        pollingGuardRef.current.attempts = 0;
      }

      // Increment attempts
      pollingGuardRef.current.attempts++;

      // Check guards
      const elapsed = Date.now() - pollingGuardRef.current.startAt;
      if (elapsed > MAX_POLL_MS || pollingGuardRef.current.attempts > MAX_ATTEMPTS) {
        // Guard tripped: stop polling silently (fail-soft)
        console.warn(
          `[LineItemAttachments] Polling guard tripped for ${filesApiPath}: ` +
          `elapsed=${elapsed}ms, attempts=${pollingGuardRef.current.attempts}`
        );
        pollingGuardRef.current = { startAt: null, attempts: 0 };
        return false;
      }

      // Continue polling
      return POLL_INTERVAL_MS;
    },
  });

  const fileCount = attachments.length;

  // Format file size for display
  const formatFileSize = (bytes: number | null | undefined): string => {
    if (!bytes) return "";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  // Get icon based on mime type
  const getFileIcon = (mimeType: string | null | undefined) => {
    if (!mimeType) return File;
    if (mimeType.startsWith("image/")) return Image;
    if (mimeType === "application/pdf") return FileText;
    return File;
  };

  const clearFileInput = () => {
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const performUpload = async (filesToUpload: File[]) => {

    // CRITICAL: Ensure line item is persisted BEFORE upload
    // This happens AFTER user selected file, so we still have valid IDs
    let targetQuoteId = quoteId;
    let targetLineItemId = lineItemId;

    // If lineItemId is missing and we have ensureLineItemId, persist now
    if (!targetLineItemId && ensureLineItemId) {
      setIsPersistingLineItem(true);
      try {
        const { quoteId: persistedQuoteId, lineItemId: persistedLineItemId } = await ensureLineItemId();
        targetQuoteId = persistedQuoteId;
        targetLineItemId = persistedLineItemId;
        // Store for subsequent uploads in same session
        ensuredIdsRef.current = { quoteId: persistedQuoteId, lineItemId: persistedLineItemId };
      } catch (error: any) {
        toast({
          title: "Cannot upload artwork",
          description: error.message || "Failed to save line item.",
          variant: "destructive",
        });
        if (fileInputRef.current) fileInputRef.current.value = "";
        setIsPersistingLineItem(false);
        return;
      } finally {
        setIsPersistingLineItem(false);
      }
    }

    // This should not happen at this point
    if (!targetLineItemId) {
      console.warn("[LineItemAttachmentsPanel] Upload attempted without lineItemId");
      toast({
        title: "Cannot upload",
        description: "Line item must be saved first.",
        variant: "destructive",
      });
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    console.log("[LineItemAttachmentsPanel] Upload IDs:", {
      propsQuoteId: quoteId,
      propsLineItemId: lineItemId,
      targetQuoteId,
      targetLineItemId,
    });

    // If we don't have a quoteId yet and ensureQuoteId is provided, create the quote first
    if (!targetQuoteId && ensureQuoteId) {
      setIsCreatingQuote(true);
      try {
        targetQuoteId = await ensureQuoteId();
        ensuredIdsRef.current.quoteId = targetQuoteId; // Store for subsequent files
      } catch (error: any) {
        toast({
          title: "Cannot Upload",
          description: error.message || "Failed to create quote. Please try again.",
          variant: "destructive",
        });
        if (fileInputRef.current) fileInputRef.current.value = "";
        setIsCreatingQuote(false);
        return;
      } finally {
        setIsCreatingQuote(false);
      }
    }

    // Build the API path with the (possibly newly created) quoteId and ensured lineItemId
    // Order line-item attachments are persisted via the order attachments endpoint so we can
    // support local_dev storage (and so DB records include storageProvider).
    const uploadApiPath = parentType === "order"
      ? (orderId ? `/api/orders/${orderId}/files` : "")
      : (targetQuoteId
          ? `/api/quotes/${targetQuoteId}/line-items/${targetLineItemId}/files`
          : `/api/line-items/${targetLineItemId}/files`);

    console.log("[LineItemAttachmentsPanel] Upload API path:", uploadApiPath);

    setIsUploading(true);
    let successCount = 0;
    let errorCount = 0;

    try {
      for (const file of filesToUpload) {
        const requestedStorageTarget: StorageTarget = file.size > SUPABASE_MAX_UPLOAD_BYTES ? "local_dev" : "supabase";

        try {
          const urlResponse = await fetch("/api/objects/upload", {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              fileName: file.name,
              fileSizeBytes: file.size,
              requestedStorageTarget,
            }),
          });

          if (!urlResponse.ok) {
            throw new Error("Failed to get upload URL");
          }

          const preflight = await urlResponse.json().catch(() => ({}));
          const decidedTarget: StorageTarget =
            (preflight?.storageTarget === "local_dev" || preflight?.storageTarget === "supabase")
              ? preflight.storageTarget
              : requestedStorageTarget;

          if (preflight?.method === "ATOMIC" || decidedTarget === "local_dev" || !preflight?.url) {
            const fileBufferBase64 = await fileToBase64(file);

            const payload: Record<string, any> = {
              originalFilename: file.name,
              fileName: file.name,
              fileSize: file.size,
              mimeType: file.type,
              fileBuffer: fileBufferBase64,
              requestedStorageTarget,
            };

            if (parentType === "order") {
              payload.orderLineItemId = targetLineItemId;
              payload.role = "other";
              payload.side = "na";
            }

            const attachResponse = await fetch(uploadApiPath, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              credentials: "include",
              body: JSON.stringify(payload),
            });

            if (!attachResponse.ok) {
              const json = await attachResponse.json().catch(() => ({}));
              throw new Error(json?.error || `Failed to attach ${file.name}`);
            }

            successCount++;
            continue;
          }

          const { url, method, path } = preflight;

          const uploadResponse = await fetch(url, {
            method: method || "PUT",
            body: file,
            headers: {
              "Content-Type": file.type || "application/octet-stream",
            },
          });

          if (!uploadResponse.ok) {
            throw new Error(`Failed to upload ${file.name}`);
          }

          const fileUrl = typeof path === "string" && path ? path : url.split("?")[0];

          const payload: Record<string, any> = {
            fileName: file.name,
            fileUrl,
            fileSize: file.size,
            mimeType: file.type,
            requestedStorageTarget,
          };

          if (parentType === "order") {
            payload.orderLineItemId = targetLineItemId;
            payload.role = "other";
            payload.side = "na";
          }

          const attachResponse = await fetch(uploadApiPath, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify(payload),
          });

          if (!attachResponse.ok) {
            throw new Error(`Failed to attach ${file.name}`);
          }

          successCount++;
        } catch (fileError: any) {
          console.error(`Error uploading ${file.name}:`, fileError);
          errorCount++;
        }
      }

      // Refresh file list (invalidate both possible paths)
      queryClient.invalidateQueries({ queryKey: [uploadApiPath] });
      if (filesApiPath && uploadApiPath !== filesApiPath) {
        queryClient.invalidateQueries({ queryKey: [filesApiPath] });
      }

      // Also invalidate both canonical list keys for this line item, since other UI (thumbnail strip)
      // may be subscribed to either the quote-scoped or line-item-scoped endpoint depending on timing.
      const lineItemScopedFilesApiPath = targetLineItemId
        ? `/api/line-items/${targetLineItemId}/files`
        : null;
      const quoteScopedFilesApiPath = targetQuoteId
        ? `/api/quotes/${targetQuoteId}/line-items/${targetLineItemId}/files`
        : null;
      if (lineItemScopedFilesApiPath) {
        queryClient.invalidateQueries({ queryKey: [lineItemScopedFilesApiPath] });
      }
      if (quoteScopedFilesApiPath) {
        queryClient.invalidateQueries({ queryKey: [quoteScopedFilesApiPath] });
      }

      if (successCount > 0) {
        toast({
          title: "Artwork Uploaded",
          description: `${successCount} file${successCount !== 1 ? "s" : ""} attached. Thumbnails generating...`,
        });

        // Auto-thumbnails are being generated in background - refresh after a short delay
        // to pick up the updated status
        setTimeout(() => {
          queryClient.invalidateQueries({ queryKey: [uploadApiPath] });
          if (filesApiPath && uploadApiPath !== filesApiPath) {
            queryClient.invalidateQueries({ queryKey: [filesApiPath] });
          }
          if (lineItemScopedFilesApiPath) {
            queryClient.invalidateQueries({ queryKey: [lineItemScopedFilesApiPath] });
          }
          if (quoteScopedFilesApiPath) {
            queryClient.invalidateQueries({ queryKey: [quoteScopedFilesApiPath] });
          }
        }, 2000);
      }

      if (errorCount > 0) {
        toast({
          title: "Some Uploads Failed",
          description: `${errorCount} file${errorCount !== 1 ? "s" : ""} failed.`,
          variant: "destructive",
        });
      }
    } catch (error: any) {
      toast({
        title: "Upload Failed",
        description: error.message || "Failed to upload files.",
        variant: "destructive",
      });
    } finally {
      setIsUploading(false);
      clearFileInput();
    }
  };

  const handleLargeFileContinue = async () => {
    setLargeFileDialogOpen(false);
    const files = pendingFiles;
    setPendingFiles(null);
    if (!files || files.length === 0) {
      clearFileInput();
      return;
    }
    await performUpload(files);
  };

  const handleLargeFileCancel = () => {
    setLargeFileDialogOpen(false);
    setPendingFiles(null);
    clearFileInput();
  };

  // Handle file upload
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return;

    const filesToUpload = Array.from(e.target.files);
    const hasOversized = filesToUpload.some((f) => f.size > SUPABASE_MAX_UPLOAD_BYTES);
    if (hasOversized) {
      setPendingFiles(filesToUpload);
      setLargeFileDialogOpen(true);
      return;
    }

    await performUpload(filesToUpload);
  };

  // Handle file deletion
  const handleDeleteFile = async (file: LineItemAttachment) => {
    if (!filesApiPath) return;

    try {
      let deleteUrl: string | null = `${filesApiPath}/${file.id}`;

      // Order line-items can contain either:
      // - DB-backed order_attachments (json.data) -> delete via /api/orders/:orderId/files/:fileId
      // - Asset pipeline links (json.assets) -> unlink via /api/orders/:orderId/line-items/:lineItemId/files/:assetId
      if (parentType === 'order') {
        if (!orderId) return;
        if (file.source === 'attachment') {
          deleteUrl = `/api/orders/${orderId}/files/${file.id}`;
        }
      }

      const response = await fetch(deleteUrl, {
        method: "DELETE",
        credentials: "include",
      });

      if (!response.ok) {
        throw new Error("Failed to delete file");
      }

      // Optimistic UI removal
      queryClient.setQueryData<LineItemAttachment[]>([filesApiPath], (prev) => {
        if (!Array.isArray(prev)) return prev as any;
        return prev.filter((x) => x.id !== file.id);
      });

      queryClient.invalidateQueries({ queryKey: [filesApiPath] });

      toast({
        title: "File Removed",
      });
    } catch (error: any) {
      toast({
        title: "Delete Failed",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  // Handle file download - downloads the ORIGINAL file via proxy endpoint
  // The proxy endpoint uses attachment.fileUrl (original storage key), not thumbKey/previewKey
  const handleDownloadFile = async (fileId: string, fileName: string) => {
    if (!filesApiPath) return;

    try {
      if (parentType === "order") {
        const file = attachments.find((f) => f.id === fileId) || null;
        
        // Construct download URL from objectPath (preferred) or fall back to other URLs
        let downloadUrl: string | null = null;
        
        if (file?.objectPath) {
          downloadUrl = `/objects/${file.objectPath}?download=1&filename=${encodeURIComponent(fileName)}`;
        } else {
          const directUrl = file?.originalUrl ?? file?.previewUrl;
          if (typeof directUrl === "string") {
            const isDirectDownloadable =
              directUrl.startsWith("/objects/") ||
              directUrl.startsWith("http://") ||
              directUrl.startsWith("https://");

            if (isDirectDownloadable) {
              // Prefer an explicit forced-download URL when possible.
              if (directUrl.startsWith("/objects/") && !/([?&]download=1)|([?&]disposition=attachment)/i.test(directUrl)) {
                try {
                  const url = new URL(directUrl, window.location.origin);
                  url.searchParams.set("download", "1");
                  if (!url.searchParams.get("filename")) {
                    url.searchParams.set("filename", fileName);
                  }
                  downloadUrl = url.toString();
                } catch {
                  downloadUrl = directUrl;
                }
              } else {
                downloadUrl = directUrl;
              }
            }
          }
        }
        
        if (downloadUrl) {
          void downloadFileFromUrl(downloadUrl, fileName);
          return;
        }

        toast({
          title: "Download unavailable",
          description: "This file does not have a downloadable URL.",
          variant: "destructive",
        });
        return;
      }

      // Quote behavior: proxy endpoint streams file with correct filename
      const proxyUrl = `${filesApiPath}/${fileId}/download/proxy`;

      void downloadFileFromUrl(proxyUrl, fileName);
    } catch (error: any) {
      console.error("[handleDownloadFile] Error:", error);
      toast({
        title: "Download Failed",
        description: error.message || "Could not download file.",
        variant: "destructive",
      });
    }
  };

  // Handle thumbnail generation (explicit user action, images only)
  const handleGenerateThumbnails = async (fileId: string, fileName: string) => {
    if (!filesApiPath) return;

    if (parentType === "order") {
      toast({
        title: "Unavailable",
        description: "Thumbnail regeneration is not available here.",
      });
      return;
    }

    try {
      const response = await fetch(`${filesApiPath}/${fileId}/generate-thumbnails`, {
        method: 'POST',
        credentials: 'include',
      });

      // Handle 202 Accepted (queued)
      if (response.status === 202) {
        toast({
          title: "Thumbnails queued",
          description: `Thumbnail generation queued for ${fileName}.`,
        });
        queryClient.invalidateQueries({ queryKey: [filesApiPath] });
        return;
      }

      if (!response.ok) {
        const json = await response.json().catch(() => ({} as any));
        throw new Error(json?.error || "Failed to generate thumbnails");
      }

      toast({
        title: "Thumbnails requested",
        description: `Thumbnail generation requested for ${fileName}.`,
      });
      queryClient.invalidateQueries({ queryKey: [filesApiPath] });
    } catch (error: any) {
      console.error("[handleGenerateThumbnails] Error:", error);
      const msg = (error?.message || "").toString();
      const isLocalMissing = isLocalPreviewUnavailableError(msg);
      toast({
        title: isLocalMissing ? "Preview unavailable" : "Thumbnail generation failed",
        description: isLocalMissing
          ? "Local dev file is not present on this machine."
          : (error?.message || "Could not generate thumbnails."),
        variant: isLocalMissing ? undefined : "destructive",
      });
    }
  };

  const handleUploadClick = async (e: React.MouseEvent) => {
    e.stopPropagation();

    // Prevent double-clicks during processing
    if (isUploading || isCreatingQuote || isPersistingLineItem) {
      return;
    }

    // ALWAYS open picker immediately (preserves browser gesture)
    // If IDs need to be ensured, we'll do it in onChange after user selects file
    fileInputRef.current?.click();
  };

  return (
    <div 
      className="border rounded-lg bg-muted/30"
      onPointerDownCapture={(e) => e.stopPropagation()}
    >
      {/* Compact header - always visible */}
      <div className="px-3 py-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Paperclip className="w-4 h-4 text-muted-foreground" />
            <span className="text-sm font-medium">Artwork</span>
            {fileCount > 0 && (
              <span className="text-xs bg-primary/10 text-primary px-1.5 py-0.5 rounded-full">
                {fileCount}
              </span>
            )}
          </div>
          {fileCount > 0 && (
            <Button 
              variant="ghost" 
              size="sm" 
              className="h-6 w-6 p-0"
              onPointerDownCapture={(e) => e.stopPropagation()}
              onClick={() => {
                const nextExpanded = !isExpanded;
                setIsExpanded(nextExpanded);
                // Track when user explicitly closes panel (not when opening)
                if (!nextExpanded) {
                  setUserClosed(true);
                }
              }}
            >
              {isExpanded ? (
                <ChevronUp className="w-4 h-4" />
              ) : (
                <ChevronDown className="w-4 h-4" />
              )}
            </Button>
          )}
        </div>

        {/* Upload button - always visible when no files, or when expanded */}
        {(fileCount === 0 || isExpanded) && (
          <div className="mt-2">
            <input
              type="file"
              ref={fileInputRef}
              className="hidden"
              multiple
              accept="image/*,.pdf,.ai,.eps,.psd,.svg"
              onChange={handleFileUpload}
              onPointerDownCapture={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-full h-8"
              onPointerDownCapture={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                handleUploadClick(e);
              }}
              disabled={isUploading || isCreatingQuote || isPersistingLineItem || (!lineItemId && !ensureLineItemId)}
            >
              {(isUploading || isCreatingQuote || isPersistingLineItem) ? (
                <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
              ) : (
                <Upload className="w-3.5 h-3.5 mr-1.5" />
              )}
              {isPersistingLineItem
                ? "Saving line item..."
                : isCreatingQuote
                ? "Creating quote..."
                : isUploading
                ? "Uploading..."
                : "Upload Artwork"}
            </Button>
            {!lineItemId && !ensureLineItemId ? (
              <p className="text-xs text-muted-foreground text-center mt-1">
                Save line item to upload artwork
              </p>
            ) : !quoteId && !ensureQuoteId ? (
              <p className="text-xs text-muted-foreground text-center mt-1">
                Save quote to upload artwork
              </p>
            ) : null}
          </div>
        )}
      </div>

      {/* Expanded content - file list */}
      {isExpanded && fileCount > 0 && (
        <div className="px-3 pb-3 space-y-2 border-t">
          {/* File list */}
          {isLoading ? (
            <p className="text-xs text-muted-foreground text-center py-2">Loading...</p>
          ) : attachments.length > 0 ? (
            <div className="space-y-1">
              {attachments.map((file) => {
                const FileIcon = getFileIcon(file.mimeType);
                const isPdf = isPdfAttachment(file);
                const isImage = file.mimeType?.startsWith("image/") ?? false;
                const isTiff =
                  /image\/tiff/i.test(file.mimeType ?? "") ||
                  /\.(tif|tiff)$/i.test(file.fileName ?? "");
                const isAi =
                  /\.(ai)$/i.test(file.fileName ?? "") ||
                  /(illustrator|postscript)/i.test(file.mimeType ?? "");
                const isPsd =
                  /\.(psd)$/i.test(file.fileName ?? "") ||
                  /(photoshop|x-photoshop)/i.test(file.mimeType ?? "");

                // Canonical thumbnail resolver. If it returns null, do NOT attempt to render a URL.
                // This prevents requesting mismatched/non-existent thumbnails (e.g. guessed thumbs/* paths).
                const thumbnailUrl = getThumbSrc(file);

                const hasAnyThumbnail = !!thumbnailUrl;
                const fileName = getAttachmentDisplayName(file);
                const pageCount = getPdfPageCount(file);
                const showPageCount = isPdf && pageCount !== null && pageCount > 1;
                
                return (
                  <div key={file.id} className="space-y-1">
                    <div 
                      className="flex items-center gap-2 p-1.5 rounded bg-background hover:bg-muted/50 transition-colors cursor-pointer"
                      onClick={(e) => {
                        // Only trigger preview if click is not on action buttons
                        const target = e.target as HTMLElement;
                        if (target.closest('button') && !target.closest('[aria-label*="Preview"]')) {
                          return; // Don't trigger if clicking action buttons
                        }
                        e.stopPropagation();
                        console.log("[PreviewClick]", file.id);
                        setPreviewFile(file);
                      }}
                      onPointerDownCapture={(e) => {
                        const target = e.target as HTMLElement;
                        if (target.closest('button') && !target.closest('[aria-label*="Preview"]')) {
                          return;
                        }
                        e.stopPropagation();
                      }}
                    >
                      {/* Thumbnail (44x44) or icon - fixed width to prevent layout jitter */}
                      <div className="h-11 w-11 shrink-0 flex items-center justify-center relative" title={fileName} aria-label={fileName}>
                        {hasAnyThumbnail && thumbnailUrl ? (
                          <>
                            <img 
                              src={thumbnailUrl} 
                              alt={fileName}
                              title={fileName}
                              className="h-11 w-11 rounded object-cover border border-border/60 pointer-events-none select-none"
                              onError={(e) => {
                                // On error, hide image and show icon fallback
                                e.currentTarget.style.display = 'none';
                                const container = e.currentTarget.parentElement;
                                if (container) {
                                  const fallback = container.querySelector('.thumbnail-fallback');
                                  if (fallback) {
                                    (fallback as HTMLElement).style.display = 'flex';
                                  }
                                }
                              }}
                            />
                            {/* Fallback icon (hidden by default, shown on image error) */}
                            <div className="thumbnail-fallback hidden absolute inset-0 items-center justify-center">
                              <FileIcon className="w-5 h-5 text-muted-foreground pointer-events-none select-none" />
                            </div>
                          </>
                        ) : (
                          <FileIcon className="w-5 h-5 text-muted-foreground pointer-events-none select-none" />
                        )}
                      </div>
                      
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs truncate block">
                            {fileName}
                          </span>
                          {file.storageProvider === "local" && (
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Badge variant="secondary" className="h-4 px-1.5 text-[10px]">
                                    Local (dev)
                                  </Badge>
                                </TooltipTrigger>
                                <TooltipContent>
                                  Stored locally on this dev machine.
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          )}
                          {showPageCount && (
                            <span className="text-[10px] px-1.5 py-0.5 bg-muted border border-border/60 rounded text-muted-foreground shrink-0">
                              Pages: {pageCount}
                            </span>
                          )}
                        </div>
                        {isPdf && pageCount !== null && (
                          <span className="text-[10px] text-muted-foreground">
                            {pageCount} {pageCount === 1 ? 'page' : 'pages'}
                            {file.pages && file.pages.length > 0 && ` • ${file.pages.length} thumbnail${file.pages.length === 1 ? '' : 's'}`}
                          </span>
                        )}
                        {file.thumbStatus && file.thumbStatus !== 'uploaded' && !isPdf && (() => {
                          const isUnavailable = file.thumbStatus === 'thumb_failed' && isThumbsUnavailableError(file.thumbError);
                          const isLocalMissing = file.thumbStatus === 'thumb_failed' && isLocalPreviewUnavailableError(file.thumbError);
                          return (
                            <span className={cn(
                              "text-[10px]",
                              file.thumbStatus === 'thumb_ready' && "text-green-600",
                              file.thumbStatus === 'thumb_pending' && "text-amber-600",
                              file.thumbStatus === 'thumb_failed' && (isUnavailable || isLocalMissing) && "text-muted-foreground",
                              file.thumbStatus === 'thumb_failed' && !isUnavailable && !isLocalMissing && "text-destructive"
                            )}
                            title={isLocalMissing ? "Preview unavailable (Local dev file not on this machine)" : undefined}>
                              {file.thumbStatus === 'thumb_ready' && '✓ Thumbs ready'}
                              {file.thumbStatus === 'thumb_pending' && '⏳ Generating...'}
                              {file.thumbStatus === 'thumb_failed' && isLocalMissing && 'Preview unavailable (Local dev file not on this machine)'}
                              {file.thumbStatus === 'thumb_failed' && isUnavailable && 'Thumbnails temporarily unavailable'}
                              {file.thumbStatus === 'thumb_failed' && !isUnavailable && !isLocalMissing && '✗ Generation failed'}
                            </span>
                          );
                        })()}
                      </div>
                      <div className="flex gap-0.5 shrink-0">
                        {(() => {
                          if (parentType === "order") return null;

                          // Skip PDFs - they have separate disabled button below
                          if (isPdf) return null;
                          
                          // Supported image types (same as server allowlist)
                          const supportedImageTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/tiff', 'image/tif'];
                          const isSupportedImage = file.mimeType && supportedImageTypes.includes(file.mimeType.toLowerCase());
                          
                          if (!isSupportedImage) return null;
                          
                          // Show button when:
                          // - No thumbUrl exists (regardless of status), OR
                          // - thumbStatus is thumb_failed (but not unavailable error)
                          const hasThumbnail = file.thumbUrl && isValidHttpUrl(file.thumbUrl);
                          const shouldShowButton = !hasThumbnail || file.thumbStatus === 'thumb_failed';
                          
                          if (!shouldShowButton) return null;
                          
                          const isUnavailableError = file.thumbStatus === 'thumb_failed' && isThumbsUnavailableError(file.thumbError);
                          const shouldDisable = !thumbnailsEnabled || isUnavailableError || file.thumbStatus === 'thumb_pending';
                          
                          if (shouldDisable) {
                            return (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-6 w-6 p-0"
                                disabled
                                title={isUnavailableError ? "Thumbnail generation temporarily unavailable" : "Thumbnails currently disabled"}
                              >
                                <Sparkles className="w-3 h-3 opacity-50" />
                              </Button>
                            );
                          }
                          
                          return (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 w-6 p-0"
                              onPointerDownCapture={(e) => e.stopPropagation()}
                              onClick={(e) => {
                                e.stopPropagation();
                                handleGenerateThumbnails(file.id, file.originalFilename || file.fileName);
                              }}
                              title="Regenerate thumbnails"
                            >
                              <Sparkles className="w-3 h-3" />
                            </Button>
                          );
                        })()}
                        {parentType !== "order" && isPdf && (!file.pages || file.pages.length === 0) && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 w-6 p-0"
                            disabled
                            title="PDF preview disabled (v2)"
                          >
                            <Sparkles className="w-3 h-3 opacity-50" />
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 w-6 p-0"
                          onPointerDownCapture={(e) => e.stopPropagation()}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDownloadFile(file.id, file.originalFilename || file.fileName);
                          }}
                          title="Download original file"
                        >
                          <Download className="w-3 h-3" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 w-6 p-0 text-destructive hover:text-destructive"
                          onPointerDownCapture={(e) => e.stopPropagation()}
                          onClick={(e) => {
                            e.stopPropagation();
                            void handleDeleteFile(file);
                          }}
                          title="Remove"
                        >
                          <X className="w-3 h-3" />
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground text-center py-2">
              No artwork attached
            </p>
          )}
        </div>
      )}

      <AttachmentViewerDialog
        attachment={previewFile as any}
        open={!!previewFile}
        onOpenChange={(open) => {
          if (!open) setPreviewFile(null);
        }}
      />

      <LargeFileLocalDevWarningDialog
        open={largeFileDialogOpen}
        onContinue={() => {
          void handleLargeFileContinue();
        }}
        onCancel={handleLargeFileCancel}
      />
    </div>
  );
}

/**
 * Compact artwork indicator badge for line item rows
 * Shows a paperclip icon with file count
 */
interface LineItemArtworkBadgeProps {
  quoteId: string | null;
  lineItemId: string;
  onClick?: () => void;
}

export function LineItemArtworkBadge({ quoteId, lineItemId, onClick }: LineItemArtworkBadgeProps) {
  // Choose correct API path based on whether a quote exists yet
  const filesApiPath = quoteId
    ? `/api/quotes/${quoteId}/line-items/${lineItemId}/files`
    : `/api/line-items/${lineItemId}/files`;

  const { data: attachments = [] } = useQuery<LineItemAttachment[]>({
    queryKey: [filesApiPath],
    queryFn: async () => {
      if (!lineItemId) return [];
      const response = await fetch(filesApiPath, { credentials: "include" });
      if (!response.ok) return [];
      const json = await response.json();
      return json.data || [];
    },
    enabled: !!lineItemId,
  });

  const fileCount = attachments.length;

  return (
    <button
      onPointerDownCapture={(e) => e.stopPropagation()}
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors",
        fileCount > 0
          ? "bg-primary/10 text-primary hover:bg-primary/20"
          : "bg-muted text-muted-foreground hover:bg-muted/80"
      )}
      title={fileCount > 0 ? `${fileCount} artwork file${fileCount !== 1 ? 's' : ''}` : "No artwork"}
    >
      <Paperclip className="w-3 h-3" />
      {fileCount > 0 && <span>{fileCount}</span>}
    </button>
  );
}
