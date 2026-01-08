import { useState, useMemo } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { Search, Download, FileText, Image as ImageIcon, Trash2, Loader2 } from "lucide-react";
import { getThumbSrc } from "@/lib/getThumbSrc";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";

type AttachmentWithContext = {
  id: string;
  fileName: string;
  originalFilename?: string | null;
  fileSize?: number | null;
  mimeType?: string | null;
  createdAt: string;
  uploadedByName?: string | null;
  originalUrl?: string | null;
  previewThumbnailUrl?: string | null;
  thumbnailUrl?: string | null;
  thumbUrl?: string | null;
  previewUrl?: string | null;
  objectPath?: string | null;
  pages?: any[];
  source: "order" | "line-item";
  lineItemLabel?: string | null;
  orderId?: string | null;
};

interface ViewAllAttachmentsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orderAttachments: AttachmentWithContext[];
  lineItemAttachments: AttachmentWithContext[];
  onViewAttachment: (attachment: AttachmentWithContext) => void;
  onDownloadAll?: () => void;
  onDownload?: (attachment: AttachmentWithContext) => void;
  onDeleteAttachment?: (attachment: AttachmentWithContext) => void;
  canDelete?: boolean;
  orderId?: string | null;
  parentType?: "order" | "quote";
}

function formatFileSize(bytes: number | null | undefined): string {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function ViewAllAttachmentsDialog({
  open,
  onOpenChange,
  orderAttachments,
  lineItemAttachments,
  onViewAttachment,
  onDeleteAttachment,
  onDownloadAll,
  onDownload,
  canDelete = true,
  orderId,
  parentType = "order",
}: ViewAllAttachmentsDialogProps) {
  const { toast } = useToast();
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isDownloadingSelected, setIsDownloadingSelected] = useState(false);
  const [isDownloadingAll, setIsDownloadingAll] = useState(false);

  const allAttachments = useMemo(() => {
    return [...orderAttachments, ...lineItemAttachments];
  }, [orderAttachments, lineItemAttachments]);

  const filteredOrderAttachments = useMemo(() => {
    if (!searchQuery.trim()) return orderAttachments;
    const q = searchQuery.toLowerCase();
    return orderAttachments.filter(
      (a) =>
        (a.originalFilename || a.fileName).toLowerCase().includes(q) ||
        a.mimeType?.toLowerCase().includes(q)
    );
  }, [orderAttachments, searchQuery]);

  const filteredLineItemAttachments = useMemo(() => {
    if (!searchQuery.trim()) return lineItemAttachments;
    const q = searchQuery.toLowerCase();
    return lineItemAttachments.filter(
      (a) =>
        (a.originalFilename || a.fileName).toLowerCase().includes(q) ||
        a.mimeType?.toLowerCase().includes(q) ||
        a.lineItemLabel?.toLowerCase().includes(q)
    );
  }, [lineItemAttachments, searchQuery]);

  // Get all visible attachments for the current tab (for Select All)
  const getVisibleAttachments = (activeTab: string) => {
    if (activeTab === "all") {
      return [...filteredOrderAttachments, ...filteredLineItemAttachments];
    } else if (activeTab === "order") {
      return filteredOrderAttachments;
    } else {
      return filteredLineItemAttachments;
    }
  };

  // Check if all visible attachments are selected
  const allVisibleSelected = (activeTab: string) => {
    const visible = getVisibleAttachments(activeTab);
    if (visible.length === 0) return false;
    return visible.every((a) => selectedIds.has(a.id));
  };

  // Toggle select all visible
  const toggleSelectAll = (activeTab: string) => {
    const visible = getVisibleAttachments(activeTab);
    const allSelected = allVisibleSelected(activeTab);
    
    if (allSelected) {
      // Deselect all visible
      setSelectedIds((prev) => {
        const next = new Set(prev);
        visible.forEach((a) => next.delete(a.id));
        return next;
      });
    } else {
      // Select all visible
      setSelectedIds((prev) => {
        const next = new Set(prev);
        visible.forEach((a) => next.add(a.id));
        return next;
      });
    }
  };

  // Toggle individual selection
  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  // Download selected as zip
  const handleDownloadSelected = async () => {
    if (selectedIds.size === 0) {
      toast({
        title: "No Selection",
        description: "Please select at least one attachment to download.",
        variant: "destructive",
      });
      return;
    }
    
    setIsDownloadingSelected(true);

    try {
      const selectedArray = Array.from(selectedIds);
      // TEMP DEBUG
      console.info("[AttachmentsZip] sending attachmentIds", selectedArray);
      const response = await fetch('/api/attachments/zip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ attachmentIds: selectedArray, intent: 'original' }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to download zip');
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `selected-attachments-${Date.now()}.zip`;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      toast({
        title: "Download Complete",
        description: `Downloaded ${selectedIds.size} attachment${selectedIds.size === 1 ? '' : 's'}.`,
      });
    } catch (error: any) {
      console.error('[ViewAllAttachmentsDialog] Download selected error:', error);
      toast({
        title: "Download Failed",
        description: error?.message || "Failed to download selected attachments.",
        variant: "destructive",
      });
    } finally {
      setIsDownloadingSelected(false);
    }
  };

  // Download all (modal scope)
  const handleDownloadAllZip = async () => {
    if (!orderId || allAttachments.length === 0) {
      if (onDownloadAll) {
        onDownloadAll();
      }
      return;
    }

    setIsDownloadingAll(true);

    try {
      const response = await fetch('/api/attachments/zip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          scope: 'modal',
          parentType,
          parentId: orderId,
          intent: 'original',
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to download zip');
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${parentType}-${orderId}-attachments.zip`;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      toast({
        title: "Download Complete",
        description: `Downloaded all ${allAttachments.length} attachment${allAttachments.length === 1 ? '' : 's'}.`,
      });
    } catch (error: any) {
      console.error('[ViewAllAttachmentsDialog] Download all error:', error);
      toast({
        title: "Download Failed",
        description: error?.message || "Failed to download all attachments.",
        variant: "destructive",
      });
    } finally {
      setIsDownloadingAll(false);
    }
  };

  const renderAttachment = (a: AttachmentWithContext, activeTab: string) => {
    const displayName = a.originalFilename || a.fileName;
    const thumbSrc = getThumbSrc(a);
    const isPdf = a.mimeType?.toLowerCase().includes("pdf") || displayName.toLowerCase().endsWith(".pdf");
    const isSelected = selectedIds.has(a.id);

    return (
      <div
        key={a.id}
        className="flex items-center gap-3 p-3 rounded-md border border-border hover:bg-muted/50 transition-colors"
      >
        {/* Checkbox */}
        <Checkbox
          checked={isSelected}
          onCheckedChange={() => toggleSelect(a.id)}
          onClick={(e) => e.stopPropagation()}
          aria-label={`Select ${displayName}`}
        />

        {/* Thumbnail or icon */}
        <div
          className="w-16 h-16 shrink-0 flex items-center justify-center bg-muted rounded overflow-hidden cursor-pointer"
          onClick={() => onViewAttachment(a)}
        >
          {thumbSrc ? (
            <img src={thumbSrc} alt={displayName} className="w-full h-full object-cover" />
          ) : (
            <>
              {isPdf ? (
                <FileText className="w-8 h-8 text-muted-foreground" />
              ) : (
                <ImageIcon className="w-8 h-8 text-muted-foreground" />
              )}
            </>
          )}
        </div>

        {/* File info */}
        <div
          className="flex-1 min-w-0 cursor-pointer"
          onClick={() => onViewAttachment(a)}
        >
          <div className="font-medium truncate">{displayName}</div>
          <div className="text-xs text-muted-foreground space-y-0.5">
            {a.lineItemLabel && (
              <div className="truncate">
                <span className="font-medium">Line Item:</span> {a.lineItemLabel}
              </div>
            )}
            <div>
              {a.mimeType || "Unknown type"} • {formatFileSize(a.fileSize)}
            </div>
            <div>
              {a.createdAt ? format(new Date(a.createdAt), "MMM d, yyyy p") : "—"}
              {a.uploadedByName ? ` • ${a.uploadedByName}` : ""}
            </div>
          </div>
        </div>

        {/* Delete button (only for order attachments) */}
        {canDelete && a.source === "order" && onDeleteAttachment && (
          <Button
            variant="ghost"
            size="sm"
            className="shrink-0"
            onClick={(e) => {
              e.stopPropagation();
              onDeleteAttachment(a);
            }}
            title="Delete attachment"
          >
            <Trash2 className="w-4 h-4 text-destructive" />
          </Button>
        )}

        {/* Download button */}
        {onDownload && (
          <Button
            variant="outline"
            size="sm"
            className="shrink-0"
            onClick={(e) => {
              e.stopPropagation();
              onDownload(a);
            }}
            title="Download attachment"
          >
            <Download className="w-4 h-4" />
          </Button>
        )}
      </div>
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>All Attachments ({allAttachments.length})</DialogTitle>
          <DialogDescription>View and download all order and line item attachments</DialogDescription>
        </DialogHeader>

        {/* Search + Bulk Actions */}
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search by filename or type..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>
          <Button
            onClick={handleDownloadSelected}
            variant="default"
            size="sm"
            disabled={selectedIds.size === 0 || isDownloadingSelected || isDownloadingAll}
          >
            {isDownloadingSelected ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Downloading...
              </>
            ) : (
              <>
                <Download className="w-4 h-4 mr-2" />
                Download selected ({selectedIds.size})
              </>
            )}
          </Button>
          {allAttachments.length > 0 && (
            <Button
              onClick={orderId ? handleDownloadAllZip : onDownloadAll}
              variant="outline"
              size="sm"
              disabled={isDownloadingSelected || isDownloadingAll}
            >
              {isDownloadingAll ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Downloading...
                </>
              ) : (
                <>
                  <Download className="w-4 h-4 mr-2" />
                  Download all
                </>
              )}
            </Button>
          )}
        </div>

        {/* Tabs: Order vs Line Items */}
        <Tabs defaultValue="all" className="flex-1 flex flex-col min-h-0">
          <div className="flex items-center gap-2 mb-2">
            <TabsList className="grid flex-1 grid-cols-3">
              <TabsTrigger value="all">
                All ({orderAttachments.length + lineItemAttachments.length})
              </TabsTrigger>
              <TabsTrigger value="order">Order ({orderAttachments.length})</TabsTrigger>
              <TabsTrigger value="line-items">Line Items ({lineItemAttachments.length})</TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="all" className="flex-1 overflow-y-auto mt-2 space-y-2">
            <div className="flex items-center gap-2 mb-2 px-1">
              <Checkbox
                checked={allVisibleSelected("all")}
                onCheckedChange={() => toggleSelectAll("all")}
                aria-label="Select all visible"
              />
              <span className="text-sm text-muted-foreground">Select all visible</span>
            </div>
            {allAttachments.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">No attachments</div>
            ) : searchQuery && filteredOrderAttachments.length === 0 && filteredLineItemAttachments.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">No matches for "{searchQuery}"</div>
            ) : (
              <>
                {filteredOrderAttachments.map((a) => renderAttachment(a, "all"))}
                {filteredLineItemAttachments.map((a) => renderAttachment(a, "all"))}
              </>
            )}
          </TabsContent>

          <TabsContent value="order" className="flex-1 overflow-y-auto mt-2 space-y-2">
            <div className="flex items-center gap-2 mb-2 px-1">
              <Checkbox
                checked={allVisibleSelected("order")}
                onCheckedChange={() => toggleSelectAll("order")}
                aria-label="Select all visible"
              />
              <span className="text-sm text-muted-foreground">Select all visible</span>
            </div>
            {filteredOrderAttachments.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                {searchQuery ? `No matches for "${searchQuery}"` : "No order attachments"}
              </div>
            ) : (
              filteredOrderAttachments.map((a) => renderAttachment(a, "order"))
            )}
          </TabsContent>

          <TabsContent value="line-items" className="flex-1 overflow-y-auto mt-2 space-y-2">
            <div className="flex items-center gap-2 mb-2 px-1">
              <Checkbox
                checked={allVisibleSelected("line-items")}
                onCheckedChange={() => toggleSelectAll("line-items")}
                aria-label="Select all visible"
              />
              <span className="text-sm text-muted-foreground">Select all visible</span>
            </div>
            {filteredLineItemAttachments.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                {searchQuery ? `No matches for "${searchQuery}"` : "No line item attachments"}
              </div>
            ) : (
              filteredLineItemAttachments.map((a) => renderAttachment(a, "line-items"))
            )}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
