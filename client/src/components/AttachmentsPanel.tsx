import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Paperclip, Upload, Download, X, Loader2, FileText, Image, File } from "lucide-react";

// Max file size: 50MB
const MAX_SIZE_BYTES = 50 * 1024 * 1024;

type Attachment = {
  id: string;
  fileName: string;
  fileUrl: string;
  fileSize?: number | null;
  mimeType?: string | null;
  createdAt: string;
  originalFilename?: string | null;
};

interface AttachmentsPanelProps {
  /** The type of resource this panel is attached to */
  ownerType: "quote" | "order";
  /** The ID of the resource (quote.id or order.id) - undefined means not yet saved */
  ownerId: string | undefined;
  /** Optional title override */
  title?: string;
  /** Max file size in bytes (default 50MB) */
  maxSizeBytes?: number;
  /** Whether to show a compact layout */
  compact?: boolean;
}

export function AttachmentsPanel({
  ownerType,
  ownerId,
  title = "Attachments",
  maxSizeBytes = MAX_SIZE_BYTES,
  compact = false,
}: AttachmentsPanelProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);

  // Build API paths based on owner type
  const filesApiPath = ownerType === "quote" 
    ? `/api/quotes/${ownerId}/files`
    : `/api/orders/${ownerId}/files`;

  // Fetch attachments
  const { data: attachments = [], isLoading } = useQuery<Attachment[]>({
    queryKey: [filesApiPath],
    queryFn: async () => {
      if (!ownerId) return [];
      const response = await fetch(filesApiPath, { credentials: "include" });
      if (!response.ok) throw new Error(`Failed to load ${ownerType} files`);
      const json = await response.json();
      return json.data || [];
    },
    enabled: !!ownerId,
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

    // Guard: must have an ID to attach files
    if (!ownerId) {
      toast({
        title: `Save ${ownerType === "quote" ? "Quote" : "Order"} First`,
        description: `Please save the ${ownerType} before attaching files.`,
        variant: "destructive",
      });
      return;
    }

    const filesToUpload = Array.from(e.target.files);

    // Check file sizes
    const oversizedFiles = filesToUpload.filter(f => f.size > maxSizeBytes);
    if (oversizedFiles.length > 0) {
      toast({
        title: "File Too Large",
        description: `Files larger than ${Math.round(maxSizeBytes / (1024 * 1024))}MB cannot be uploaded. Please use WeTransfer or another file sharing service for large files.`,
        variant: "destructive",
      });
      // Filter out oversized files and continue with valid ones
      const validFiles = filesToUpload.filter(f => f.size <= maxSizeBytes);
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
        // Skip oversized files
        if (file.size > maxSizeBytes) continue;

        try {
          // Step 1: Get signed upload URL from backend
          const urlResponse = await fetch("/api/objects/upload", {
            method: "POST",
            credentials: "include",
          });

          if (!urlResponse.ok) {
            const errorData = await urlResponse.json().catch(() => ({}));
            console.error("Failed to get upload URL:", errorData);
            throw new Error(errorData.message || "Failed to get upload URL");
          }

          const { url, method, path, token } = await urlResponse.json();

          // Step 2: Upload file to storage (Supabase or GCS)
          const uploadResponse = await fetch(url, {
            method: method || "PUT",
            body: file,
            headers: {
              "Content-Type": file.type || "application/octet-stream",
            },
          });

          if (!uploadResponse.ok) {
            console.error("Upload failed:", uploadResponse.status, uploadResponse.statusText);
            throw new Error(`Failed to upload ${file.name}`);
          }

          // Step 3: Extract the file URL (remove query params from signed URL)
          const fileUrl = url.split("?")[0];

          // Step 4: Attach file metadata to the resource
          const attachPayload: Record<string, any> = {
            fileName: file.name,
            fileUrl,
            fileSize: file.size,
            mimeType: file.type,
          };

          // For orders, add optional metadata
          if (ownerType === "order") {
            attachPayload.role = "other";
            attachPayload.side = "na";
          }

          const attachResponse = await fetch(filesApiPath, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify(attachPayload),
          });

          if (!attachResponse.ok) {
            const errorData = await attachResponse.json().catch(() => ({}));
            console.error("Failed to attach file:", errorData);
            throw new Error(errorData.error || `Failed to attach ${file.name}`);
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
          title: "Files Uploaded",
          description: `${successCount} file${successCount !== 1 ? "s" : ""} uploaded successfully.`,
        });
      }

      if (errorCount > 0) {
        toast({
          title: "Some Uploads Failed",
          description: `${errorCount} file${errorCount !== 1 ? "s" : ""} failed to upload.`,
          variant: "destructive",
        });
      }
    } catch (error: any) {
      console.error("Upload error:", error);
      toast({
        title: "Upload Failed",
        description: error.message || "Failed to upload files. Please try again.",
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
    if (!ownerId) return;

    try {
      const response = await fetch(`${filesApiPath}/${fileId}`, {
        method: "DELETE",
        credentials: "include",
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || "Failed to delete file");
      }

      queryClient.invalidateQueries({ queryKey: [filesApiPath] });

      toast({
        title: "File Removed",
        description: "The file has been removed.",
      });
    } catch (error: any) {
      toast({
        title: "Delete Failed",
        description: error.message || "Failed to delete file.",
        variant: "destructive",
      });
    }
  };

  // If no ownerId, show disabled state
  const isDisabled = !ownerId;

  return (
    <Card className={compact ? "rounded-xl bg-card/80 border-border/60 shadow-md" : ""}>
      <CardHeader className={compact ? "pb-2 px-5 pt-4" : ""}>
        <CardTitle className={compact ? "text-sm font-medium flex items-center gap-2" : "flex items-center gap-2"}>
          <Paperclip className={compact ? "w-4 h-4" : "w-5 h-5"} />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className={compact ? "space-y-3 px-5 pb-4" : "space-y-4"}>
        {/* Upload button */}
        <div>
          <input
            type="file"
            ref={fileInputRef}
            className="hidden"
            multiple
            accept="image/*,.pdf,.ai,.eps,.psd,.svg,.doc,.docx,.xls,.xlsx"
            onChange={handleFileUpload}
            disabled={isDisabled}
          />
          <Button
            variant="outline"
            className="w-full"
            onClick={() => fileInputRef.current?.click()}
            disabled={isDisabled || isUploading}
          >
            {isUploading ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <Upload className="w-4 h-4 mr-2" />
            )}
            {isUploading ? "Uploading..." : "Upload Files"}
          </Button>
          {isDisabled && (
            <p className="text-xs text-muted-foreground text-center mt-2">
              Save the {ownerType} first to attach files.
            </p>
          )}
        </div>

        {/* File list */}
        {isLoading ? (
          <p className="text-sm text-muted-foreground text-center py-4">Loading files...</p>
        ) : attachments.length > 0 ? (
          <div className="space-y-2">
            {attachments.map((file) => {
              const FileIcon = getFileIcon(file.mimeType);
              return (
                <div
                  key={file.id}
                  className="flex items-center gap-2 p-2 rounded-md bg-muted/50 hover:bg-muted transition-colors"
                >
                  <FileIcon className="w-4 h-4 text-muted-foreground shrink-0" />
                  <div className="flex-1 min-w-0">
                    <span className="text-sm truncate block">
                      {file.originalFilename || file.fileName}
                    </span>
                    {file.fileSize && (
                      <span className="text-xs text-muted-foreground">
                        {formatFileSize(file.fileSize)}
                      </span>
                    )}
                  </div>
                  <div className="flex gap-1 shrink-0">
                    {file.fileUrl && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0"
                        onClick={() => window.open(file.fileUrl, "_blank")}
                        title="Download"
                      >
                        <Download className="w-3.5 h-3.5" />
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                      onClick={() => handleDeleteFile(file.id)}
                      title="Remove"
                    >
                      <X className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground text-center py-4">
            No files attached yet
          </p>
        )}
      </CardContent>
    </Card>
  );
}
