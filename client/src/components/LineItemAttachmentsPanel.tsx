import { useState, useRef, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Paperclip, Upload, Download, X, Loader2, Image, FileText, File, ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";

// Max file size: 50MB
const MAX_SIZE_BYTES = 50 * 1024 * 1024;

type LineItemAttachment = {
  id: string;
  fileName: string;
  fileUrl: string;
  fileSize?: number | null;
  mimeType?: string | null;
  createdAt: string;
  originalFilename?: string | null;
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

          const { url, method } = await urlResponse.json();

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

          // Step 3: Extract the file URL (remove query params)
          const fileUrl = url.split("?")[0];

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

      if (successCount > 0) {
        toast({
          title: "Artwork Uploaded",
          description: `${successCount} file${successCount !== 1 ? "s" : ""} attached.`,
        });
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
    <div className="border rounded-lg bg-muted/30">
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
            />
            <Button
              variant="outline"
              size="sm"
              className="w-full h-8"
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
                return (
                  <div
                    key={file.id}
                    className="flex items-center gap-2 p-1.5 rounded bg-background hover:bg-muted/50 transition-colors"
                  >
                    <FileIcon className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                    <div className="flex-1 min-w-0">
                      <span className="text-xs truncate block">
                        {file.originalFilename || file.fileName}
                      </span>
                    </div>
                    <div className="flex gap-0.5 shrink-0">
                      {file.fileUrl && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 w-6 p-0"
                          onClick={(e) => {
                            e.stopPropagation();
                            window.open(file.fileUrl, "_blank");
                          }}
                          title="Download"
                        >
                          <Download className="w-3 h-3" />
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 w-6 p-0 text-destructive hover:text-destructive"
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
