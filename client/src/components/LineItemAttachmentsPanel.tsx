import { useState, useRef } from "react";
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
  /** The quote ID */
  quoteId: string;
  /** The line item ID - undefined means line item not saved yet */
  lineItemId: string | undefined;
  /** Product name for display */
  productName?: string;
  /** Whether the panel is expanded by default */
  defaultExpanded?: boolean;
}

export function LineItemAttachmentsPanel({
  quoteId,
  lineItemId,
  productName,
  defaultExpanded = false,
}: LineItemAttachmentsPanelProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);

  // Build API path for this line item's files
  const filesApiPath = `/api/quotes/${quoteId}/line-items/${lineItemId}/files`;

  // Fetch attachments for this line item
  const { data: attachments = [], isLoading } = useQuery<LineItemAttachment[]>({
    queryKey: [filesApiPath],
    queryFn: async () => {
      if (!lineItemId) return [];
      const response = await fetch(filesApiPath, { credentials: "include" });
      if (!response.ok) throw new Error("Failed to load line item files");
      const json = await response.json();
      return json.data || [];
    },
    enabled: !!lineItemId,
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

    if (!lineItemId) {
      toast({
        title: "Save Line Item First",
        description: "Add this item to the quote before attaching artwork.",
        variant: "destructive",
      });
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
          const attachResponse = await fetch(filesApiPath, {
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

      // Refresh file list
      queryClient.invalidateQueries({ queryKey: [filesApiPath] });

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
    if (!lineItemId) return;

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

  const isDisabled = !lineItemId;
  const fileCount = attachments.length;

  return (
    <div className="border rounded-lg bg-muted/30">
      {/* Compact header - always visible */}
      <div 
        className="flex items-center justify-between px-3 py-2 cursor-pointer hover:bg-muted/50 transition-colors"
        onClick={() => !isDisabled && setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center gap-2">
          <Paperclip className="w-4 h-4 text-muted-foreground" />
          <span className="text-sm font-medium">Artwork</span>
          {fileCount > 0 && (
            <span className="text-xs bg-primary/10 text-primary px-1.5 py-0.5 rounded-full">
              {fileCount}
            </span>
          )}
        </div>
        {!isDisabled && (
          <Button variant="ghost" size="sm" className="h-6 w-6 p-0">
            {isExpanded ? (
              <ChevronUp className="w-4 h-4" />
            ) : (
              <ChevronDown className="w-4 h-4" />
            )}
          </Button>
        )}
      </div>

      {/* Expanded content */}
      {isExpanded && !isDisabled && (
        <div className="px-3 pb-3 space-y-2 border-t">
          {/* Upload button */}
          <div className="pt-2">
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
              onClick={(e) => {
                e.stopPropagation();
                fileInputRef.current?.click();
              }}
              disabled={isUploading}
            >
              {isUploading ? (
                <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
              ) : (
                <Upload className="w-3.5 h-3.5 mr-1.5" />
              )}
              {isUploading ? "Uploading..." : "Upload Artwork"}
            </Button>
          </div>

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

      {/* Disabled state message */}
      {isDisabled && (
        <div className="px-3 pb-2">
          <p className="text-xs text-muted-foreground">
            Add this item first to attach artwork.
          </p>
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
  quoteId: string;
  lineItemId: string | undefined;
  onClick?: () => void;
}

export function LineItemArtworkBadge({ quoteId, lineItemId, onClick }: LineItemArtworkBadgeProps) {
  const filesApiPath = `/api/quotes/${quoteId}/line-items/${lineItemId}/files`;

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
