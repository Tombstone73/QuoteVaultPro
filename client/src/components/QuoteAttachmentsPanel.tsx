import { type ChangeEvent, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { isValidHttpUrl } from "@/lib/utils";
import { Download, Loader2, Upload, X } from "lucide-react";


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
};

function formatFileSize(bytes: number | null | undefined): string {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function QuoteAttachmentsPanel({ quoteId }: { quoteId: string }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadItems, setUploadItems] = useState<
    Array<{ key: string; name: string; percent: number; error?: string | null }>
  >([]);

  const attachmentsApiPath = `/api/quotes/${quoteId}/attachments`;

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
    } catch (error: any) {
      toast({
        title: "Remove Failed",
        description: error?.message || "Failed to remove attachment.",
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
          disabled={isUploading}
        />

        <div className="text-xs text-titan-text-muted">Add POs, instructions, tax forms, etc.</div>

        <Button
          variant="outline"
          size="sm"
          className="border-titan-border text-titan-text-secondary hover:text-titan-text-primary hover:bg-titan-bg-card-elevated rounded-titan-md"
          onClick={() => fileInputRef.current?.click()}
          disabled={isUploading}
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
      ) : attachments.length === 0 ? (
        <div className="text-xs text-titan-text-muted">No attachments</div>
      ) : (
        <div className="space-y-1">
          {attachments.map((a) => {
            const displayName = a.originalFilename || a.fileName;
            const openUrl =
              a.originalUrl && isValidHttpUrl(a.originalUrl) ? a.originalUrl : downloadProxyUrl(a.id);

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
                    className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                    onClick={() => handleRemove(a.id)}
                    title="Remove"
                  >
                    <X className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
