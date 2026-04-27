/**
 * Session-memory cache for resolved attachment proxy URLs.
 *
 * Stores the URL returned by getThumbSrc (or similar resolvers) keyed by the
 * attachment record ID. Persists only for the current browser session — never
 * written to localStorage or IndexedDB.
 *
 * Key   : attachment id (string, always present on enriched attachment objects)
 * Value : resolved /objects/... URL string
 * TTL   : 30 minutes — shorter than the 55-min server-side signed URL cache so
 *         we will not hand out a URL whose server-side entry has already expired.
 * Max   : 500 entries, insertion-order LRU eviction.
 *
 * Usage pattern (read-through / write-through via getThumbSrc):
 *   - On hit : return cached URL immediately, skip resolution chain.
 *   - On miss : run normal resolution, write result to cache.
 *   - On delete/detach mutation : call invalidateCachedAssetUrl(id) to purge entry.
 *
 * Fail-soft contract: callers MUST fall through to normal resolution on cache
 * miss or error. The cache is never the source of truth.
 */

const SESSION_TTL_MS = 30 * 60 * 1000; // 30 min
const MAX_ENTRIES = 500;

interface CachedAssetUrl {
  url: string;
  expiresAt: number;
}

const _cache = new Map<string, CachedAssetUrl>();

export function getCachedAssetUrl(id: string | null | undefined): string | null {
  if (!id) return null;
  const entry = _cache.get(id);
  if (!entry) return null;
  if (Date.now() >= entry.expiresAt) {
    _cache.delete(id);
    return null;
  }
  return entry.url;
}

export function setCachedAssetUrl(id: string | null | undefined, url: string): void {
  if (!id || !url) return;
  if (_cache.size >= MAX_ENTRIES) {
    const firstKey = _cache.keys().next().value;
    if (firstKey !== undefined) _cache.delete(firstKey);
  }
  _cache.set(id, { url, expiresAt: Date.now() + SESSION_TTL_MS });
}

/** Remove cached URL for a specific attachment (call on delete / detach mutations). */
export function invalidateCachedAssetUrl(id: string | null | undefined): void {
  if (!id) return;
  _cache.delete(id);
}
