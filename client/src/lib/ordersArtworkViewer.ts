import type { AttachmentData } from "@/components/AttachmentViewerDialog";

export type OrdersArtworkViewerTarget = {
  attachmentId?: string | null;
  thumbnailUrl?: string | null;
};

function normalizedUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed, window.location.origin);
    // Preview endpoints may receive a freshly signed URL on each request.
    // The stable resource identity is its path plus the display variant, not
    // an expiring signature/query token.
    const variant = url.searchParams.get("variant");
    return `${url.pathname}${variant ? `?variant=${variant}` : ""}`;
  } catch {
    return trimmed;
  }
}

/** Selects the exact file represented by an Orders-list thumbnail. */
export function resolveOrdersArtworkViewerIndex(
  attachments: AttachmentData[],
  target: OrdersArtworkViewerTarget = {},
): number {
  if (!attachments.length) return 0;

  const requestedId = String(target.attachmentId || "").trim();
  if (requestedId) {
    const matchingId = attachments.findIndex((attachment) =>
      [attachment.id, (attachment as any).attachmentId, (attachment as any).fileId]
        .some((value) => String(value || "").trim() === requestedId),
    );
    if (matchingId >= 0) return matchingId;
  }

  const requestedThumbnail = normalizedUrl(target.thumbnailUrl);
  if (requestedThumbnail) {
    const matchingThumbnail = attachments.findIndex((attachment) =>
      [
        attachment.thumbUrl,
        attachment.previewUrl,
        attachment.fileUrl,
        attachment.originalUrl,
        (attachment as any).thumbnailUrl,
        (attachment as any).previewThumbnailUrl,
      ].some((value) => normalizedUrl(value) === requestedThumbnail),
    );
    if (matchingThumbnail >= 0) return matchingThumbnail;
  }

  return 0;
}
