/**
 * In-process cache for Supabase signed URLs.
 *
 * Supabase signed URLs are valid for 3600 s. We cache them for 3300 s (55 min)
 * so any object served multiple times within that window only triggers one
 * `createSignedUrl` API call instead of one per browser request.
 *
 * Eviction strategy: insertion-order LRU via Map — oldest entry is dropped
 * when the cache reaches MAX_ENTRIES.
 *
 * Usage:
 *   const cached = getSignedUrlFromCache(bucket, key);
 *   const url = cached ?? await service.getSignedDownloadUrl(key, 3600);
 *   if (!cached) setSignedUrlInCache(bucket, key, url);
 */

const CACHE_TTL_MS = 55 * 60 * 1000; // 55 min — comfortably within the 60-min signed URL window
const MAX_ENTRIES = 2000;

interface SignedUrlEntry {
  url: string;
  expiresAt: number;
  /** ETag forwarded from upstream (Supabase/S3), e.g. `"abc123"` — already quoted */
  etag?: string;
  /** Last-Modified forwarded from upstream, e.g. `"Wed, 01 Jan 2025 00:00:00 GMT"` */
  lastModified?: string;
}

const _cache = new Map<string, SignedUrlEntry>();

function cacheKey(bucket: string, key: string): string {
  return `${bucket}\x00${key}`;
}

export function getSignedUrlFromCache(bucket: string, key: string): string | null {
  const entry = _cache.get(cacheKey(bucket, key));
  if (!entry) return null;
  if (Date.now() >= entry.expiresAt) {
    _cache.delete(cacheKey(bucket, key));
    return null;
  }
  return entry.url;
}

/**
 * Return cached ETag / Last-Modified for a previously-served object, if present and still fresh.
 * Returns null if the entry is absent or expired.
 */
export function getSignedUrlMeta(bucket: string, key: string): { etag?: string; lastModified?: string } | null {
  const entry = _cache.get(cacheKey(bucket, key));
  if (!entry) return null;
  if (Date.now() >= entry.expiresAt) {
    _cache.delete(cacheKey(bucket, key));
    return null;
  }
  if (!entry.etag && !entry.lastModified) return null;
  return { etag: entry.etag, lastModified: entry.lastModified };
}

/**
 * Store ETag and/or Last-Modified on an existing cache entry (in-place, preserves TTL).
 * No-ops if the entry does not exist yet (will be populated on next full fetch).
 */
export function patchSignedUrlMeta(bucket: string, key: string, etag?: string, lastModified?: string): void {
  const entry = _cache.get(cacheKey(bucket, key));
  if (!entry) return;
  if (etag) entry.etag = etag;
  if (lastModified) entry.lastModified = lastModified;
}

export function setSignedUrlInCache(bucket: string, key: string, url: string): void {
  const ck = cacheKey(bucket, key);
  if (_cache.size >= MAX_ENTRIES) {
    const firstKey = _cache.keys().next().value;
    if (firstKey !== undefined) _cache.delete(firstKey);
  }
  _cache.set(ck, { url, expiresAt: Date.now() + CACHE_TTL_MS });
}
