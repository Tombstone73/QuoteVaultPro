import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FileText } from "lucide-react";
import { isValidHttpUrl } from "@/lib/utils";

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
  originalUrl?: string | null;
  pages?: Array<{ thumbUrl?: string | null }>;
};

/**
 * Extract PDF thumbnail URL from attachment data
 */
function getPdfThumbUrl(attachment: AttachmentData): string | null {
  if (!attachment) return null;
  // Prefer first page thumbnail
  const firstPage = attachment.pages?.[0];
  if (firstPage?.thumbUrl && isValidHttpUrl(firstPage.thumbUrl)) {
    return firstPage.thumbUrl;
  }
  // Fallback to attachment-level thumbUrl
  if (attachment.thumbUrl && isValidHttpUrl(attachment.thumbUrl)) {
    return attachment.thumbUrl;
  }
  return null;
}

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
      return json.data || [];
    },
    enabled: shouldFetch,
    // Fail soft: don't log errors to console
    retry: false,
    meta: { suppressErrorToast: true },
  });

  // Use provided attachments if available, otherwise use fetched
  const attachments = providedAttachments ?? fetchedAttachments;
  const first = attachments[0];

  // No attachments - show placeholder
  if (!first) {
    return (
      <div className="h-11 w-11 rounded-md border border-border/60 bg-muted/30 overflow-hidden shrink-0 flex items-center justify-center">
        <FileText className="h-5 w-5 text-muted-foreground" />
      </div>
    );
  }

  const isImage = first?.mimeType?.startsWith?.("image/");
  const isPdf =
    first?.mimeType === "application/pdf" ||
    (first?.fileName || "").toLowerCase().endsWith(".pdf");

  // Determine image URL - ONLY use signed URLs from server
  let imageUrl: string | null = null;
  if (!imageError && first) {
    if (isImage) {
      // Only use signed URLs - thumbUrl or originalUrl (both from server)
      const candidateUrl = first?.thumbUrl || first?.originalUrl;
      if (
        candidateUrl &&
        typeof candidateUrl === "string" &&
        candidateUrl.startsWith("http")
      ) {
        imageUrl = candidateUrl;
      }
    } else if (isPdf) {
      imageUrl = getPdfThumbUrl(first);
    }
  }

  return (
    <div className="h-11 w-11 rounded-md border border-border/60 bg-muted/30 overflow-hidden shrink-0">
      {imageUrl ? (
        <img
          src={imageUrl}
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
