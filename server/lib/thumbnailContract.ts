export type ThumbnailContractInput = {
  thumbnailUrl?: string | null;
  previewThumbnailUrl?: string | null;
  thumbUrl?: string | null;
  previewUrl?: string | null;
  pages?: Array<{ thumbUrl?: string | null }> | null;
};

/**
 * Titan thumbnail contract:
 * - If a thumbnail exists anywhere, expose it as `thumbnailUrl`.
 * - Prefer page[0].thumbUrl when present (PDFs).
 * - `previewThumbnailUrl` is optional compatibility; when present, `thumbnailUrl` must mirror it.
 */
export function applyThumbnailContract<T extends ThumbnailContractInput>(obj: T): T {
  const page0ThumbUrl = obj.pages?.[0]?.thumbUrl ?? null;

  const bestPreviewThumb =
    (page0ThumbUrl && typeof page0ThumbUrl === 'string' ? page0ThumbUrl : null) ??
    (obj.previewThumbnailUrl && typeof obj.previewThumbnailUrl === 'string' ? obj.previewThumbnailUrl : null) ??
    (obj.thumbUrl && typeof obj.thumbUrl === 'string' ? obj.thumbUrl : null) ??
    null;

  // If we have a best preview thumb, ensure both fields are populated.
  if (bestPreviewThumb) {
    return {
      ...obj,
      previewThumbnailUrl: bestPreviewThumb,
      thumbnailUrl: bestPreviewThumb,
    };
  }

  // Otherwise, keep fields as-is (thumbnailUrl may legitimately be null).
  return {
    ...obj,
    thumbnailUrl: obj.thumbnailUrl ?? null,
    previewThumbnailUrl: obj.previewThumbnailUrl ?? null,
  };
}
