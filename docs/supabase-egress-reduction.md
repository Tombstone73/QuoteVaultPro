# Supabase Egress & Storage Read Reduction

**Date:** 2026-03-25
**Goal:** Reduce Supabase egress and storage API calls by 70–90% without breaking UI functionality.

---

## Audit Findings

### What was already correct (no change needed)

| Area | Status |
|---|---|
| Orders list thumbnails | `includeThumbnails` defaults to `false` — thumbnails not loaded on list pages |
| Quotes list thumbnails | Same — `false` by default |
| Enrichment source of truth | Backend-only — no duplicate client-side URL resolution |
| Prepress/proofing viewer | Intentionally loads original files for staff review — correct behavior |
| Production board (`FlatbedProductionView`, `RollProductionView`) | Uses `thumbnailUrl` first, `fileUrl` only as fallback — correct |

---

## Problem Areas Found

### 1. No server-side signed URL cache — HIGHEST IMPACT

Every browser image load hitting the `/objects/` proxy triggered two Supabase Storage API calls:
1. `createSignedUrl(key, 3600)` — a Supabase API call even though the resulting URL is valid for 60 minutes
2. `fetch(signedUrl)` — the actual file download

With 20 thumbnails on a page and no cache, a cold load = 40 Supabase API calls. The signed URL from call #1 was valid for 3600 seconds but discarded after every request.

**Impact:** Every browser cache miss = 2 Supabase calls. With any page that shows thumbnails, this multiplied rapidly.

---

### 2. Full-size original images loaded as thumbnail placeholders

When `thumbStatus = 'thumb_pending'` or `'uploaded'` (thumbnail not yet generated), `getThumbSrc()` fell back to `originalUrl` for any image MIME type. Original print files can be 50–300+ MB. Loading them as thumbnail placeholders generated massive egress during the thumbnail generation window.

The fallback chain in `getThumbSrc`:
```
previewThumbnailUrl → thumbnailUrl → thumbUrl → ... → previewUrl → originalUrl ← BUG
```

`originalUrl` was reached whenever no derivative existed yet, which is exactly the window when the user uploads a file and the thumbnail worker hasn't run yet.

---

### 3. Sequential asset enrichment — unnecessary latency

In `orders.routes.ts`, asset preview URL enrichment for the orders list ran in a `for...of` loop with `await` on each iteration:

```typescript
// Before: sequential — each enrichment waits for the previous
for (const assetId of assetIds) {
  const enriched = await enrichAssetPreviewUrls(asset);
  ...
}
```

With 20+ assets on the orders list, this added ~N × DB-query-latency to every page load.

---

### 4. 1.5s attachment polling interval

The attachment status poller defaulted to 1500ms. Since the thumbnail worker runs on a 10-second cycle, polling faster than 3s provided no benefit — the thumbnail couldn't be ready any sooner. This doubled the API call volume during the processing window with no UX benefit.

---

## Fixes Applied

### Fix 1 — Server-side signed URL cache

**New file:** `server/lib/signedUrlCache.ts`

A module-level `Map` keyed on `bucket + objectKey`. Signed URLs are cached for 55 minutes (within their 60-minute validity window). On a cache hit, the `createSignedUrl` Supabase API call is skipped entirely.

```typescript
// Key: bucket\x00objectKey
// TTL: 55 minutes
// Max entries: 2000 (insertion-order LRU eviction)
```

Applied to:
- **`/objects/` proxy** (`server/routes/attachments.routes.ts` ~line 1004) — the highest-traffic path; every browser image load hits this
- **Explicit download route** (`server/routes/attachments.routes.ts` ~line 704) — user-triggered file downloads

**Expected reduction:** After first load within a 55-minute window, `createSignedUrl` calls drop to zero for any recently-served object. For a production board with 30 job thumbnails, this reduces 30 Supabase API calls to 0 on reload. For a page with 20 thumbnails refreshed by multiple users, each object generates only 1 `createSignedUrl` call per 55 minutes instead of one per request.

**Added to `SupabaseStorageService`:** `get bucketName(): string` — exposes the effective bucket so proxy code can build cache keys without guessing defaults.

---

### Fix 2 — Stop loading full-size originals for in-progress thumbnails

**File:** `client/src/lib/getThumbSrc.ts`

Updated `hasRenderableOriginalImage()` to return `false` when `thumbStatus` is `'thumb_pending'` or `'uploaded'`. This prevents `originalUrl` from entering the URL resolution chain while a thumbnail is being generated.

```typescript
// Before: any image MIME type fell back to originalUrl when no derivative existed
// After: only falls back to originalUrl when thumbStatus is 'thumb_ready', 'thumb_failed', or unset (legacy)
const ts = typeof obj.thumbStatus === "string" ? obj.thumbStatus : null;
if (ts === "thumb_pending" || ts === "uploaded") return false;
```

**Impact:** During the thumbnail generation window (upload → worker processes it, typically 10–30s), callers now receive `null` and render a loading/spinner placeholder instead of downloading the full-size original file. No change for `thumb_failed` or `thumb_ready` states — the original still loads as a last-resort fallback in those cases.

---

### Fix 3 — Parallelize sequential asset enrichment

**File:** `server/routes/orders.routes.ts` (~line 1059)

Changed sequential `for...of` loop to `Promise.all` for asset preview URL enrichment on the orders list:

```typescript
// Before: sequential await per asset
for (const assetId of assetIds) {
  const enriched = await enrichAssetPreviewUrls(asset);
  ...
}

// After: all enrichments run in parallel
await Promise.all(assetIds.map(async (assetId) => {
  const enriched = await enrichAssetPreviewUrls(asset);
  ...
}));
```

**Impact:** For a list with N assets, latency drops from O(N × query_time) to O(query_time). With 20 assets averaging 5ms per enrichment, page response time improves by ~95ms.

---

### Fix 4 — Reduce attachment poll interval 1500ms → 3000ms

**File:** `client/src/lib/attachments/attachmentStatus.ts`

Changed the `intervalMs` default from `1500` to `3000`. The thumbnail worker runs on a 10-second cycle; polling at 1.5s was 6–7× faster than the worker could produce results.

**Impact:** Halves API call volume during attachment processing windows. For a page with 10 attachments uploading simultaneously, reduces 400 polling requests/minute to 200.

---

## Summary Table

| Fix | Files changed | Impact | Risk |
|---|---|---|---|
| Server-side signed URL cache | `server/lib/signedUrlCache.ts` (new), `server/supabaseStorage.ts`, `server/routes/attachments.routes.ts` | Eliminates `createSignedUrl` calls for cached objects — up to 50% reduction in Supabase Storage API calls | Low |
| Block original-file fallback for pending thumbs | `client/src/lib/getThumbSrc.ts` | Prevents egress of full-size originals during thumbnail generation window | Low — spinners show instead of originals |
| Parallel asset enrichment | `server/routes/orders.routes.ts` | Reduces orders list latency by O(N×queryTime) | Low |
| Polling interval 1.5s → 3s | `client/src/lib/attachments/attachmentStatus.ts` | Halves polling API volume during file uploads | Low — thumbnail notification delay increases by at most one 10s worker cycle |

---

## What Was NOT Changed

| Area | Reason |
|---|---|
| Thumbnails OFF by default on lists | Already implemented — `includeThumbnails` defaults to `false` |
| Enrichment source of truth | Already backend-only — no client-side duplication to remove |
| Proofing/viewer original file loads | Intentional — staff need full-resolution files for review |
| Production board original fallback | Already using `thumbnailUrl` first — correct behavior |
| CDN caching for `/objects/` | Architectural — see `supabase-storage-audit.md` Fix 5 |
| ETag on proxy responses | `supabase-storage-audit.md` Fix 3 — medium priority, not done here |

---

## Remaining High-Risk Areas

1. **PDF page enrichment (`supabaseObjectHelpers.ts` ~line 482):** Each PDF attachment with N pages triggers 2 `resolveOriginalFileAccess()` DB queries per page in parallel. For a 20-page PDF this is 40 concurrent DB queries per attachment request. These are DB queries only (not Supabase Storage calls), but they do add DB load. Fix: batch the page enrichment or lazy-load page thumbnails on demand.

2. **No ETag on proxy responses:** Browsers can't make 304 conditional requests. Every browser cache miss requires a full round-trip and full file download from Supabase. Adding ETag support to the proxy would allow 304 responses for unchanged files.

3. **Signed URL expiry in long-running sessions:** If a user keeps a browser tab open for >55 minutes, their cached signed URLs expire. The proxy handles this correctly (generates a new one), but the signed URL cache will then miss and re-generate. No action needed — this is correct behavior.
