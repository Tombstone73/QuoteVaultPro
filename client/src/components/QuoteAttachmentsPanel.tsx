import { type ChangeEvent, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { isValidHttpUrl } from "@/lib/utils";
import { AttachmentViewerDialog } from "@/components/AttachmentViewerDialog";
import { downloadFileFromUrl } from "@/lib/downloadFile";
import { getThumbSrc } from "@/lib/getThumbSrc";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Download, Loader2, Trash2, Upload, FileText, Image as ImageIcon, Eye, X } from "lucide-react";


type QuoteAttachment = {
  id: string;
  fileName: string;
  fileUrl: string;
  fileSize?: number | null;
  mimeType?: string | null;
  createdAt: string;
  uploadedByName?: string | null;
  originalFilename?: string | null;
  originalUrl?: string | null;
  // Thumbnail fields (enriched by server)
  previewThumbnailUrl?: string | null;
  thumbnailUrl?: string | null;
  thumbUrl?: string | null;
  previewUrl?: string | null;
  thumbKey?: string | null;
  previewKey?: string | null;
  thumbStatus?: string | null;
  thumbError?: string | null;
  objectPath?: string | null;
  downloadUrl?: string | null;
  pages?: Array<{ thumbUrl?: string | null }>;
};

function formatFileSize(bytes: number | null | undefined): string {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function QuoteAttachmentsPanel({ quoteId, locked = false }: { quoteId: string; locked?: boolean }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [attachmentToDelete, setAttachmentToDelete] = useState<QuoteAttachment | null>(null);
  const [viewerAttachment, setViewerAttachment] = useState<QuoteAttachment | null>(null);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [uploadItems, setUploadItems] = useState<
    Array<{ key: string; name: string; percent: number; error?: string | null }>
  >([]);

  const attachmentsApiPath = `/api/quotes/${quoteId}/attachments`;

  const isLocked = locked;
  const lockedHint = 'Approved quotes are locked. Revise to change.';

  const downloadProxyUrl = (attachmentId: string) =>
    `/api/quotes/${quoteId}/attachments/${attachmentId}/download/proxy`;

  const { data: attachments = [], isLoading } = useQuery<QuoteAttachment[]>({
    queryKey: [attachmentsApiPath],
    queryFn: async () => {
      const response = await fetch(attachmentsApiPath, { credentials: "include" });
      if (!response.ok) throw new Error("Failed to load attachments");
      const json = await response.json();
      return json.data || [];
    },
    enabled: !!quoteId,
    // Auto-refresh while thumbnails are pending (worker polls every 10s)
    refetchInterval: (query) => {
      const data = query?.state?.data;
      const hasPending = data?.some((a: QuoteAttachment) => 
        a.thumbStatus === 'uploaded' || a.thumbStatus === 'thumb_pending'
      );
      return hasPending ? 5000 : false; // Poll every 5s when pending, otherwise don't poll
    },
  });

  const uploadsApiInit = "/api/uploads/init";

  const uploadItemKey = (file: File) => `${file.name}-${file.size}-${file.lastModified}`;

  const hasUploadActivity = useMemo(() => uploadItems.some((u) => u.percent < 100 && !u.error), [uploadItems]);

  const setProgress = (key: string, patch: Partial<{ percent: number; error: string | null }>) => {
    setUploadItems((prev) =>
      prev.map((u) => (u.key === key ? { ...u, ...patch } : u))
    );
  };

  const uploadSingleFileChunked = async (file: File, key: string) => {
    // 1) init
    const initResp = await fetch(uploadsApiInit, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        filename: file.name,
        mimeType: file.type || "application/octet-stream",
        size: file.size,
        purpose: "quote-attachment",
        quoteId,
      }),
    });
    if (!initResp.ok) {
      const json = await initResp.json().catch(() => ({}));
      throw new Error(json.error || "Failed to initialize upload");
    }
    const initJson = await initResp.json();
    const { uploadId, chunkSizeBytes, totalChunks } = initJson.data || {};
    if (!uploadId || !chunkSizeBytes || !totalChunks) throw new Error("Invalid init response");

    // 2) upload chunks (limited concurrency)
    let uploadedBytes = 0;
    const concurrency = 3;
    let nextChunkIndex = 0;

    const uploadChunk = async (chunkIndex: number) => {
      const start = chunkIndex * chunkSizeBytes;
      const end = Math.min(file.size, start + chunkSizeBytes);
      const blob = file.slice(start, end);

      const resp = await fetch(`/api/uploads/${uploadId}/chunks/${chunkIndex}`, {
        method: "PUT",
        headers: { "Content-Type": "application/octet-stream" },
        credentials: "include",
        body: blob,
      });
      if (!resp.ok) {
        const json = await resp.json().catch(() => ({}));
        throw new Error(json.error || `Failed to upload chunk ${chunkIndex}`);
      }

      uploadedBytes += blob.size;
      const pct = Math.min(99, Math.floor((uploadedBytes / file.size) * 100));
      setProgress(key, { percent: pct });
    };

    const workers = Array.from({ length: Math.min(concurrency, totalChunks) }, () =>
      (async () => {
        while (true) {
          const idx = nextChunkIndex;
          nextChunkIndex += 1;
          if (idx >= totalChunks) return;
          await uploadChunk(idx);
        }
      })()
    );

    await Promise.all(workers);

    // 3) finalize
    const finalizeResp = await fetch(`/api/uploads/${uploadId}/finalize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ quoteId, totalChunks }),
    });
    if (!finalizeResp.ok) {
      const json = await finalizeResp.json().catch(() => ({}));
      throw new Error(json.error || "Failed to finalize upload");
    }
    const finalizeJson = await finalizeResp.json();
    const { fileId } = finalizeJson.data || {};
    if (!fileId) throw new Error("Finalize did not return fileId");

    // 4) link to quote
    const linkResp = await fetch(attachmentsApiPath, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ uploadId: fileId }),
    });
    if (!linkResp.ok) {
      const json = await linkResp.json().catch(() => ({}));
      throw new Error(json.error || "Failed to link attachment");
    }

    setProgress(key, { percent: 100 });
  };

  const handleUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    if (isLocked) {
      toast({ title: 'Locked', description: lockedHint, variant: 'destructive' });
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }
    if (!e.target.files || e.target.files.length === 0) return;

    const filesToUpload = Array.from(e.target.files);

    // Initialize UI rows
    const newItems = filesToUpload.map((file) => ({
      key: uploadItemKey(file),
      name: file.name,
      percent: 0,
      error: null as string | null,
    }));
    setUploadItems((prev) => {
      const existingKeys = new Set(prev.map((p) => p.key));
      return [...prev, ...newItems.filter((n) => !existingKeys.has(n.key))];
    });

    setIsUploading(true);

    try {
      let successCount = 0;

      // Upload sequentially to keep behavior predictable for very large files.
      for (const file of filesToUpload) {
        const key = uploadItemKey(file);
        try {
          // Chunked flow works for all sizes (no base64).
          await uploadSingleFileChunked(file, key);
          successCount += 1;
        } catch (err: any) {
          console.error("[QuoteAttachmentsPanel] Upload failed:", err);
          setProgress(key, { error: err?.message || "Upload failed" });
        }
      }

      if (successCount > 0) {
        queryClient.invalidateQueries({ queryKey: [attachmentsApiPath] });
        toast({
          title: "Uploaded",
          description: `${successCount} file${successCount === 1 ? "" : "s"} attached to quote.`,
        });
      }
    } catch (error: any) {
      console.error("[QuoteAttachmentsPanel] Upload error:", error);
      toast({
        title: "Upload Failed",
        description: error?.message || "Failed to upload attachments.",
        variant: "destructive",
      });
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleRemove = async (attachmentId: string) => {
    if (isLocked) {
      toast({ title: 'Locked', description: lockedHint, variant: 'destructive' });
      return;
    }
    
    try {
      const response = await fetch(`${attachmentsApiPath}/${attachmentId}`, {
        method: "DELETE",
        credentials: "include",
      });

      if (!response.ok) {
        const json = await response.json().catch(() => ({}));
        throw new Error(json.error || "Failed to remove attachment");
      }

      queryClient.invalidateQueries({ queryKey: [attachmentsApiPath] });
      toast({ title: "Removed", description: "Attachment removed from quote." });
      setAttachmentToDelete(null);
    } catch (error: any) {
      toast({
        title: "Remove Failed",
        description: error?.message || "Failed to remove attachment.",
        variant: "destructive",
      });
    }
  };

  const isEmpty = !isLoading && attachments.length === 0;
  const showEmptyText = isEmpty && !isUploading && uploadItems.length === 0;
  const THUMBNAIL_GRID_LIMIT = 6;
  const showViewAll = attachments.length > THUMBNAIL_GRID_LIMIT;
  const displayedAttachments = showViewAll ? attachments.slice(0, THUMBNAIL_GRID_LIMIT) : attachments;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <input
          type="file"
          ref={fileInputRef}
          className="hidden"
          multiple
          onChange={handleUpload}
          disabled={isUploading || isLocked}
        />

        {isEmpty ? (
          <div className="w-full flex flex-col items-center gap-2">
            {isLocked && (
              <div className="text-xs text-titan-text-muted text-center" title={lockedHint}>
                {lockedHint}
              </div>
            )}

            <Button
              variant="outline"
              size="sm"
              className="border-titan-border text-titan-text-secondary hover:text-titan-text-primary hover:bg-titan-bg-card-elevated rounded-titan-md"
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploading || isLocked}
              title={isLocked ? lockedHint : 'Upload'}
            >
              {isUploading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Uploading
                </>
              ) : (
                <>
                  <Upload className="w-4 h-4 mr-2" />
                  Upload
                </>
              )}
            </Button>

            {showEmptyText && <div className="text-xs text-titan-text-muted text-center">No attachments</div>}
          </div>
        ) : (
          <div className="w-full flex items-center justify-center gap-3">
            {isLocked && (
              <div className="text-xs text-titan-text-muted" title={lockedHint}>
                {lockedHint}
              </div>
            )}

            <Button
              variant="outline"
              size="sm"
              className="border-titan-border text-titan-text-secondary hover:text-titan-text-primary hover:bg-titan-bg-card-elevated rounded-titan-md"
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploading || isLocked}
              title={isLocked ? lockedHint : 'Upload'}
            >
              {isUploading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Uploading
                </>
              ) : (
                <>
                  <Upload className="w-4 h-4 mr-2" />
                  Upload
                </>
              )}
            </Button>
          </div>
        )}
      </div>

      {uploadItems.length > 0 && (
        <div className="space-y-1">
          {uploadItems.slice(-4).map((u) => (
            <div key={u.key} className="text-xs text-titan-text-muted flex items-center justify-between gap-3">
              <div className="truncate">{u.name}</div>
              <div className="shrink-0">
                {u.error ? <span className="text-destructive">{u.error}</span> : `${u.percent}%`}
              </div>
            </div>
          ))}
          {hasUploadActivity && (
            <div className="text-[11px] text-titan-text-muted">Uploading… you can keep working.</div>
          )}
        </div>
      )}

      {/* Thumbnail grid - show when attachments exist */}
      {isLoading ? (
        <div className="text-xs text-titan-text-muted">Loading attachments...</div>
      ) : attachments.length > 0 ? (
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-2">
            {displayedAttachments.map((a) => {
              const displayName = a.originalFilename || a.fileName;
              const thumbSrc = getThumbSrc(a as any);
              const isPdf = a.mimeType?.toLowerCase().includes("pdf") || displayName.toLowerCase().endsWith(".pdf");
              const isPending = a.thumbStatus === 'uploaded' || a.thumbStatus === 'thumb_pending';

              const openInViewer = () => {
                setViewerAttachment(a);
                setViewerOpen(true);
              };

              return (
                <div
                  key={a.id}
                  className="group relative aspect-square rounded-md border border-border overflow-hidden cursor-pointer hover:ring-2 hover:ring-primary transition-all"
                  onClick={openInViewer}
                >
                  {/* Base thumbnail or icon placeholder */}
                  {thumbSrc ? (
                    <img
                      src={thumbSrc}
                      alt={displayName}
                      className="absolute inset-0 h-full w-full object-cover"
                      loading="lazy"
                      draggable={false}
                      onError={(e) => {
                        (e.currentTarget as HTMLImageElement).style.display = "none";
                      }}
                    />
                  ) : (
                    <div className="absolute inset-0 bg-muted flex items-center justify-center">
                      {isPdf ? (
                        <FileText className="w-8 h-8 text-muted-foreground" />
                      ) : (
                        <ImageIcon className="w-8 h-8 text-muted-foreground" />
                      )}
                    </div>
                  )}

                  {/* Pending thumbnail indicator */}
                  {isPending && !thumbSrc && (
                    <div className="absolute top-1 left-1 rounded-full bg-amber-500/90 p-1" title="Generating thumbnail...">
                      <Loader2 className="w-3 h-3 text-white animate-spin" />
                    </div>
                  )}

                  {/* Overlay on hover */}
                  <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center z-10">
                    <Eye className="w-6 h-6 text-white" />
                  </div>

                  {/* Delete button (top-right) */}
                  {!isLocked && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setAttachmentToDelete(a);
                      }}
                      className="absolute top-2 right-2 p-1.5 bg-destructive/90 hover:bg-destructive rounded-md opacity-0 group-hover:opacity-100 transition-opacity z-20"
                      title="Delete attachment"
                    >
                      <Trash2 className="w-4 h-4 text-white" />
                    </button>
                  )}

                  {/* Filename overlay at bottom */}
                  <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-2 z-10">
                    <div className="text-xs text-white truncate">{displayName}</div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Show all button if more than limit */}
          {showViewAll && (
            <div className="text-xs text-center text-muted-foreground">
              Showing {THUMBNAIL_GRID_LIMIT} of {attachments.length} attachments
            </div>
          )}
        </div>
      ) : null}

      <AttachmentViewerDialog
        attachment={viewerAttachment as any}
        open={viewerOpen}
        onOpenChange={(open) => {
          setViewerOpen(open);
          if (!open) setViewerAttachment(null);
        }}
      />

      <AlertDialog open={!!attachmentToDelete} onOpenChange={(open) => (!open ? setAttachmentToDelete(null) : undefined)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete attachment</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove the attachment from this quote.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => attachmentToDelete && handleRemove(attachmentToDelete.id)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
