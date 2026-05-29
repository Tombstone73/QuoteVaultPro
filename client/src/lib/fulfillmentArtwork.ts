export type FulfillmentArtworkUrlLike = {
  previewUrl?: string | null;
  originalUrl?: string | null;
  downloadUrl?: string | null;
  fileUrl?: string | null;
  objectPath?: string | null;
};

function coerceOpenableArtworkUrl(value?: string | null): string | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  if (raw.startsWith("/") || /^https?:\/\//i.test(raw)) return raw;
  return null;
}

function objectsUrlFromObjectPath(value?: string | null): string | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  if (raw.startsWith("/") || /^https?:\/\//i.test(raw)) return raw;
  return `/objects/${raw}`;
}

export function getFulfillmentArtworkViewUrl(artwork: FulfillmentArtworkUrlLike | null | undefined): string | null {
  if (!artwork) return null;
  for (const candidate of [artwork.previewUrl, artwork.originalUrl, artwork.downloadUrl, artwork.fileUrl]) {
    const url = coerceOpenableArtworkUrl(candidate);
    if (url) return url;
  }
  return objectsUrlFromObjectPath(artwork.objectPath ?? null);
}
