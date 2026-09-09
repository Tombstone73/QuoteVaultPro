import type { AttachmentData } from "@/components/AttachmentViewerDialog";

export type OrdersArtworkViewerTarget = {
  /** Canonical file identity. Always preferred over relationship ids or URLs. */
  fileRecordId?: string | null;
  /** Canonical line-item artwork relationship, retained for diagnostic/fallback matching. */
  artworkId?: string | null;
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

  const requestedFileRecordId = String(target.fileRecordId || "").trim();
  if (requestedFileRecordId) {
    const matchingFileRecord = attachments.findIndex((attachment) =>
      String(attachment.fileRecordId || "").trim() === requestedFileRecordId,
    );
    if (matchingFileRecord >= 0) return matchingFileRecord;
  }

  const requestedId = String(target.attachmentId || "").trim();
  const requestedArtworkId = String(target.artworkId || "").trim();
  if (requestedId || requestedArtworkId) {
    const matchingId = attachments.findIndex((attachment) =>
      [attachment.id, (attachment as any).attachmentId, (attachment as any).fileId, (attachment as any).artworkId, (attachment as any).relationshipId]
        .some((value) => {
          const candidate = String(value || "").trim();
          return (requestedId.length > 0 && candidate === requestedId) ||
            (requestedArtworkId.length > 0 && candidate === requestedArtworkId);
        }),
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

  // A thumbnail with a specific identity must never open a different file.
  // The caller can surface a safe stale/missing-artwork message instead.
  return requestedFileRecordId || requestedId || requestedArtworkId || requestedThumbnail ? -1 : 0;
}
