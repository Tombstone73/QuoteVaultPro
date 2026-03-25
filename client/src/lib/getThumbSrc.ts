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

import { objectsUrl, resolveObjectsPublicUrl } from "@/lib/apiConfig";

export function getThumbSrc(obj: unknown): string | null {
  if (!obj || typeof obj !== "object") return null;

  const o = obj as any;
  const canUseOriginalImage = hasRenderableOriginalImage(o);

  // 1) Prefer explicit, already-renderable URLs (from API enrichment).
  const urlCandidates: unknown[] = [
    o.previewThumbnailUrl,
    o.thumbnailUrl,
    o.thumbUrl,
    o.thumb_path,
    o.preview_url,
    o.url,
    o.pages?.[0]?.thumbUrl,
    o.previewUrl,
    ...(canUseOriginalImage ? [o.originalUrl] : []),
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

  return objectsUrl(`/objects/${trimmed}`);
}

function coerceRenderableUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim();
  if (!v) return null;

  return resolveObjectsPublicUrl(v);
}

function hasRenderableOriginalImage(obj: Record<string, unknown>): boolean {
  // When a thumbnail is being generated (thumb_pending / uploaded), do NOT fall
  // back to the full-size original. These are often print-resolution files and
  // loading them as a thumbnail placeholder wastes significant Supabase egress.
  // Return null instead so callers render a spinner/placeholder.
  const ts = typeof obj.thumbStatus === "string" ? obj.thumbStatus : null;
  if (ts === "thumb_pending" || ts === "uploaded") return false;

  const mimeType = typeof obj.mimeType === "string" ? obj.mimeType.toLowerCase() : "";
  if (mimeType.startsWith("image/")) {
    return !mimeType.includes("svg");
  }

  const fileNameCandidate =
    typeof obj.originalFilename === "string"
      ? obj.originalFilename
      : typeof obj.fileName === "string"
      ? obj.fileName
      : "";
  const fileName = fileNameCandidate.toLowerCase();

  return /\.(png|jpe?g|webp|gif|bmp|tiff?)$/i.test(fileName);
}
