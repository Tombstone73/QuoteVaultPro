import { type ChangeEvent, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { isValidHttpUrl } from "@/lib/utils";
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
import { Download, Loader2, Trash2, Upload } from "lucide-react";
import { orderTimelineQueryKey } from "@/hooks/useOrders";
import { useDeleteOrderAttachment } from "@/hooks/useOrderAttachments";


type OrderAttachment = {
  id: string;
  fileName: string;
  fileUrl: string;
  fileSize?: number | null;
  mimeType?: string | null;
  createdAt: string;
  uploadedByName?: string | null;
  originalFilename?: string | null;
  originalUrl?: string | null;
};

function formatFileSize(bytes: number | null | undefined): string {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function OrderAttachmentsPanel({ orderId, locked = false }: { orderId: string; locked?: boolean }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [attachmentToDelete, setAttachmentToDelete] = useState<OrderAttachment | null>(null);
  const [uploadItems, setUploadItems] = useState<
    Array<{ key: string; name: string; percent: number; error?: string | null }>
  >([]);

  const deleteAttachment = useDeleteOrderAttachment(orderId);

  const attachmentsApiPath = `/api/orders/${orderId}/attachments`;

  const isLocked = locked;
  const lockedHint = 'This order cannot be edited.';

  const { data: attachments = [], isLoading } = useQuery<OrderAttachment[]>({
    queryKey: [attachmentsApiPath],
    queryFn: async () => {
      const response = await fetch(attachmentsApiPath, { credentials: "include" });
      if (!response.ok) throw new Error("Failed to load attachments");
      const json = await response.json();
      return json.data || [];
    },
    enabled: !!orderId,
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
        purpose: "order-attachment",
        orderId,
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
      body: JSON.stringify({ orderId, totalChunks }),
    });
    if (!finalizeResp.ok) {
      const json = await finalizeResp.json().catch(() => ({}));
      throw new Error(json.error || "Failed to finalize upload");
    }
    const finalizeJson = await finalizeResp.json();
    const { fileId } = finalizeJson.data || {};
    if (!fileId) throw new Error("Finalize did not return fileId");

    // 4) link to order
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
          console.error("[OrderAttachmentsPanel] Upload failed:", err);
          setProgress(key, { error: err?.message || "Upload failed" });
        }
      }

      if (successCount > 0) {
        queryClient.invalidateQueries({ queryKey: [attachmentsApiPath] });
        // Also invalidate orders list to refresh thumbnails
        queryClient.invalidateQueries({ queryKey: ["orders", "list"] });
        if (orderId) {
          queryClient.invalidateQueries({ queryKey: orderTimelineQueryKey(orderId) });
        }
        toast({
          title: "Uploaded",
          description: `${successCount} file${successCount === 1 ? "" : "s"} attached to order.`,
        });
      }
    } catch (error: any) {
      console.error("[OrderAttachmentsPanel] Upload error:", error);
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

  const isEmpty = !isLoading && attachments.length === 0;
  const showEmptyText = isEmpty && !isUploading && uploadItems.length === 0;

  const handleConfirmDelete = async () => {
    const target = attachmentToDelete;
    if (!target) return;
    try {
      await deleteAttachment.mutateAsync(target.id);
      toast({ title: "Deleted", description: "Attachment removed from order." });
      setAttachmentToDelete(null);
    } catch (error: any) {
      toast({
        title: "Delete Failed",
        description: error?.message || "Failed to delete attachment.",
        variant: "destructive",
      });
    }
  };

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

      {isLoading ? (
        <div className="text-xs text-titan-text-muted">Loading attachments...</div>
      ) : (
        <div className="space-y-1">
          {attachments.map((a) => {
            const displayName = a.originalFilename || a.fileName;
            const openUrl = a.originalUrl && isValidHttpUrl(a.originalUrl) ? a.originalUrl : a.fileUrl;

            return (
              <div
                key={a.id}
                className="flex items-center justify-between gap-3 rounded-titan-md border border-titan-border-subtle px-3 py-2"
              >
                <div className="min-w-0">
                  <div className="text-sm font-medium text-titan-text-primary truncate">{displayName}</div>
                  <div className="text-xs text-titan-text-muted">
                    {a.createdAt ? format(new Date(a.createdAt), "MMM d, yyyy p") : "—"}
                    {a.uploadedByName ? ` • ${a.uploadedByName}` : ""}
                    {a.fileSize ? ` • ${formatFileSize(a.fileSize)}` : ""}
                  </div>
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 p-0"
                    onClick={() => window.open(openUrl, "_blank")}
                    title="Open"
                  >
                    <Download className="w-4 h-4" />
                  </Button>

                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 p-0"
                    onClick={() => setAttachmentToDelete(a)}
                    title={isLocked ? lockedHint : "Delete"}
                    disabled={isLocked || deleteAttachment.isPending}
                  >
                    {deleteAttachment.isPending && attachmentToDelete?.id === a.id ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Trash2 className="w-4 h-4 text-destructive" />
                    )}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <AlertDialog open={!!attachmentToDelete} onOpenChange={(open) => (!open ? setAttachmentToDelete(null) : undefined)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete attachment</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove the attachment from this order.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteAttachment.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmDelete}
              disabled={deleteAttachment.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteAttachment.isPending ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
