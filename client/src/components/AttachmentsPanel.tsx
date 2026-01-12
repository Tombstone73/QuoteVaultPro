import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import { Paperclip, Upload, Download, X, Loader2, FileText, Image, File } from "lucide-react";
import { isValidHttpUrl } from "@/lib/utils";
import { SUPABASE_MAX_UPLOAD_BYTES, formatBytes } from "@/lib/config/storage";
import { fileToBase64 } from "@/lib/uploads/fileToBase64";
import { LargeFileLocalDevWarningDialog } from "@/components/LargeFileLocalDevWarningDialog";

type StorageTarget = "supabase" | "local_dev";

type Attachment = {
  id: string;
  fileName: string;
  fileUrl: string; // Storage key - DO NOT use directly in UI
  fileSize?: number | null;
  mimeType?: string | null;
  createdAt: string;
  originalFilename?: string | null;
  storageProvider?: string | null;
  // Signed URLs from server (use these for display/download)
  originalUrl?: string | null;
  thumbUrl?: string | null;
  previewUrl?: string | null;
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
  maxSizeBytes = Number.POSITIVE_INFINITY,
  compact = false,
}: AttachmentsPanelProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<File[] | null>(null);
  const [largeFileDialogOpen, setLargeFileDialogOpen] = useState(false);

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

  const clearFileInput = () => {
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const uploadFiles = async (filesToUpload: File[]) => {
    // Guard: must have an ID to attach files
    if (!ownerId) {
      toast({
        title: `Save ${ownerType === "quote" ? "Quote" : "Order"} First`,
        description: `Please save the ${ownerType} before attaching files.`,
        variant: "destructive",
      });
      return;
    }

    setIsUploading(true);
    let successCount = 0;
    let errorCount = 0;

    try {
      for (const file of filesToUpload) {
        if (file.size > maxSizeBytes) {
          toast({
            title: "File Too Large",
            description: `This file exceeds the maximum allowed size (${formatBytes(maxSizeBytes)}).`,
            variant: "destructive",
          });
          errorCount++;
          continue;
        }

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
            const errorData = await urlResponse.json().catch(() => ({}));
            throw new Error(errorData.message || "Failed to get upload URL");
          }

          const preflight = await urlResponse.json().catch(() => ({}));
          const decidedTarget: StorageTarget =
            (preflight?.storageTarget === "local_dev" || preflight?.storageTarget === "supabase")
              ? preflight.storageTarget
              : requestedStorageTarget;

          if (preflight?.method === "ATOMIC" || decidedTarget === "local_dev" || !preflight?.url) {
            const fileBufferBase64 = await fileToBase64(file);

            const attachPayload: Record<string, any> = {
              originalFilename: file.name,
              fileName: file.name,
              fileSize: file.size,
              mimeType: file.type,
              fileBuffer: fileBufferBase64,
              requestedStorageTarget,
            };

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
              throw new Error(errorData.error || `Failed to attach ${file.name}`);
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

          const attachPayload: Record<string, any> = {
            fileName: file.name,
            fileUrl,
            fileSize: file.size,
            mimeType: file.type,
            requestedStorageTarget,
          };

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
            throw new Error(errorData.error || `Failed to attach ${file.name}`);
          }

          successCount++;
        } catch (fileError: any) {
          console.error(`Error uploading ${file.name}:`, fileError);
          errorCount++;
        }
      }

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
      clearFileInput();
    }
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

    const hasOversized = filesToUpload.some((f) => f.size > SUPABASE_MAX_UPLOAD_BYTES);
    if (hasOversized) {
      setPendingFiles(filesToUpload);
      setLargeFileDialogOpen(true);
      return;
    }

    await uploadFiles(filesToUpload);
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
      <LargeFileLocalDevWarningDialog
        open={largeFileDialogOpen}
        onCancel={() => {
          setLargeFileDialogOpen(false);
          setPendingFiles(null);
          clearFileInput();
        }}
        onContinue={async () => {
          const files = pendingFiles || [];
          setLargeFileDialogOpen(false);
          setPendingFiles(null);
          await uploadFiles(files);
        }}
      />
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
              const isLocalDev = file.storageProvider === "local";
              return (
                <div
                  key={file.id}
                  className="flex items-center gap-2 p-2 rounded-md bg-muted/50 hover:bg-muted transition-colors"
                >
                  <FileIcon className="w-4 h-4 text-muted-foreground shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-sm truncate block">
                        {file.originalFilename || file.fileName}
                      </span>
                      {isLocalDev && (
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Badge variant="secondary" className="shrink-0">Local (dev)</Badge>
                            </TooltipTrigger>
                            <TooltipContent>
                              Stored on this machine (dev). May not be visible from other computers.
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      )}
                    </div>
                    {file.fileSize && (
                      <span className="text-xs text-muted-foreground">
                        {formatFileSize(file.fileSize)}
                      </span>
                    )}
                  </div>
                  <div className="flex gap-1 shrink-0">
                    {/* Use signed originalUrl from server, not storage key fileUrl */}
                    {file.originalUrl && isValidHttpUrl(file.originalUrl) && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0"
                        onClick={() => window.open(file.originalUrl!, "_blank")}
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
