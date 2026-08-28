import { useState, useRef, useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { usePageVisible } from "@/hooks/usePageVisible";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Paperclip, Upload, Download, X, Loader2, Image, FileText, File, ChevronDown, ChevronUp, Sparkles, Eye } from "lucide-react";
import { cn, isValidHttpUrl } from "@/lib/utils";
import { getAttachmentDisplayName, isPdfAttachment, getPdfPageCount } from "@/lib/attachments";
import { getAttachmentPollingInterval, isAttachmentSettled } from "@/lib/attachments/attachmentStatus";
import { mergeQuoteLineItemRows } from "@/lib/attachments/quoteLineItemRows";
import { normalizeOrderFileRows } from "@/lib/attachments/orderFileRows";
import { AttachmentViewerDialog } from "@/components/AttachmentViewerDialog";
import { downloadAuthenticatedFile } from "@/lib/authenticatedFileDownload";
import { toAttachmentViewerAttachments } from "@/lib/attachmentViewer";
import { getThumbSrc } from "@/lib/getThumbSrc";
import { objectsUrl } from "@/lib/apiConfig";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { setPendingExpandedLineItemId } from "@/lib/ui/persistExpandedLineItem";
import { uploadAttachmentViaChunked, type TemporaryOrderAttachmentUpload } from "@/lib/uploads/chunkedAttachmentUpload";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Checkbox } from "@/components/ui/checkbox";
import { assignOrderLineItemArtworkSide } from "@/lib/attachments/orderArtworkSideAssignment";
import { buildArtworkAllocationStatus, buildArtworkOutputSets } from "@shared/artworkAllocation";

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
  fileRecordId?: string | null;
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
  side?: 'front' | 'back' | 'both' | 'na' | null;
  role?: 'artwork' | 'reference' | 'output' | 'other' | null;
  productionQuantity?: number | null;
  productionGroupId?: string | null;
  productionRole?: 'artwork' | 'reference' | null;
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
  pendingOrderAttachments?: TemporaryOrderAttachmentUpload[];
  onTemporaryOrderUpload?: (files: File[]) => Promise<void>;
  /** Remove a staged attachment from the unsaved order draft. */
  onTemporaryOrderAttachmentRemove?: (uploadId: string) => void;
  /** Update allocation metadata for an unsaved direct-order artwork upload. */
  onTemporaryOrderAttachmentUpdate?: (uploadId: string, patch: Pick<TemporaryOrderAttachmentUpload, "productionQuantity" | "productionGroupId" | "allocationSource">) => void;
  /** Atomically update the staged members of one finished Artwork Set. */
  onTemporaryOrderArtworkSetUpdate?: (uploadIds: string[], patch: Pick<TemporaryOrderAttachmentUpload, "productionQuantity" | "productionGroupId" | "allocationSource">) => void;
  /** Notify the line-item editor after a persisted attachment is unlinked. */
  onSavedAttachmentRemoved?: (file: Pick<LineItemAttachment, "id" | "fileRecordId" | "side">) => void;
  /** Show explicit Front/Back controls for a double-sided print line. */
  doubleSided?: boolean;
  /** Persisted line-item intent; controlled by the order line editor. */
  useSameArtworkBothSides?: boolean;
  onUseSameArtworkBothSidesChange?: (checked: boolean) => void;
  lineQuantity?: number | null;
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
  pendingOrderAttachments = [],
  onTemporaryOrderUpload,
  onTemporaryOrderAttachmentRemove,
  onTemporaryOrderAttachmentUpdate,
  onTemporaryOrderArtworkSetUpdate,
  onSavedAttachmentRemoved,
  doubleSided = false,
  useSameArtworkBothSides: controlledUseSameArtworkBothSides,
  onUseSameArtworkBothSidesChange,
  lineQuantity,
}: LineItemAttachmentsPanelProps) {
  const { toast } = useToast();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const isPageVisible = usePageVisible();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragDepthRef = useRef(0);
  const [isUploading, setIsUploading] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  const [userClosed, setUserClosed] = useState(false); // Track if user explicitly closed the panel
  const [isCreatingQuote, setIsCreatingQuote] = useState(false);
  const [isPersistingLineItem, setIsPersistingLineItem] = useState(false);
  const [isRepairingRelationships, setIsRepairingRelationships] = useState(false);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const [uncontrolledUseSameArtworkBothSides, setUncontrolledUseSameArtworkBothSides] = useState(false);
  const [selectedArtworkIds, setSelectedArtworkIds] = useState<string[]>([]);
  const [newArtworkSetQuantity, setNewArtworkSetQuantity] = useState("");
  const [artworkSetPending, setArtworkSetPending] = useState(false);
  const useSameArtworkBothSides = controlledUseSameArtworkBothSides ?? uncontrolledUseSameArtworkBothSides;
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

        return normalizeOrderFileRows(
          attachments,
          assets.map((a: any) => ({
            id: a.id,
            fileRecordId: a.fileRecordId ?? null,
            fileName: a.fileName || a.originalFilename || "file",
            originalFilename: a.originalFilename || a.fileName || null,
            fileUrl: a.fileUrl || a.fileKey || a.key || "",
            fileSize: a.fileSize ?? a.sizeBytes ?? null,
            sizeBytes: a.sizeBytes ?? a.fileSize ?? null,
            mimeType: a.mimeType ?? null,
            createdAt: a.createdAt || new Date().toISOString(),
            originalUrl: a.originalUrl ?? null,
            downloadUrl: a.downloadUrl ?? null,
            thumbUrl: a.thumbUrl ?? a.thumbnailUrl ?? null,
            previewUrl: a.previewUrl ?? null,
            thumbnailUrl: a.thumbnailUrl ?? null,
            previewThumbnailUrl: a.previewThumbnailUrl ?? null,
            thumbStatus:
              a.previewStatus === "ready"
                ? ("thumb_ready" as const)
                : a.previewStatus === "pending"
                ? ("thumb_pending" as const)
                : a.previewStatus === "failed"
                ? ("thumb_failed" as const)
                : undefined,
            thumbError: a.previewError ?? a.thumbError,
            thumbKey: a.thumbKey,
            previewKey: a.previewKey,
            pageCount: a.pageCount,
            pages: a.pages,
            side: a.side ?? 'na',
          })),
        ) as LineItemAttachment[];
      }

      const attachments = Array.isArray(json?.data) ? json.data : [];
      const assets = Array.isArray(json?.assets) ? json.assets : [];
      return mergeQuoteLineItemRows(attachments, assets);
    },
    enabled: !!filesApiPath,
    refetchInterval: (query) => {
      // Bounded polling for thumbnail/pageCount processing
      const MAX_POLL_MS = 60_000; // 60 seconds max
      const MAX_ATTEMPTS = 40; // 40 attempts at 1500ms = 60s
      const POLL_INTERVAL_MS = 1500; // 1.5 seconds

      const data = query.state.data as LineItemAttachment[] | undefined;
      return getAttachmentPollingInterval({
        attachments: data,
        guard: pollingGuardRef.current,
        isVisible: isPageVisible,
        maxPollMs: MAX_POLL_MS,
        maxAttempts: MAX_ATTEMPTS,
        intervalMs: POLL_INTERVAL_MS,
        logLabel: filesApiPath ?? undefined,
      });
    },
  });

  const fileCount = attachments.length + pendingOrderAttachments.length;
  const isProductionAllocationRow = (file: LineItemAttachment) => {
    const role = String(file.productionRole ?? file.role ?? "artwork").toLowerCase();
    return role === "artwork" || role === "output" || role === "final";
  };
  const productionRows = attachments.filter(isProductionAllocationRow);
  const allocationStatus = useMemo(() => buildArtworkAllocationStatus({
    lineQuantity,
    members: productionRows,
  }), [lineQuantity, productionRows]);
  const stagedAllocationStatus = useMemo(() => buildArtworkAllocationStatus({
    lineQuantity,
    members: pendingOrderAttachments.map((file) => ({
      id: file.uploadId,
      role: "artwork",
      productionQuantity: file.productionQuantity ?? null,
      productionGroupId: file.productionGroupId ?? null,
    })),
  }), [lineQuantity, pendingOrderAttachments]);
  const artworkSets = useMemo(() => buildArtworkOutputSets(productionRows), [productionRows]);
  const stagedArtworkSets = useMemo(() => buildArtworkOutputSets(pendingOrderAttachments.map((file) => ({
    id: file.uploadId,
    role: "artwork",
    productionQuantity: file.productionQuantity ?? null,
    productionGroupId: file.productionGroupId ?? null,
  }))), [pendingOrderAttachments]);
  const displayedArtworkSets = parentType === "order" && orderId ? artworkSets : stagedArtworkSets;
  const displayedArtworkMembers: Array<{ id: string; fileName: string; productionGroupId?: string | null }> = parentType === "order" && orderId
    ? productionRows.map((file) => ({ id: file.id, fileName: getAttachmentDisplayName(file), productionGroupId: file.productionGroupId ?? null }))
    : pendingOrderAttachments.map((file) => ({ id: file.uploadId, fileName: file.fileName, productionGroupId: file.productionGroupId ?? null }));
  // Asset-only uploads are assignable too. The backend materializes their
  // order_attachment link when the first explicit side is saved.
  const artworkAttachments = attachments;
  const frontArtwork = artworkAttachments.find((file) => file.side === 'front') ?? null;
  const backArtwork = artworkAttachments.find((file) => file.side === 'back') ?? null;
  const sharedArtwork = artworkAttachments.find((file) => file.side === 'both') ?? null;
  const automaticBothSideAssignmentRef = useRef<string | null>(null);

  useEffect(() => {
    if (controlledUseSameArtworkBothSides !== undefined) return;
    if (!doubleSided) return;
    setUncontrolledUseSameArtworkBothSides(Boolean(sharedArtwork));
  }, [controlledUseSameArtworkBothSides, doubleSided, sharedArtwork?.id]);

  const assignArtworkSide = async (fileId: string, side: 'front' | 'back' | 'both') => {
    if (!orderId || !lineItemId || !filesApiPath) return false;
    try {
      await assignOrderLineItemArtworkSide({ orderId, lineItemId, fileId, side });
      await queryClient.invalidateQueries({ queryKey: [filesApiPath] });
      toast({ title: 'Artwork side assigned', description: side === 'both' ? 'The same artwork is assigned to Front and Back.' : `Artwork assigned to ${side}.` });
      return true;
    } catch (error: any) {
      toast({ title: 'Artwork assignment failed', description: error?.message || 'Please try again.', variant: 'destructive' });
      return false;
    }
  };

  const updateArtworkAllocation = async (file: LineItemAttachment, patch: { role: 'artwork' | 'reference'; productionQuantity: number | null; productionGroupId?: string | null }) => {
    if (!lineItemId || !filesApiPath || (parentType === "order" && !orderId) || (parentType === "quote" && !quoteId)) return;
    try {
      const endpoint = parentType === "order"
        ? `/api/orders/${orderId}/line-items/${lineItemId}/files/${file.id}/artwork-allocation`
        : `/api/quotes/${quoteId}/line-items/${lineItemId}/attachments/${file.id}/artwork-allocation`;
      const response = await fetch(endpoint, {
        method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json?.error || 'Failed to update allocation');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: [filesApiPath] }),
        queryClient.invalidateQueries({
          predicate: (query) => {
            const key = query.queryKey;
            return Array.isArray(key)
              && typeof key[0] === "string"
              && (
                key[0] === "/api/prepress/queue"
                || key[0] === `/api/prepress/line-item/${lineItemId}/files`
                || key[0] === "/api/production/jobs"
                || key[0] === "/api/production/runs"
              );
          },
        }),
      ]);
      const canonicalUpdated = json?.canonicalFinalArtwork?.updated === true;
      toast({
        title: 'Artwork allocation updated',
        description: canonicalUpdated
          ? (json?.allocation?.issue || 'The linked final production artwork was updated.')
          : parentType === "order"
            ? 'Customer artwork allocation saved. Final production artwork remains separately managed in Prepress.'
            : (json?.allocation?.issue || 'Production instruction saved.'),
      });
    } catch (error: any) {
      toast({ title: 'Artwork allocation failed', description: error?.message || 'Please try again.', variant: 'destructive' });
    }
  };

  const updateSavedArtworkSetQuantity = async (setId: string, quantity: number) => {
    if (!orderId || !lineItemId || !filesApiPath) return;
    setArtworkSetPending(true);
    try {
      const response = await fetch(`/api/orders/${orderId}/line-items/${lineItemId}/artwork-sets/${encodeURIComponent(setId)}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productionQuantity: quantity }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json?.error || "Failed to update Artwork Set");
      await queryClient.invalidateQueries({ queryKey: [filesApiPath] });
      toast({ title: "Artwork Set quantity updated", description: `${quantity} finished piece${quantity === 1 ? "" : "s"} will use every file in this set.` });
    } catch (error: any) {
      toast({ title: "Artwork Set update failed", description: error?.message || "Please try again.", variant: "destructive" });
    } finally {
      setArtworkSetPending(false);
    }
  };

  const updateStagedArtworkSetQuantity = (setMemberIds: string[], quantity: number, groupId: string | null) => {
    if (!onTemporaryOrderArtworkSetUpdate) return;
    onTemporaryOrderArtworkSetUpdate(setMemberIds, {
      productionQuantity: quantity,
      productionGroupId: groupId,
      allocationSource: "manual",
    });
  };

  const createArtworkSetFromSelection = async () => {
    const selectedIds = Array.from(new Set(selectedArtworkIds));
    const quantity = Number(newArtworkSetQuantity || lineQuantity);
    if (selectedIds.length < 2) {
      toast({ title: "Select artwork files", description: "Select two or more files that make the same finished output.", variant: "destructive" });
      return;
    }
    if (!Number.isInteger(quantity) || quantity <= 0) {
      toast({ title: "Enter Artwork Set quantity", description: "Qty to produce must be a positive whole number.", variant: "destructive" });
      return;
    }
    if (!orderId) {
      const groupId = `artwork-set:${crypto.randomUUID()}`;
      updateStagedArtworkSetQuantity(selectedIds, quantity, groupId);
      setSelectedArtworkIds([]);
      setNewArtworkSetQuantity("");
      return;
    }
    if (!lineItemId || !filesApiPath) return;
    setArtworkSetPending(true);
    try {
      const response = await fetch(`/api/orders/${orderId}/line-items/${lineItemId}/artwork-sets`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ artworkIds: selectedIds, productionQuantity: quantity }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json?.error || "Failed to create Artwork Set");
      setSelectedArtworkIds([]);
      setNewArtworkSetQuantity("");
      await queryClient.invalidateQueries({ queryKey: [filesApiPath] });
      toast({ title: "Artwork Set created", description: `${quantity} finished piece${quantity === 1 ? "" : "s"} will use all selected files as required layers.` });
    } catch (error: any) {
      toast({ title: "Artwork Set creation failed", description: error?.message || "Please try again.", variant: "destructive" });
    } finally {
      setArtworkSetPending(false);
    }
  };

  const toggleArtworkSetSelection = (id: string, selected: boolean) => {
    setSelectedArtworkIds((current) => selected
      ? Array.from(new Set([...current, id]))
      : current.filter((candidate) => candidate !== id));
  };

  useEffect(() => {
    if (!doubleSided || !useSameArtworkBothSides || artworkAttachments.length !== 1) {
      automaticBothSideAssignmentRef.current = null;
      return;
    }
    const soleArtwork = artworkAttachments[0];
    if (soleArtwork.side === 'both') return;
    const assignmentKey = `${lineItemId}:${soleArtwork.id}`;
    if (automaticBothSideAssignmentRef.current === assignmentKey) return;
    automaticBothSideAssignmentRef.current = assignmentKey;
    void assignArtworkSide(soleArtwork.id, 'both').then((success) => {
      if (!success) automaticBothSideAssignmentRef.current = null;
    });
  }, [doubleSided, useSameArtworkBothSides, artworkAttachments.length, artworkAttachments[0]?.id, artworkAttachments[0]?.side, lineItemId]);
  const viewerAttachments = useMemo(() => toAttachmentViewerAttachments(attachments as any[]), [attachments]);

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
    if (parentType === "order" && !orderId && onTemporaryOrderUpload) {
      setIsUploading(true);
      try {
        await onTemporaryOrderUpload(filesToUpload);
        toast({
          title: "Artwork Uploaded",
          description: `${filesToUpload.length} file${filesToUpload.length !== 1 ? "s" : ""} staged for this new order.`,
        });
      } catch (error: any) {
        toast({
          title: "Upload Failed",
          description: error?.message || "Failed to upload files.",
          variant: "destructive",
        });
      } finally {
        setIsUploading(false);
        clearFileInput();
      }
      return;
    }

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
        try {
          if (parentType === "order") {
            if (!orderId) {
              throw new Error("Order ID is required for order line item uploads.");
            }

            await uploadAttachmentViaChunked({
              file,
              purpose: "order-attachment",
              parentId: orderId,
              linkUrl: uploadApiPath,
              linkBody: {
                orderLineItemId: targetLineItemId,
                role: "artwork",
                side: "na",
              },
            });
          } else {
            if (!targetQuoteId) {
              throw new Error("Quote ID is required for quote line item uploads.");
            }

            await uploadAttachmentViaChunked({
              file,
              purpose: "quote-attachment",
              parentId: targetQuoteId,
              linkUrl: uploadApiPath,
            });
          }

          successCount++;
        } catch (fileError: any) {
          console.error(`[LineItemAttachmentsPanel] Error uploading ${file.name}:`, fileError);
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

      // Invalidation marks the cache stale but does not guarantee that this
      // mounted panel has rendered the permanent attachment before the upload
      // spinner clears. Refetch the exact line query so a confirmed backend
      // link always replaces the transient upload state without a page reload.
      await Promise.all([
        filesApiPath ? queryClient.refetchQueries({ queryKey: [filesApiPath], type: "active" }) : Promise.resolve(),
        parentType === "order" && orderId
          ? queryClient.invalidateQueries({ queryKey: ["/api/orders", orderId] })
          : Promise.resolve(),
      ]);

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

  // Handle file upload
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return;

    const filesToUpload = Array.from(e.target.files);

    await performUpload(filesToUpload);
  };

  // Handle file deletion
  const handleDeleteFile = async (file: LineItemAttachment) => {
    if (!filesApiPath) return;

    try {
      let deleteUrl: string | null = `${filesApiPath}/${file.id}`;

      // Order line-item surfaces must always delete through the line-item endpoint.
      // That backend route correctly handles both:
      // - DB-backed order_attachments rows for this line item
      // - asset-link rows for this line item
      if (parentType === 'order') {
        const targetLineItemId = lineItemId ?? ensuredIdsRef.current.lineItemId;
        if (!orderId || !targetLineItemId) return;
        deleteUrl = `/api/orders/${orderId}/line-items/${targetLineItemId}/files/${file.id}`;
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

      onSavedAttachmentRemoved?.({ id: file.id, fileRecordId: file.fileRecordId ?? null, side: file.side ?? null });

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

  const canRepairArtworkRelationships = parentType === "order" && Boolean(orderId && lineItemId) && ["owner", "admin"].includes(String(user?.role ?? "").toLowerCase());
  const handleRepairArtworkRelationships = async () => {
    if (!orderId || !lineItemId) return;
    setIsRepairingRelationships(true);
    try {
      const response = await fetch(`/api/orders/${orderId}/line-items/${lineItemId}/repair-artwork-relationships`, {
        method: "POST", credentials: "include",
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || "Failed to repair artwork relationships.");
      const result = payload?.data ?? {};
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: [filesApiPath] }),
        queryClient.invalidateQueries({ queryKey: ["/api/orders", orderId] }),
        queryClient.invalidateQueries({ queryKey: ["/api/prepress/queue"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/production/jobs"] }),
      ]);
      toast({ title: "Artwork relationships repaired", description: `${result.retiredRelationshipIds?.length ?? 0} duplicate mirror${(result.retiredRelationshipIds?.length ?? 0) === 1 ? "" : "s"} retired.` });
    } catch (error: any) {
      toast({ title: "Artwork relationship repair failed", description: error?.message || "Please review the relationships manually.", variant: "destructive" });
    } finally {
      setIsRepairingRelationships(false);
    }
  };

  // Handle file download - downloads the ORIGINAL file via proxy endpoint
  // The proxy endpoint uses attachment.fileUrl (original storage key), not thumbKey/previewKey
  const handleDownloadFile = async (fileId: string, fileName: string) => {
    if (!filesApiPath) return;

    try {
      if (parentType === "order") {
        if (!orderId || !lineItemId) return;
        // Match Quote behavior: download through an authenticated route that
        // resolves the canonical file record at click time.  URLs are not
        // durable attachment state and may legitimately be absent.
        const proxyUrl = `/api/orders/${orderId}/line-items/${lineItemId}/files/${fileId}/download/proxy`;
        await downloadAuthenticatedFile(proxyUrl, fileName);
        return;
      }

      // Quote behavior: proxy endpoint streams file with correct filename
      const proxyUrl = `${filesApiPath}/${fileId}/download/proxy`;

      await downloadAuthenticatedFile(proxyUrl, fileName);
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

  const uploadDisabled =
    isUploading ||
    isCreatingQuote ||
    isPersistingLineItem ||
    (!lineItemId && !ensureLineItemId && !onTemporaryOrderUpload);

  const preventArtworkDropNavigation = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
  };

  const handleArtworkDragEnter = (event: React.DragEvent<HTMLDivElement>) => {
    preventArtworkDropNavigation(event);
    if (uploadDisabled) return;
    dragDepthRef.current += 1;
    setIsDragOver(true);
  };

  const handleArtworkDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    preventArtworkDropNavigation(event);
    if (uploadDisabled) return;
    event.dataTransfer.dropEffect = "copy";
    if (!isDragOver) setIsDragOver(true);
  };

  const handleArtworkDragLeave = (event: React.DragEvent<HTMLDivElement>) => {
    preventArtworkDropNavigation(event);
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setIsDragOver(false);
  };

  const handleArtworkDrop = (event: React.DragEvent<HTMLDivElement>) => {
    preventArtworkDropNavigation(event);
    dragDepthRef.current = 0;
    setIsDragOver(false);
    if (uploadDisabled) return;
    const droppedFiles = Array.from(event.dataTransfer.files ?? []);
    if (droppedFiles.length === 0) return;
    void performUpload(droppedFiles);
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
                <span data-testid="line-item-artwork-count">{fileCount}</span>
              </span>
            )}
          </div>
          <div className="flex items-center gap-1">
          {canRepairArtworkRelationships && (
            <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => void handleRepairArtworkRelationships()} disabled={isRepairingRelationships}>
              {isRepairingRelationships ? "Repairing…" : "Repair artwork relationships"}
            </Button>
          )}
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
        </div>

        {/* Upload button - always visible when no files, or when expanded */}
        {(fileCount === 0 || isExpanded) && (
          <div
            className={cn(
              "mt-2 rounded-md border border-dashed p-2 transition-colors",
              isDragOver
                ? "border-primary bg-primary/10 ring-2 ring-primary/20"
                : "border-border/70 bg-background/40",
              uploadDisabled && "opacity-60",
            )}
            data-testid="line-item-artwork-dropzone"
            onDragEnter={handleArtworkDragEnter}
            onDragOver={handleArtworkDragOver}
            onDragLeave={handleArtworkDragLeave}
            onDrop={handleArtworkDrop}
          >
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
              disabled={uploadDisabled}
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
            <p className={cn(
              "mt-1 text-center text-[11px]",
              isDragOver ? "font-medium text-primary" : "text-muted-foreground",
            )}>
              {isDragOver ? "Drop files to add artwork" : "or drag and drop artwork files here"}
            </p>
            {!lineItemId && !ensureLineItemId && !onTemporaryOrderUpload ? (
              <p className="text-xs text-muted-foreground text-center mt-1">
                Save line item to upload artwork
              </p>
            ) : parentType === "quote" && !quoteId && !ensureQuoteId ? (
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
          {(parentType === "order" || parentType === "quote") && productionRows.length > 0 && allocationStatus.requiredQuantity != null && (
            <div className="mt-2 text-xs" data-testid="artwork-allocation-summary" aria-live="polite">
              <div className="font-medium">Assigned {allocationStatus.allocatedTotal} of {allocationStatus.requiredQuantity}</div>
              <div className="text-muted-foreground">
                {allocationStatus.valid
                  ? "Allocation complete"
                  : allocationStatus.allocatedTotal < allocationStatus.requiredQuantity
                    ? `${allocationStatus.requiredQuantity - allocationStatus.allocatedTotal} pieces still need an artwork quantity`
                    : allocationStatus.issue}
              </div>
            </div>
          )}
          {parentType === "order" && displayedArtworkSets.length > 0 && (
            <div className="mt-2 rounded-md border border-sky-400/30 bg-sky-400/5 p-2.5 text-xs" data-testid="artwork-sets">
              <div className="font-medium">Artwork Sets</div>
              <p className="mt-0.5 text-muted-foreground">Each set is one finished output. All files in a set are required layers; Qty is counted once per set.</p>
              <div className="mt-2 space-y-1.5">
                {displayedArtworkSets.map((set, index) => {
                  const members = set.memberIds.map((id) => displayedArtworkMembers.find((member) => member.id === id)).filter(Boolean) as Array<{ id: string; fileName: string }>;
                  const quantity = set.quantity ?? "";
                  const saveQuantity = (raw: string) => {
                    const nextQuantity = Number(raw);
                    if (!Number.isInteger(nextQuantity) || nextQuantity <= 0) return;
                    if (orderId) {
                      if (set.explicit) {
                        void updateSavedArtworkSetQuantity(set.id, nextQuantity);
                      } else {
                        const file = productionRows.find((candidate) => candidate.id === set.memberIds[0]);
                        if (file) void updateArtworkAllocation(file, { role: "artwork", productionQuantity: nextQuantity, productionGroupId: null });
                      }
                    } else {
                      updateStagedArtworkSetQuantity(set.memberIds, nextQuantity, set.explicit ? set.id : null);
                    }
                  };
                  return (
                    <div key={set.id} className="flex flex-wrap items-center gap-2 rounded border border-border/60 bg-background/60 px-2 py-1.5">
                      <div className="min-w-0 flex-1">
                        <div className="font-medium">Artwork Set {index + 1}{set.memberIds.length > 1 ? ` · ${set.memberIds.length} required layers` : ""}</div>
                        <div className="truncate text-[11px] text-muted-foreground">{members.map((member) => member.fileName).join(" · ")}</div>
                      </div>
                      <label className="grid shrink-0 gap-0.5 text-[10px] text-muted-foreground">
                        Qty to produce
                        <input
                          className="h-7 w-20 rounded border bg-background px-1 text-xs text-foreground"
                          type="number"
                          min="1"
                          step="1"
                          inputMode="numeric"
                          aria-label={`Qty to produce for Artwork Set ${index + 1}`}
                          defaultValue={quantity}
                          disabled={artworkSetPending}
                          onBlur={(event) => saveQuantity(event.currentTarget.value.trim())}
                        />
                      </label>
                    </div>
                  );
                })}
              </div>
              {displayedArtworkMembers.filter((member) => !member.productionGroupId?.trim()).length >= 2 && (
                <div className="mt-2 flex flex-wrap items-end gap-2 border-t border-border/60 pt-2">
                  <label className="grid gap-0.5 text-[10px] text-muted-foreground">
                    New set Qty to produce
                    <input
                      className="h-7 w-24 rounded border bg-background px-1 text-xs text-foreground"
                      type="number"
                      min="1"
                      step="1"
                      inputMode="numeric"
                      placeholder={lineQuantity ? String(lineQuantity) : "Qty"}
                      value={newArtworkSetQuantity}
                      onChange={(event) => setNewArtworkSetQuantity(event.currentTarget.value)}
                      disabled={artworkSetPending}
                    />
                  </label>
                  <Button type="button" size="sm" variant="outline" disabled={selectedArtworkIds.length < 2 || artworkSetPending} onClick={() => void createArtworkSetFromSelection()}>
                    Group selected as same finished output
                  </Button>
                  <span className="text-[11px] text-muted-foreground">Select ungrouped files below, then give the set one finished-piece quantity.</span>
                </div>
              )}
            </div>
          )}
          {parentType === 'order' && doubleSided && orderId && artworkAttachments.length > 0 && (
            <div className="mt-2 rounded-md border border-violet-400/30 bg-violet-400/5 p-2.5 space-y-2" data-testid="order-double-sided-artwork-assignment">
              <label className="flex items-center gap-2 text-xs font-medium cursor-pointer">
                <Checkbox
                  checked={useSameArtworkBothSides}
                  onCheckedChange={(checked) => {
                    const next = checked === true;
                    setUncontrolledUseSameArtworkBothSides(next);
                    onUseSameArtworkBothSidesChange?.(next);
                    if (!next && sharedArtwork) void assignArtworkSide(sharedArtwork.id, 'front');
                    if (next && artworkAttachments.length > 1 && frontArtwork) void assignArtworkSide(frontArtwork.id, 'both');
                  }}
                  data-testid="order-use-same-artwork-both-sides"
                />
                Use same artwork on both sides
              </label>
              <div className="grid gap-2 sm:grid-cols-2">
                <label className="text-xs text-muted-foreground">
                  Front artwork
                  <select
                    className="mt-1 h-8 w-full rounded-md border bg-background px-2 text-xs text-foreground"
                    value={(useSameArtworkBothSides ? (sharedArtwork ?? frontArtwork) : frontArtwork)?.id ?? ''}
                    onChange={(event) => event.target.value && void assignArtworkSide(event.target.value, useSameArtworkBothSides ? 'both' : 'front')}
                    data-testid="order-front-artwork-select"
                  >
                    <option value="">Front artwork not assigned</option>
                    {artworkAttachments.map((file) => <option key={file.id} value={file.id}>{getAttachmentDisplayName(file)}</option>)}
                  </select>
                </label>
                {!useSameArtworkBothSides && (
                  <label className="text-xs text-muted-foreground">
                    Back artwork
                    <select
                      className="mt-1 h-8 w-full rounded-md border bg-background px-2 text-xs text-foreground"
                      value={backArtwork?.id ?? ''}
                      onChange={(event) => event.target.value && void assignArtworkSide(event.target.value, 'back')}
                      data-testid="order-back-artwork-select"
                    >
                      <option value="">Back artwork not assigned</option>
                      {artworkAttachments.map((file) => <option key={file.id} value={file.id}>{getAttachmentDisplayName(file)}</option>)}
                    </select>
                  </label>
                )}
              </div>
              {!useSameArtworkBothSides && !backArtwork && <p className="text-xs text-amber-700">Back artwork not assigned. Choose the same artwork for both sides or assign a Back file.</p>}
              {useSameArtworkBothSides && artworkAttachments.length > 1 && !sharedArtwork && (
                <p className="text-xs text-amber-700">Choose which artwork file should be used on both sides.</p>
              )}
            </div>
          )}
          {pendingOrderAttachments.length > 0 && (
            <div className="space-y-2 pt-2" data-testid="staged-artwork-allocation">
              {pendingOrderAttachments.map((file) => (
                <div key={file.uploadId} className="flex items-center gap-2 p-1.5 rounded bg-background">
                  <File className="w-4 h-4 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-medium truncate">{file.fileName}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {formatFileSize(file.sizeBytes)} · staged
                    </div>
                    {file.allocationSource === "automatic" && (
                      <div className="text-[11px] text-muted-foreground">Auto-filled from line quantity</div>
                    )}
                  </div>
                  {!file.productionGroupId?.trim() && onTemporaryOrderArtworkSetUpdate ? (
                    <label className="flex shrink-0 items-center gap-1 text-[10px] text-muted-foreground">
                      <Checkbox
                        checked={selectedArtworkIds.includes(file.uploadId)}
                        onCheckedChange={(checked) => toggleArtworkSetSelection(file.uploadId, checked === true)}
                        aria-label={`Select staged artwork ${file.fileName} for an Artwork Set`}
                      />
                      Set
                    </label>
                  ) : null}
                  {onTemporaryOrderAttachmentRemove ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 shrink-0 p-0 text-destructive hover:text-destructive"
                      aria-label={`Remove staged artwork ${file.fileName}`}
                      title="Remove staged artwork"
                      onPointerDownCapture={(event) => event.stopPropagation()}
                      onClick={(event) => {
                        event.stopPropagation();
                        onTemporaryOrderAttachmentRemove(file.uploadId);
                      }}
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  ) : null}
                </div>
              ))}
              {stagedAllocationStatus.requiredQuantity != null && (
                <div className="rounded border border-border/70 bg-muted/20 px-2 py-1.5 text-xs" aria-live="polite">
                  <div className="font-medium">Artwork allocation: Assigned {stagedAllocationStatus.allocatedTotal} of {stagedAllocationStatus.requiredQuantity}</div>
                  <div className="text-muted-foreground">
                    {stagedAllocationStatus.valid
                      ? "Allocation complete"
                      : stagedAllocationStatus.allocatedTotal < stagedAllocationStatus.requiredQuantity
                        ? `Remaining ${stagedAllocationStatus.requiredQuantity - stagedAllocationStatus.allocatedTotal}`
                        : stagedAllocationStatus.issue}
                  </div>
                </div>
              )}
            </div>
          )}
          {/* File list */}
          {isLoading && attachments.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-2">Loading...</p>
          ) : attachments.length > 0 ? (
            <div className="space-y-1">
              {attachments.map((file, fileIndex) => {
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
                const isPending = !isAttachmentSettled(file as any);
                const fileName = getAttachmentDisplayName(file);
                const pageCount = getPdfPageCount(file);
                const showPageCount = isPdf && pageCount !== null && pageCount > 1;
                const openPreview = () => setPreviewIndex(fileIndex);
                
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
                        openPreview();
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
                          <>
                            <FileIcon className="w-5 h-5 text-muted-foreground pointer-events-none select-none" />
                            {isPending && (
                              <div className="absolute -top-0.5 -right-0.5 rounded-full bg-amber-500/90 p-0.5" title="Generating thumbnail...">
                                <Loader2 className="h-2.5 w-2.5 animate-spin text-white" />
                              </div>
                            )}
                          </>
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
                        {file.thumbStatus && file.thumbStatus !== 'uploaded' && !hasAnyThumbnail && (() => {
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
                              {file.thumbStatus === 'thumb_pending' && (isPdf ? '⏳ PDF thumbnail processing...' : '⏳ Generating...')}
                              {file.thumbStatus === 'thumb_failed' && isLocalMissing && 'Preview unavailable (Local dev file not on this machine)'}
                              {file.thumbStatus === 'thumb_failed' && isUnavailable && 'Thumbnails temporarily unavailable'}
                              {file.thumbStatus === 'thumb_failed' && !isUnavailable && !isLocalMissing && '✗ Generation failed'}
                            </span>
                          );
                        })()}
                      </div>
                      {(parentType === "order" || parentType === "quote") && (
                        <div className="flex shrink-0 items-center gap-1.5" onClick={(event) => event.stopPropagation()}>
                          <select
                            className="h-7 rounded border bg-background px-1 text-[10px]"
                            aria-label={`Artwork role for ${fileName}`}
                            value={(file.role ?? file.productionRole) === 'reference' ? 'reference' : 'artwork'}
                            onChange={(event) => void updateArtworkAllocation(file, {
                              role: event.target.value as 'artwork' | 'reference',
                              productionQuantity: event.target.value === 'reference' ? null : file.productionQuantity ?? null,
                              productionGroupId: event.target.value === 'reference' ? null : file.productionGroupId ?? null,
                            })}
                          >
                            <option value="artwork">Production</option>
                            <option value="reference">Reference</option>
                          </select>
                          {(file.role ?? file.productionRole) !== 'reference' && (parentType === "order" ? (
                            !file.productionGroupId?.trim() ? (
                              <label className="flex items-center gap-1 text-[10px] text-muted-foreground">
                                <Checkbox
                                  checked={selectedArtworkIds.includes(file.id)}
                                  onCheckedChange={(checked) => toggleArtworkSetSelection(file.id, checked === true)}
                                  aria-label={`Select ${fileName} for an Artwork Set`}
                                />
                                Set
                              </label>
                            ) : <span className="text-[10px] text-muted-foreground">Set layer</span>
                          ) : (
                            <input
                              className="h-7 w-16 rounded border bg-background px-1 text-[10px]"
                              type="number" min="1" step="1" inputMode="numeric"
                              aria-label={`Production quantity for ${fileName}`}
                              defaultValue={file.productionQuantity ?? ''}
                              placeholder="Qty"
                              onBlur={(event) => {
                                const value = event.currentTarget.value.trim();
                                void updateArtworkAllocation(file, { role: 'artwork', productionQuantity: value ? Number(value) : null, productionGroupId: file.productionGroupId ?? null });
                              }}
                            />
                          ))}
                        </div>
                      )}
                      <div className="flex gap-0.5 shrink-0">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 w-6 p-0"
                          aria-label={`Preview ${fileName}`}
                          title="Open preview"
                          onPointerDownCapture={(e) => e.stopPropagation()}
                          onClick={(e) => {
                            e.stopPropagation();
                            openPreview();
                          }}
                        >
                          <Eye className="w-3 h-3" />
                        </Button>
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
                          aria-label={`Remove saved artwork ${fileName}`}
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
          ) : pendingOrderAttachments.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-2">
              No artwork attached
            </p>
          ) : null}
        </div>
      )}

      <AttachmentViewerDialog
        attachments={viewerAttachments}
        initialIndex={previewIndex ?? 0}
        open={previewIndex !== null}
        hideFilmstrip={false}
        showMetaPanel={true}
        onOpenChange={(open) => {
          if (!open) setPreviewIndex(null);
        }}
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
