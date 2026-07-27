import { type ChangeEvent, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { usePageVisible } from "@/hooks/usePageVisible";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { isValidHttpUrl } from "@/lib/utils";
import { AttachmentViewerDialog } from "@/components/AttachmentViewerDialog";
import { CustomerUploadReviewPanel } from "@/components/CustomerUploadReviewPanel";
import { ViewAllAttachmentsDialog } from "@/components/ViewAllAttachmentsDialog";
import { downloadFileFromUrl } from "@/lib/downloadFile";
import { getThumbSrc } from "@/lib/getThumbSrc";
import { hasAnyUnsettledAttachment } from "@/lib/attachments/attachmentStatus";
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
import { Download, Loader2, Trash2, Upload, FileText, Image as ImageIcon, Eye } from "lucide-react";
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
  // Thumbnail fields (PACK 1: preserve these from API response)
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
  pages?: Array<{ thumbUrl?: string | null; thumbStatus?: string | null }>;
  portalFileCategory?: string | null;
  customerUploadReviewStatus?: "pending_review" | "accepted" | "rejected" | null;
  customerUploadReviewNote?: string | null;
  customerUploadPromotionType?: "reference" | "artwork" | null;
  customerUploadAssignedToOrderLineItemId?: string | null;
  customerUploadAssignmentType?: "reference_for_line_item" | null;
  customerUploadArtworkSelectionType?: "artwork_side_intake" | null;
  customerUploadPrimaryCandidateSide?: "front" | "back" | "both" | null;
  orderLineItemId?: string | null;
  side?: "front" | "back" | "both" | "na" | null;
  isPrimary?: boolean | null;
};

function formatFileSize(bytes: number | null | undefined): string {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function OrderAttachmentsPanel({ orderId, locked = false, lineItems = [] }: { orderId: string; locked?: boolean; lineItems?: Array<{ id: string; description: string; sortOrder?: number | null }> }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const isPageVisible = usePageVisible();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [devFixtureConfirmationOpen, setDevFixtureConfirmationOpen] = useState(false);
  const [isCreatingDevFixtures, setIsCreatingDevFixtures] = useState(false);
  const [attachmentToDelete, setAttachmentToDelete] = useState<OrderAttachment | null>(null);
  const [viewerAttachment, setViewerAttachment] = useState<OrderAttachment | null>(null);
  const [viewerAttachments, setViewerAttachments] = useState<OrderAttachment[] | undefined>(undefined);
  const [viewerInitialIndex, setViewerInitialIndex] = useState(0);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewAllOpen, setViewAllOpen] = useState(false);
  const [uploadItems, setUploadItems] = useState<
    Array<{ key: string; name: string; percent: number; error?: string | null }>
  >([]);
  const pollingGuardRef = useRef<{ startAt: number | null; attempts: number }>({
    startAt: null,
    attempts: 0,
  });

  const deleteAttachment = useDeleteOrderAttachment(orderId);

  const attachmentsApiPath = `/api/orders/${orderId}/attachments`;
  const canCreateStage18PDevFixtures = typeof window !== "undefined" && window.location.hostname === "dev.printershero.com";

  const isLocked = locked;
  const lockedHint = 'This order cannot be edited.';

  const { data: attachments = [], isLoading } = useQuery<OrderAttachment[]>({
    queryKey: [attachmentsApiPath],
    queryFn: async () => {
      const response = await fetch(attachmentsApiPath, { credentials: "include" });
      if (!response.ok) throw new Error("Failed to load attachments");
      const json = await response.json();
      const data = json.data || [];
      
      // Debug logging (enable via: window.__ATTACHMENT_DEBUG__ = true in browser console)
      if ((window as any).__ATTACHMENT_DEBUG__ && data.length > 0) {
        console.log('[OrderAttachmentsPanel] First attachment keys:', Object.keys(data[0]));
        console.log('[OrderAttachmentsPanel] First attachment thumbUrl:', data[0].thumbUrl);
        console.log('[OrderAttachmentsPanel] First attachment previewUrl:', data[0].previewUrl);
        console.log('[OrderAttachmentsPanel] First attachment objectPath:', data[0].objectPath);
        console.log('[OrderAttachmentsPanel] First attachment downloadUrl:', data[0].downloadUrl);
        console.log('[OrderAttachmentsPanel] First attachment full:', data[0]);
      }
      
      return data;
    },
    enabled: !!orderId,
    refetchInterval: (query) => {
      if (!isPageVisible) return false;

      const MAX_POLL_MS = 60_000;
      const MAX_ATTEMPTS = 40;
      const POLL_INTERVAL_MS = 1500;

      const data = query?.state?.data as OrderAttachment[] | undefined;

      if (!hasAnyUnsettledAttachment(data)) {
        pollingGuardRef.current = { startAt: null, attempts: 0 };
        return false;
      }

      if (pollingGuardRef.current.startAt === null) {
        pollingGuardRef.current.startAt = Date.now();
        pollingGuardRef.current.attempts = 0;
      }

      pollingGuardRef.current.attempts += 1;
      const elapsed = Date.now() - pollingGuardRef.current.startAt;
      if (elapsed > MAX_POLL_MS || pollingGuardRef.current.attempts > MAX_ATTEMPTS) {
        console.warn(`[OrderAttachmentsPanel] Polling guard tripped for ${attachmentsApiPath}: elapsed=${elapsed}ms attempts=${pollingGuardRef.current.attempts}`);
        pollingGuardRef.current = { startAt: null, attempts: 0 };
        return false;
      }

      return POLL_INTERVAL_MS;
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
// PACK B: Show thumbnail grid + "View All" button when attachments > 6
  const THUMBNAIL_GRID_LIMIT = 6;
  const showViewAll = attachments.length > 0;
  const displayedAttachments = showViewAll ? attachments.slice(0, THUMBNAIL_GRID_LIMIT) : attachments;

  // PACK C: Download all as zip handler
  const handleDownloadAllZip = () => {
    const zipUrl = `/api/orders/${orderId}/attachments.zip`;
    // Use anchor tag for proper filename handling
    const anchor = document.createElement("a");
    anchor.href = zipUrl;
    anchor.style.display = "none";
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
  };

  // PACK C2: Download individual attachment
  const handleDownloadAttachment = (attachment: any) => {
    const downloadUrl = (attachment as any).originalUrl || (attachment as any).downloadUrl || (attachment as any).fileUrl;
    if (!downloadUrl) {
      toast({
        title: "Download Failed",
        description: "No download URL available for this attachment.",
        variant: "destructive",
      });
      return;
    }

    const filename = (attachment as any).originalFilename || (attachment as any).fileName || "download";
    void downloadFileFromUrl(downloadUrl, filename);
  };

  
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

  const createStage18PDevFixtures = async () => {
    setIsCreatingDevFixtures(true);
    try {
      const response = await fetch(`/api/orders/${orderId}/dev-stage18p-upload-fixtures`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmDevFixtureCreation: true }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.message || "DEV fixture creation failed.");
      await queryClient.invalidateQueries({ queryKey: [attachmentsApiPath] });
      toast({ title: "DEV Stage 18P fixtures ready", description: "Harmless labelled upload fixtures were created or reused." });
      setDevFixtureConfirmationOpen(false);
    } catch (error: any) {
      toast({ title: "DEV fixture creation failed", description: error?.message || "Unable to create DEV fixtures.", variant: "destructive" });
    } finally {
      setIsCreatingDevFixtures(false);
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
            {canCreateStage18PDevFixtures && (
              <Button variant="outline" size="sm" onClick={() => setDevFixtureConfirmationOpen(true)} disabled={isCreatingDevFixtures}>
                Create DEV Stage 18P Fixtures
              </Button>
            )}
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
            {canCreateStage18PDevFixtures && (
              <Button variant="outline" size="sm" onClick={() => setDevFixtureConfirmationOpen(true)} disabled={isCreatingDevFixtures}>
                Create DEV Stage 18P Fixtures
              </Button>
            )}
          </div>
        )}
      </div>

      <AlertDialog open={devFixtureConfirmationOpen} onOpenChange={setDevFixtureConfirmationOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Create DEV Stage 18P upload fixtures?</AlertDialogTitle>
            <AlertDialogDescription>
              This DEV-only action creates or reuses harmless labelled customer-upload fixtures on this order. It does not create final art, proofs, prepress, production, invoices, payments, or EPS activity.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isCreatingDevFixtures}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={createStage18PDevFixtures} disabled={isCreatingDevFixtures}>
              {isCreatingDevFixtures ? "Creating..." : "Create DEV fixtures"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <CustomerUploadReviewPanel
        entityLabel="Order"
        reviewUrl={(attachmentId) => `${attachmentsApiPath}/${attachmentId}/customer-upload-review`}
        promotionUrl={(attachmentId) => `${attachmentsApiPath}/${attachmentId}/customer-upload-promotion`}
        assignmentUrl={(attachmentId) => `${attachmentsApiPath}/${attachmentId}/customer-upload-assignment`}
        artworkSelectionUrl={(attachmentId) => `${attachmentsApiPath}/${attachmentId}/customer-upload-artwork-selection`}
        artworkSideDesignationUrl={(attachmentId) => `${attachmentsApiPath}/${attachmentId}/customer-upload-artwork-side-designation`}
        primaryArtworkCandidateUrl={(attachmentId) => `${attachmentsApiPath}/${attachmentId}/customer-upload-primary-artwork-candidate`}
        orderId={orderId}
        orderLineItems={lineItems}
        attachments={attachments}
        orderPromotionAllowed
        onReviewed={() => queryClient.invalidateQueries({ queryKey: [attachmentsApiPath] })}
      />

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

              {/* View All button */}
              {showViewAll && (
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full"
                  onClick={() => setViewAllOpen(true)}
                >
                  Manage attachments ({attachments.length})
                </Button>
              )}
            </div>
          ) : null}

      <AttachmentViewerDialog
        attachment={viewerAttachment as any}
        attachments={viewerAttachments as any}
        initialIndex={viewerInitialIndex}
        open={viewerOpen}
        onOpenChange={(open) => {
          setViewerOpen(open);
          if (!open) {
            setViewerAttachment(null);
            setViewerAttachments(undefined);
            setViewerInitialIndex(0);
          }
        }}
        hideFilmstrip={true}
      />

      <ViewAllAttachmentsDialog
        open={viewAllOpen}
        onOpenChange={setViewAllOpen}
        orderAttachments={attachments.map((a) => ({ ...a, source: "order" as const, orderId }))}
        lineItemAttachments={[]}
        onViewAttachment={(a) => {
          const allAttachments = attachments.map((att) => ({ ...att, source: "order" as const }));
          const index = allAttachments.findIndex((att) => att.id === a.id);
          setViewerAttachments(allAttachments as any);
          setViewerInitialIndex(Math.max(0, index));
          setViewerAttachment(a as any);
          setViewerOpen(true);
          setViewAllOpen(false);
        }}
        onDownloadAll={attachments.length > 0 ? handleDownloadAllZip : undefined}
        onDownload={handleDownloadAttachment}
        onDeleteAttachment={(a) => setAttachmentToDelete(a as any)}
        onPortalVisibilityUpdated={() => {
          queryClient.invalidateQueries({ queryKey: [attachmentsApiPath] });
        }}
        canDelete={!isLocked}
        orderId={orderId}
        parentType="order"
      />

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
