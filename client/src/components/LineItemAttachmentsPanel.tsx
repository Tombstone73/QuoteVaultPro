import { useState, useRef, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Paperclip, Upload, Download, X, Loader2, Image, FileText, File, ChevronDown, ChevronUp, Sparkles } from "lucide-react";
import { cn, isValidHttpUrl } from "@/lib/utils";
import { getAttachmentDisplayName, isPdfAttachment, getPdfPageCount } from "@/lib/attachments";
import { AttachmentPreviewMeta } from "@/components/AttachmentPreviewMeta";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";

// Max file size: 50MB
const MAX_SIZE_BYTES = 50 * 1024 * 1024;

// Helper: Check if error message indicates thumbnail generation is unavailable (not failed)
function isThumbsUnavailableError(msg: string | null | undefined): boolean {
  if (!msg) return false;
  const lowerMsg = msg.toLowerCase();
  return lowerMsg.includes('temporarily unavailable') ||
         lowerMsg.includes('dependencies not installed') ||
         lowerMsg.includes('sharp unavailable');
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
  fileName: string;
  fileUrl: string;
  fileSize?: number | null;
  mimeType?: string | null;
  createdAt: string;
  originalFilename?: string | null;
  // Thumbnail scaffolding fields (migration 0034)
  thumbStatus?: 'uploaded' | 'thumb_pending' | 'thumb_ready' | 'thumb_failed';
  thumbKey?: string | null;
  previewKey?: string | null;
  thumbError?: string | null;
  // Server-generated signed URLs (added for proper image rendering)
  originalUrl?: string | null;
  thumbUrl?: string | null;
  previewUrl?: string | null;
  // PDF multi-page support
  pageCount?: number | null;
  pages?: AttachmentPage[];
};

interface LineItemAttachmentsPanelProps {
  /** The quote ID (may be null for temporary line items) */
  quoteId: string | null;
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
}

export function LineItemAttachmentsPanel({
  quoteId,
  lineItemId,
  productName,
  defaultExpanded = false,
  ensureQuoteId,
  ensureLineItemId,
}: LineItemAttachmentsPanelProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  const [isCreatingQuote, setIsCreatingQuote] = useState(false);
  const [isPersistingLineItem, setIsPersistingLineItem] = useState(false);
  const [pendingOpenPicker, setPendingOpenPicker] = useState(false);
  const [previewFile, setPreviewFile] = useState<LineItemAttachment | null>(null);
  // Store ensured IDs to use during upload (props may not have updated yet)
  const ensuredIdsRef = useRef<{ quoteId: string | null; lineItemId: string | null }>({
    quoteId: null,
    lineItemId: null,
  });

  // Effect: Auto-open file picker after line item persistence completes.
  // This ensures single-click UX: user clicks Upload → persistence happens → picker opens automatically.
  useEffect(() => {
    if (pendingOpenPicker && lineItemId && !isPersistingLineItem) {
      // Use requestAnimationFrame to ensure the DOM is stable after state updates
      requestAnimationFrame(() => {
        fileInputRef.current?.click();
        setPendingOpenPicker(false);
      });
    }
  }, [pendingOpenPicker, lineItemId, isPersistingLineItem]);

  // Build API path for this line item's files. For temporary line items
  // we still have a concrete lineItemId, so the quoteId may be null.
  // SAFETY: Do not construct path with undefined lineItemId.
  const filesApiPath = lineItemId
    ? (quoteId
        ? `/api/quotes/${quoteId}/line-items/${lineItemId}/files`
        : `/api/line-items/${lineItemId}/files`)
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
  const { data: attachments = [], isLoading } = useQuery<LineItemAttachment[]>({
    queryKey: filesApiPath ? [filesApiPath] : ["disabled-attachments"],
    queryFn: async () => {
      if (!filesApiPath) return [];
      const response = await fetch(filesApiPath, { credentials: "include" });
      if (!response.ok) throw new Error("Failed to load line item files");
      const json = await response.json();
      return json.data || [];
    },
    enabled: !!filesApiPath,
  });

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

  // Handle file upload
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return;

    // This should not happen since the upload button is hidden when lineItemId is undefined
    if (!lineItemId) {
      console.warn("[LineItemAttachmentsPanel] Upload attempted without lineItemId");
      return;
    }

    const filesToUpload = Array.from(e.target.files);

    // Check file sizes
    const oversizedFiles = filesToUpload.filter(f => f.size > MAX_SIZE_BYTES);
    if (oversizedFiles.length > 0) {
      toast({
        title: "File Too Large",
        description: "Files larger than 50MB cannot be uploaded.",
        variant: "destructive",
      });
      const validFiles = filesToUpload.filter(f => f.size <= MAX_SIZE_BYTES);
      if (validFiles.length === 0) {
        if (fileInputRef.current) fileInputRef.current.value = "";
        return;
      }
    }

    // Use ensured IDs from ref if available (from ensureLineItemId call), otherwise use props
    let targetQuoteId = ensuredIdsRef.current.quoteId || quoteId;
    let targetLineItemId = ensuredIdsRef.current.lineItemId || lineItemId;

    console.log("[LineItemAttachmentsPanel] Upload IDs:", {
      propsQuoteId: quoteId,
      propsLineItemId: lineItemId,
      ensuredQuoteId: ensuredIdsRef.current.quoteId,
      ensuredLineItemId: ensuredIdsRef.current.lineItemId,
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
    const uploadApiPath = targetQuoteId
      ? `/api/quotes/${targetQuoteId}/line-items/${targetLineItemId}/files`
      : `/api/line-items/${targetLineItemId}/files`;

    console.log("[LineItemAttachmentsPanel] Upload API path:", uploadApiPath);

    setIsUploading(true);
    let successCount = 0;
    let errorCount = 0;

    try {
      for (const file of filesToUpload) {
        if (file.size > MAX_SIZE_BYTES) continue;

        try {
          // Step 1: Get signed upload URL from backend
          const urlResponse = await fetch("/api/objects/upload", {
            method: "POST",
            credentials: "include",
          });

          if (!urlResponse.ok) {
            throw new Error("Failed to get upload URL");
          }

          const { url, method, path } = await urlResponse.json();

          // Step 2: Upload file to storage
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

          // Step 3: Use the storage path (not the full signed URL)
          // The path is the actual object key in the bucket (e.g., "uploads/abc-123")
          const fileUrl = path || url.split("?")[0];

          // Step 4: Attach file to line item
          const attachResponse = await fetch(uploadApiPath, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({
              fileName: file.name,
              fileUrl,
              fileSize: file.size,
              mimeType: file.type,
            }),
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
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  // Handle file deletion
  const handleDeleteFile = async (fileId: string) => {
    if (!filesApiPath) return;

    try {
      const response = await fetch(`${filesApiPath}/${fileId}`, {
        method: "DELETE",
        credentials: "include",
      });

      if (!response.ok) {
        throw new Error("Failed to delete file");
      }

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
      // Use proxy endpoint which streams the original file (fileUrl) from storage
      // Server-side: uses attachment.fileUrl to fetch original, sets correct Content-Disposition
      const proxyUrl = `${filesApiPath}/${fileId}/download/proxy`;
      
      // Create temporary anchor element with download attribute to force filename
      const anchor = document.createElement("a");
      anchor.href = proxyUrl;
      anchor.download = fileName; // This forces the browser to use the original filename
      anchor.rel = "noreferrer";
      anchor.style.display = "none";
      
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
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

    try {
      const response = await fetch(`${filesApiPath}/${fileId}/generate-thumbnails`, {
        method: 'POST',
        credentials: 'include',
      });

      // Handle 202 Accepted (queued)
      if (response.status === 202) {
        const data = await response.json().catch(() => ({}));
        toast({
          title: "Queued",
          description: data.message || "Thumbnail generation queued",
        });
        
        // Poll for thumbnail completion: refetch every 1s up to 10s OR until thumbUrl appears
        let pollCount = 0;
        const maxPolls = 10;
        const pollInterval = 1000; // 1 second
        
        const pollForThumbnail = async () => {
          pollCount++;
          
          // Refetch attachments and wait for result
          await queryClient.refetchQueries({ queryKey: [filesApiPath] });
          
          // Get current attachment data after refetch
          const queryData = queryClient.getQueryData<LineItemAttachment[]>([filesApiPath]);
          const attachment = queryData?.find(a => a.id === fileId);
          
          // Check if thumbnail is ready (thumbUrl exists and is valid, or thumbKey exists)
          const hasThumbnail = attachment && (
            (attachment.thumbUrl && isValidHttpUrl(attachment.thumbUrl)) ||
            (attachment.thumbKey && attachment.thumbKey.length > 0)
          );
          
          if (hasThumbnail) {
            // Thumbnail is ready - stop polling
            toast({
              title: "Thumbnails ready",
              description: `Thumbnails created for ${fileName}`,
            });
            return;
          }
          
          // Continue polling if not ready and not exceeded max polls
          if (pollCount < maxPolls) {
            setTimeout(pollForThumbnail, pollInterval);
          } else {
            // Timeout - show message
            toast({
              title: "Queued",
              description: "Queued; refresh in a few seconds",
            });
          }
        };
        
        // Start polling after initial delay
        setTimeout(pollForThumbnail, pollInterval);
        return;
      }

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: response.statusText }));
        const error = new Error(errorData.error || errorData.message || 'Failed to generate thumbnails') as any;
        error.response = response; // Attach response for status checking
        error.data = errorData; // Attach full error data for code checking
        throw error;
      }

      // Invalidate queries to refresh the attachment list with updated status
      queryClient.invalidateQueries({ queryKey: [filesApiPath] });

      toast({
        title: "Thumbnails Generated",
        description: `Thumbnails created for ${fileName}`,
      });
    } catch (error: any) {
      console.error("[handleGenerateThumbnails] Error:", error);
      
      // Check if this is an "unavailable" error (503, 501 for PDF, THUMBNAILS_UNAVAILABLE code, or message-based detection)
      const isUnavailableError = error.response?.status === 503 || 
                                  error.response?.status === 501 ||
                                  error.data?.code === 'THUMBNAILS_UNAVAILABLE' ||
                                  isThumbsUnavailableError(error.message) ||
                                  isThumbsUnavailableError(error.data?.message);
      
      if (isUnavailableError) {
        // Show neutral message for unavailable (not a failure)
        toast({
          title: "Thumbnail Generation Unavailable",
          description: error.data?.message || error.message || "Thumbnail generation is currently unavailable.",
        });
      } else {
        // Show error message for actual failures
        toast({
          title: "Generation Failed",
          description: error.message || error.data?.message || "Could not generate thumbnails.",
          variant: "destructive",
        });
      }
    }
  };

  // Handle PDF thumbnail generation (explicit user action, PDFs only)
  const handleGeneratePdfThumbnails = async (fileId: string, fileName: string) => {
    if (!filesApiPath) return;

    try {
      const response = await fetch(`${filesApiPath}/${fileId}/generate-pdf-thumbnails`, {
        method: 'POST',
        credentials: 'include',
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: response.statusText }));
        throw new Error(errorData.error || 'Failed to generate PDF thumbnails');
      }

      const result = await response.json();

      // Invalidate queries to refresh the attachment list with updated pages
      queryClient.invalidateQueries({ queryKey: [filesApiPath] });

      toast({
        title: "PDF Thumbnails Generated",
        description: `Generated ${result.data.pagesGenerated} page thumbnail${result.data.pagesGenerated === 1 ? '' : 's'} for ${fileName}`,
      });
    } catch (error: any) {
      console.error("[handleGeneratePdfThumbnails] Error:", error);
      toast({
        title: "PDF Generation Failed",
        description: error.message || "Could not generate PDF thumbnails.",
        variant: "destructive",
      });
    }
  };

  const fileCount = attachments.length;

  // TitanOS UX RULE: Always render shell, even if actions are disabled.
  // This ensures visibility of state and clear messaging to the user.
  const canUpload = !!lineItemId && (!!quoteId || !!ensureQuoteId);

  /**
   * Handle upload button click - ensure line item is persisted BEFORE opening file picker.
   * Single-click flow: persist → auto-open picker via useEffect.
   */
  const handleUploadClick = async (e: React.MouseEvent) => {
    e.stopPropagation();

    // Prevent double-clicks during processing
    if (isUploading || isCreatingQuote || isPersistingLineItem) {
      return;
    }

    // If lineItemId already exists, open picker immediately
    if (lineItemId) {
      // Store current IDs for use during upload (in case of quote creation during upload)
      ensuredIdsRef.current = { quoteId, lineItemId };
      fileInputRef.current?.click();
      return;
    }

    // If lineItemId is missing and we have ensureLineItemId, persist the line item first
    if (ensureLineItemId) {
      setPendingOpenPicker(true); // Signal that we want to open picker after persistence
      setIsPersistingLineItem(true);
      try {
        const { quoteId: persistedQuoteId, lineItemId: persistedLineItemId } = await ensureLineItemId();
        // Store the ensured IDs for use during upload (props may not have updated yet)
        ensuredIdsRef.current = { 
          quoteId: persistedQuoteId,
          lineItemId: persistedLineItemId 
        };
        // Don't open picker here - the useEffect will do it once lineItemId updates
      } catch (error: any) {
        setPendingOpenPicker(false); // Cancel pending open on error
        ensuredIdsRef.current = { quoteId: null, lineItemId: null }; // Clear on error
        toast({
          title: "Cannot upload artwork",
          description: error.message || "Failed to save line item.",
          variant: "destructive",
        });
      } finally {
        setIsPersistingLineItem(false);
      }
      return;
    }

    // Fallback: no way to persist, should not happen with proper prop wiring
    toast({
      title: "Cannot upload",
      description: "Line item must be saved first.",
      variant: "destructive",
    });
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
              onClick={() => setIsExpanded(!isExpanded)}
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
              variant="outline"
              size="sm"
              className="w-full h-8"
              onPointerDownCapture={(e) => e.stopPropagation()}
              onClick={handleUploadClick}
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

                const isRenderableImageUrl = (url: string | null): url is string => {
                  if (typeof url !== "string" || !isValidHttpUrl(url)) return false;
                  const urlWithoutQuery = url.split("?")[0]?.split("#")[0] ?? "";
                  return /\.(png|jpe?g|webp|gif)$/i.test(urlWithoutQuery);
                };

                const originalUrl = file.originalUrl ?? (file as any).originalURL ?? (file as any).url ?? null;
                const previewUrl = file.previewUrl ?? null;
                const thumbUrl = file.thumbUrl ?? null;
                const pdfThumbUrl = file.pages?.[0]?.thumbUrl ?? thumbUrl ?? null;

                const imagePreviewUrl =
                  (typeof previewUrl === "string" && isValidHttpUrl(previewUrl) ? previewUrl : null) ??
                  (typeof originalUrl === "string" && isValidHttpUrl(originalUrl) ? originalUrl : null);

                const tiffPreviewUrl =
                  (isRenderableImageUrl(previewUrl) ? previewUrl : null) ??
                  (isRenderableImageUrl(thumbUrl) ? thumbUrl : null);

                const aiPsdPreviewUrl =
                  (isRenderableImageUrl(previewUrl) ? previewUrl : null) ??
                  (isRenderableImageUrl(thumbUrl) ? thumbUrl : null);

                const pdfPreviewThumbUrl =
                  typeof pdfThumbUrl === "string" && isValidHttpUrl(pdfThumbUrl) ? pdfThumbUrl : null;

                const thumbnailUrl = isPdf
                  ? pdfPreviewThumbUrl
                  : isTiff
                  ? tiffPreviewUrl
                  : isAi || isPsd
                  ? aiPsdPreviewUrl
                  : isImage
                  ? imagePreviewUrl
                  : null;

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
                          return (
                            <span className={cn(
                              "text-[10px]",
                              file.thumbStatus === 'thumb_ready' && "text-green-600",
                              file.thumbStatus === 'thumb_pending' && "text-amber-600",
                              file.thumbStatus === 'thumb_failed' && !isUnavailable && "text-destructive",
                              file.thumbStatus === 'thumb_failed' && isUnavailable && "text-muted-foreground"
                            )}>
                              {file.thumbStatus === 'thumb_ready' && '✓ Thumbs ready'}
                              {file.thumbStatus === 'thumb_pending' && '⏳ Generating...'}
                              {file.thumbStatus === 'thumb_failed' && !isUnavailable && '✗ Generation failed'}
                              {file.thumbStatus === 'thumb_failed' && isUnavailable && 'Thumbnails temporarily unavailable'}
                            </span>
                          );
                        })()}
                      </div>
                      <div className="flex gap-0.5 shrink-0">
                        {(() => {
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
                        {isPdf && (!file.pages || file.pages.length === 0) && (
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
                            handleDeleteFile(file.id);
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

      {/* Preview Modal */}
      {(() => {
        console.log("[PreviewDialogOpen]", !!previewFile, previewFile?.originalFilename || previewFile?.fileName);
        return (
          <Dialog open={!!previewFile} onOpenChange={(open) => { if (!open) setPreviewFile(null); }}>
            <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>
                  {previewFile ? getAttachmentDisplayName(previewFile) : ""}
                </DialogTitle>
                <DialogDescription>
                  <div className="space-y-1">
                    {previewFile?.mimeType ? (
                      <div>
                        <span>File type: </span>
                        <span>{previewFile.mimeType}</span>
                      </div>
                    ) : (
                      <div>Preview attachment</div>
                    )}
                    <AttachmentPreviewMeta attachment={previewFile} />
                  </div>
                </DialogDescription>
              </DialogHeader>
              {previewFile && (() => {
                const isPdf = isPdfAttachment(previewFile);
                const isImage = previewFile.mimeType?.startsWith("image/") ?? false;
                const isTiff =
                  /image\/tiff/i.test(previewFile.mimeType ?? "") ||
                  /\.(tif|tiff)$/i.test(previewFile.fileName ?? "");
                const isAi =
                  /\.(ai)$/i.test(previewFile.fileName ?? "") ||
                  /(illustrator|postscript)/i.test(previewFile.mimeType ?? "");
                const isPsd =
                  /\.(psd)$/i.test(previewFile.fileName ?? "") ||
                  /(photoshop|x-photoshop)/i.test(previewFile.mimeType ?? "");

                const isRenderableImageUrl = (url: string | null): url is string => {
                  if (typeof url !== "string" || !isValidHttpUrl(url)) return false;
                  const urlWithoutQuery = url.split("?")[0]?.split("#")[0] ?? "";
                  return /\.(png|jpe?g|webp|gif)$/i.test(urlWithoutQuery);
                };

                const originalUrl =
                  previewFile.originalUrl ?? (previewFile as any).originalURL ?? (previewFile as any).url ?? null;
                const previewUrl = previewFile.previewUrl ?? null;

                const imagePreviewUrl =
                  (typeof previewUrl === "string" && isValidHttpUrl(previewUrl) ? previewUrl : null) ??
                  (typeof originalUrl === "string" && isValidHttpUrl(originalUrl) ? originalUrl : null);

                const tiffPreviewUrl =
                  (isRenderableImageUrl(previewUrl) ? previewUrl : null) ??
                  (isRenderableImageUrl(previewFile.thumbUrl ?? null) ? (previewFile.thumbUrl as string) : null);

                const aiPsdPreviewUrl =
                  (isRenderableImageUrl(previewUrl) ? previewUrl : null) ??
                  (isRenderableImageUrl(previewFile.thumbUrl ?? null) ? (previewFile.thumbUrl as string) : null);

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
                  previewFile.pages?.[0]?.thumbUrl ??
                  previewFile.thumbUrl ??
                  null;
                const hasPdfThumb = isPdf && typeof pdfThumbUrl === "string" && isValidHttpUrl(pdfThumbUrl);
                const hasValidOriginal = typeof originalUrl === "string" && isValidHttpUrl(originalUrl);
                const fileName = getAttachmentDisplayName(previewFile);
                
                return (
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
                        // PDF handling - no preview rendering, show button to open in new tab
                        <div className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground">
                          <FileText className="w-16 h-16 mb-4 opacity-50" />
                          <p className="text-sm mb-4">PDF preview not available</p>
                          {hasValidOriginal && (
                            <div className="flex flex-col items-center gap-1">
                              <Button
                                onClick={() => {
                                  if (filesApiPath) {
                                    handleDownloadFile(previewFile.id, fileName);
                                  }
                                }}
                                variant="outline"
                              >
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
                        {previewFile.mimeType && (
                          <div>
                            <span className="font-medium">Type: </span>
                            <span className="text-muted-foreground">{previewFile.mimeType}</span>
                          </div>
                        )}
                      </div>
                      
                      {hasValidOriginal && (
                        <div className="flex flex-col items-end gap-1">
                          <Button
                            onClick={() => {
                              if (filesApiPath) {
                                handleDownloadFile(previewFile.id, fileName);
                                return;
                              }
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
                            }}
                            variant="outline"
                          >
                            <Download className="w-4 h-4 mr-2" />
                            Download original
                          </Button>
                          <span className="text-xs text-muted-foreground">Downloads original file</span>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })()}
            </DialogContent>
          </Dialog>
        );
      })()}
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
