# ETag + Frontend Asset URL Cache

**Date:** 2026-03-25
**Goal:** Two contained, server-safe optimizations on top of the already-stabilized Supabase egress reduction work.

---

## Optimization 1 — ETag / Conditional Request Support on `/objects/` Proxy

### What was missing

The `/objects/` proxy forwarded full file bodies on every browser request, even if the file had not changed since the last download. Browsers cannot make conditional `If-None-Match` requests because the proxy never emitted `ETag` response headers. Every browser cache miss (including navigating away and back) triggered a full Supabase download.

### Design

**ETag source:** The upstream Supabase Storage API is S3-backed and returns standard `ETag` and `Last-Modified` headers on signed URL responses. These are used directly — no hashing of file content, no server-side computation.

**Storage location:** ETag and Last-Modified are stored as optional fields on the existing `SignedUrlEntry` in `signedUrlCache.ts`. They are populated lazily on the first upstream fetch and persist for the same 55-minute TTL as the signed URL itself.

**304 path — no upstream fetch:** When a browser sends `If-None-Match` and the cached ETag matches, the proxy returns `304 Not Modified` without calling `createSignedUrl` or fetching the file from Supabase. This eliminates both the Supabase Storage API call and the egress download for unchanged files.

### Files Changed

**`server/lib/signedUrlCache.ts`**
- Extended `SignedUrlEntry` with `etag?: string` and `lastModified?: string`
- Added `getSignedUrlMeta(bucket, key)` — returns `{ etag?, lastModified? }` for an existing fresh entry, or `null`
- Added `patchSignedUrlMeta(bucket, key, etag?, lastModified?)` — writes ETag/Last-Modified onto an existing entry in-place (preserves TTL, does not move the LRU position)

**`server/routes/attachments.routes.ts`** (`/objects/` proxy)
- Updated import to include `getSignedUrlMeta` and `patchSignedUrlMeta`
- **304 check** (inserted after signed URL cache lookup, before upstream fetch): if `If-None-Match` is present and matches the cached ETag, return `304` with `ETag` + `Last-Modified` + correct CSP headers, no upstream call
- **ETag extraction** (after successful upstream fetch): read `etag` and `last-modified` from upstream response headers; call `patchSignedUrlMeta` to store them
- **200 response headers**: emit `ETag` and `Last-Modified` on every successful proxy response so browsers can cache the values for future conditional requests

### Excluded from ETag support

The explicit download route (`/objects/…/download`) uses `Content-Disposition: attachment`. Downloads are intentional file transfers — applying 304 there would silently skip the save dialog if the file had not changed. ETag is applied to the proxy-only (`!wantsDownload`) code path.

### Expected Impact

- After the first load of any thumbnail or preview, subsequent requests from the same or different browser sessions return **304 without any Supabase fetch** for the 55-minute cache window.
- For a production board with 30 job thumbnails refreshed every few minutes by multiple users: cold load = 30 upstream fetches, warm reloads = 30 × 304 (no egress).
- Combined with the signed URL cache (no redundant `createSignedUrl` calls), repeated loads of the same image now cost: **0 Supabase API calls + 0 Supabase egress**.

---

## Optimization 2 — Frontend Session Asset URL Cache

### What was missing

`getThumbSrc` runs synchronously on every render that needs a thumbnail URL. For a page with 20 attachments, it traverses the full resolution chain (up to 9 property checks + `resolveObjectsPublicUrl`) on every re-render. More importantly, during TanStack Query invalidation/refetch cycles there is a brief window where the query cache is cleared and the resolved URL is temporarily `null`, which can cause flickering from URL → spinner → URL.

### Design

**Key:** `attachment.id` (UUID string, always present on enriched attachment objects returned by the API).

**Value:** The resolved URL string (e.g., `/objects/thumbs/abc.jpg`).

**TTL:** 30 minutes — shorter than the server-side signed URL cache (55 min) so we will not hand out a URL whose server-side entry has already expired.

**Max entries:** 500, insertion-order LRU eviction.

**Scope:** Module-level `Map` in browser memory. Never written to `localStorage` or `IndexedDB`. Cleared on page reload.

**Fail-soft contract:** Cache is a performance layer only. `getThumbSrc` still falls through to full resolution on cache miss. The cache is never the source of truth.

### Files Changed

**`client/src/lib/assetUrlCache.ts`** — new file
- `getCachedAssetUrl(id)` — returns cached URL or `null` (checks TTL)
- `setCachedAssetUrl(id, url)` — writes entry with TTL, evicts oldest on overflow
- `invalidateCachedAssetUrl(id)` — removes entry immediately (called on delete/detach)

**`client/src/lib/getThumbSrc.ts`**
- Reads cache at the top of `getThumbSrc` by `o.id`; returns immediately on hit
- Writes cache after each successful resolution (both URL candidates and storage key candidates)

**`client/src/hooks/useOrderAttachments.ts`**
- Added `invalidateCachedAssetUrl(attachmentId)` in `useDeleteOrderAttachment.onSuccess`

**`client/src/hooks/useOrderFiles.ts`**
- Added `invalidateCachedAssetUrl(fileId)` in `useDetachOrderFile.onSuccess`
- Added `invalidateCachedAssetUrl(fileId)` in `useDetachOrderLineItemFile.onSuccess`

**`client/src/components/QuoteAttachmentsPanel.tsx`**
- Added `invalidateCachedAssetUrl(attachmentId)` in `handleRemove` after successful DELETE response

### Mutation Invalidation Points

| Location | Hook / Function | Trigger |
|---|---|---|
| `useOrderAttachments.ts` | `useDeleteOrderAttachment.onSuccess` | Order attachment deleted |
| `useOrderFiles.ts` | `useDetachOrderFile.onSuccess` | Order file detached |
| `useOrderFiles.ts` | `useDetachOrderLineItemFile.onSuccess` | Line item file detached |
| `QuoteAttachmentsPanel.tsx` | `handleRemove` | Quote attachment deleted |

### What Was NOT Invalidated

`useDetachJobFile` — job file detach removes a `JobFile` join record but does not delete the underlying `OrderAttachment`. The attachment's URL cache entry remains valid. No invalidation needed.

---

## TypeScript

`npm run check` returned zero errors after all changes.

---

## Summary Table

| Optimization | Files changed | Cache hit benefit |
|---|---|---|
| ETag on `/objects/` proxy | `signedUrlCache.ts`, `attachments.routes.ts` | 304 response: 0 Supabase API calls, 0 egress |
| Frontend session URL cache | `assetUrlCache.ts` (new), `getThumbSrc.ts`, 3 mutation hooks, 1 component | URL returned in O(1) without resolution chain; no flicker during query invalidation |
