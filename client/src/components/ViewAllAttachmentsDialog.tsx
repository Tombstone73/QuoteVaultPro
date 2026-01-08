import { useState, useMemo } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Search, Download, FileText, Image as ImageIcon, Trash2 } from "lucide-react";
import { getThumbSrc } from "@/lib/getThumbSrc";
import { format } from "date-fns";

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
}: ViewAllAttachmentsDialogProps) {
  const [searchQuery, setSearchQuery] = useState("");

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

  const renderAttachment = (a: AttachmentWithContext) => {
    const displayName = a.originalFilename || a.fileName;
    const thumbSrc = getThumbSrc(a);
    const isPdf = a.mimeType?.toLowerCase().includes("pdf") || displayName.toLowerCase().endsWith(".pdf");

    return (
      <div
        key={a.id}
        className="flex items-center gap-3 p-3 rounded-md border border-border hover:bg-muted/50 cursor-pointer transition-colors"
        onClick={() => onViewAttachment(a)}
      >
        {/* Thumbnail or icon */}
        <div className="w-16 h-16 shrink-0 flex items-center justify-center bg-muted rounded overflow-hidden">
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
        <div className="flex-1 min-w-0">
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

        {/* Search + Download All */}
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
          {onDownloadAll && allAttachments.length > 0 && (
            <Button onClick={onDownloadAll} variant="outline" size="sm">
              <Download className="w-4 h-4 mr-2" />
              Download all (zip)
            </Button>
          )}
        </div>

        {/* Tabs: Order vs Line Items */}
        <Tabs defaultValue="all" className="flex-1 flex flex-col min-h-0">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="all">
              All ({orderAttachments.length + lineItemAttachments.length})
            </TabsTrigger>
            <TabsTrigger value="order">Order ({orderAttachments.length})</TabsTrigger>
            <TabsTrigger value="line-items">Line Items ({lineItemAttachments.length})</TabsTrigger>
          </TabsList>

          <TabsContent value="all" className="flex-1 overflow-y-auto mt-4 space-y-2">
            {allAttachments.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">No attachments</div>
            ) : searchQuery && filteredOrderAttachments.length === 0 && filteredLineItemAttachments.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">No matches for "{searchQuery}"</div>
            ) : (
              <>
                {filteredOrderAttachments.map(renderAttachment)}
                {filteredLineItemAttachments.map(renderAttachment)}
              </>
            )}
          </TabsContent>

          <TabsContent value="order" className="flex-1 overflow-y-auto mt-4 space-y-2">
            {filteredOrderAttachments.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                {searchQuery ? `No matches for "${searchQuery}"` : "No order attachments"}
              </div>
            ) : (
              filteredOrderAttachments.map(renderAttachment)
            )}
          </TabsContent>

          <TabsContent value="line-items" className="flex-1 overflow-y-auto mt-4 space-y-2">
            {filteredLineItemAttachments.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                {searchQuery ? `No matches for "${searchQuery}"` : "No line item attachments"}
              </div>
            ) : (
              filteredLineItemAttachments.map(renderAttachment)
            )}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
