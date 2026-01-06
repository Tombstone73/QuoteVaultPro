import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FileText } from "lucide-react";
import { isPdfAttachment } from "@/lib/attachments";
import { getThumbSrc } from "@/lib/getThumbSrc";

type LineItemThumbnailProps = {
  /** Either quoteId (for quotes) or orderId (for orders) */
  parentId: string | null;
  /** The line item ID */
  lineItemId: string | undefined;
  /** Type of parent entity */
  parentType: "quote" | "order";
  /** Optional: Pass attachments to avoid fetching (prevents N+1 queries) */
  attachments?: AttachmentData[] | null;
  /** Optional: Show placeholder only without fetching (for lists) */
  placeholderOnly?: boolean;
};

type AttachmentData = {
  id: string;
  fileName?: string;
  mimeType?: string | null;
  thumbUrl?: string | null;
  previewUrl?: string | null;
  originalUrl?: string | null;
  thumbnailUrl?: string | null;
  previewThumbnailUrl?: string | null;
  pages?: Array<{ thumbUrl?: string | null }>;
};

/**
 * Reusable line item thumbnail component for Quote and Order lists.
 * Shows first attachment thumbnail or file icon placeholder.
 */
export function LineItemThumbnail({ 
  parentId, 
  lineItemId, 
  parentType,
  attachments: providedAttachments,
  placeholderOnly = false
}: LineItemThumbnailProps) {
  const [imageError, setImageError] = useState(false);

  const isRenderableUrl = (value: unknown): value is string => {
    if (typeof value !== "string") return false;
    if (value.startsWith("http://") || value.startsWith("https://")) return true;
    // Local storage proxy
    if (value.startsWith("/objects/")) return true;
    return false;
  };

  // Build API path based on parent type
  const filesApiPath = parentId
    ? parentType === "quote"
      ? `/api/quotes/${parentId}/line-items/${lineItemId}/files`
      : `/api/orders/${parentId}/line-items/${lineItemId}/files`
    : `/api/line-items/${lineItemId}/files`;

  // Only fetch if attachments not provided AND not placeholder-only mode
  const shouldFetch = !providedAttachments && !placeholderOnly && !!lineItemId;

  const { data: fetchedAttachments = [] } = useQuery<AttachmentData[]>({
    queryKey: [filesApiPath],
    queryFn: async () => {
      const response = await fetch(filesApiPath, { credentials: "include" });
      if (!response.ok) return [];
      const json = await response.json();
      const data = (json?.data || []) as AttachmentData[];
      const assets = (json?.assets || []) as AttachmentData[];
      return [...data, ...assets];
    },
    enabled: shouldFetch,
    // Fail soft: don't log errors to console
    retry: false,
    meta: { suppressErrorToast: true },
  });

  // Use provided attachments if available, otherwise use fetched
  const attachments = providedAttachments ?? fetchedAttachments;

  // Find first attachment with a thumbnail URL (using unified helper)
  const first = attachments.find((a) => !!getThumbSrc(a)) ?? attachments[0] ?? null;

  // No attachments - show placeholder
  if (!first) {
    return (
      <div className="h-11 w-11 rounded-md border border-border/60 bg-muted/30 overflow-hidden shrink-0 flex items-center justify-center">
        <FileText className="h-5 w-5 text-muted-foreground" />
      </div>
    );
  }

  const isPdf = isPdfAttachment(first);
  const thumbSrc = !imageError ? getThumbSrc(first) : null;

  const devTitle =
    import.meta.env.DEV && !thumbSrc
      ? `No preview URL found. fields: previewUrl=${String((first as any)?.previewUrl ?? "")}, thumbUrl=${String(
          (first as any)?.thumbUrl ?? ""
        )}, originalUrl=${String((first as any)?.originalUrl ?? "")}`
      : undefined;

  return (
    <div
      className="h-11 w-11 rounded-md border border-border/60 bg-muted/30 overflow-hidden shrink-0"
      title={devTitle}
    >
      {thumbSrc ? (
        <img
          src={thumbSrc}
          alt=""
          className="h-full w-full object-cover"
          onError={() => setImageError(true)}
        />
      ) : (
        <div className="h-full w-full flex items-center justify-center relative">
          <FileText className="h-5 w-5 text-muted-foreground" />
          {isPdf && (
            <div className="absolute bottom-1 right-1 rounded-sm bg-background/70 px-1 py-0.5 text-[10px] font-semibold text-foreground">
              PDF
            </div>
          )}
        </div>
      )}
    </div>
  );
}