/**
 * Canonical thumbnail URL resolver (single source of truth).
 *
 * Hard rule: NEVER return raw storage keys like "thumbs/..." as an <img src>.
 * We only return renderable URLs:
 * - http(s) URLs (already signed/public)
 * - same-origin proxy URLs under `/objects/*`
 *
 * If no renderable URL exists, returns null (so callers can render placeholder/icon UI
 * without triggering 404 spam).
 */

export function getThumbSrc(obj: unknown): string | null {
  if (!obj || typeof obj !== "object") return null;

  const o = obj as any;

  // 1) Prefer explicit, already-renderable URLs (from API enrichment).
  const urlCandidates: unknown[] = [
    o.previewThumbnailUrl,
    o.thumbnailUrl,
    o.thumbUrl,
    o.pages?.[0]?.thumbUrl,
    o.previewUrl,
  ];

  for (const candidate of urlCandidates) {
    const resolved = coerceRenderableUrl(candidate);
    if (resolved) return resolved;
  }

  // 2) If the object carries storage keys, we can deterministically build the /objects/* URL.
  // This is NOT guessing: `/objects/:key` is the canonical app proxy for tenant-scoped object reads.
  const keyCandidates: unknown[] = [o.thumbKey, o.previewKey];
  for (const keyCandidate of keyCandidates) {
    const keyUrl = objectsUrlFromKey(keyCandidate);
    if (keyUrl) return keyUrl;
  }

  return null;
}

export function objectsUrlFromKey(key: unknown): string | null {
  if (typeof key !== "string") return null;
  const trimmed = key.trim();
  if (!trimmed) return null;

  // Already a URL
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://") || trimmed.startsWith("/objects/")) {
    return coerceRenderableUrl(trimmed);
  }

  // Reject anything that looks like a full path (avoid accidental "/thumbs/..." src)
  if (trimmed.startsWith("/")) return null;

  return `/objects/${trimmed}`;
}

function coerceRenderableUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim();
  if (!v) return null;

  // Renderable URLs only.
  if (v.startsWith("http://") || v.startsWith("https://")) return v;
  if (v.startsWith("/objects/")) return v;

  // Everything else (including "thumbs/..." keys) is not safe to render as a URL.
  return null;
}
