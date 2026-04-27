# Supabase Storage Request Volume Audit

**Date:** 2026-03-25
**Scope:** Full codebase audit — frontend + backend
**Question answered:** What is causing excessive Supabase Storage requests when the system is mostly idle?

---

## Executive Summary

The issue is primarily **frontend-driven**, with one critical **server-side architectural gap** amplifying it.

Root causes in order of impact:

1. **The `/objects/` proxy generates a fresh Supabase signed URL on every request, with no server-side cache.** Every browser cache miss triggers two Supabase Storage API calls per image: one `createSignedUrl` and one file download. With multiple thumbnails per page and no signed URL reuse, this multiplies fast.

2. **Attachment status polling (every 1.5s) causes periodic thumbnail URL state changes.** When a file transitions from `thumb_pending` → `thumb_ready`, React renders a new `<img>` with a URL it has never loaded — triggering a fresh proxy request and two new Supabase calls.

> **Important correction:** `enrichAttachmentWithUrls` does **only DB queries** to resolve storage paths — it never calls the Supabase Storage SDK. All actual Supabase Storage calls flow through the `/objects/` proxy when the browser loads images. The enrichment helpers are not a storage request source.

---

## How Supabase Storage Requests Are Actually Generated

### The proxy — the real driver

Every `<img src="/objects/key">` or `<iframe src="/objects/key">` rendered in the browser:

```
Browser GET /objects/thumbs/org123/attachment456.thumb.jpg
  → server: supabase.storage.createSignedUrl(key, 3600)   ← 1 Supabase Storage API call
  → server: fetch(signedUrl)                               ← 1 Supabase Storage download
  → server streams bytes back to browser
  → sets Cache-Control: public, max-age=86400
```

Two Supabase Storage calls per browser image load. No server-side caching of signed URLs — a signed URL valid for 3600s is regenerated fresh on every request, even for the same object loaded seconds earlier.

### What does NOT generate storage calls

`enrichAttachmentWithUrls` → DB queries only (fileRecords, storagePlacements, storageProviderConfig).
`CanonicalFileReadResolver.resolveOriginal` → DB queries only.
`CanonicalDerivativeReadResolver.resolveDerivative` → DB queries only.
`enrichAssetWithUrls` → DB queries only.

All of these return `/objects/key` proxy URLs. No Supabase SDK calls. The storage hit comes later, when the browser loads those URLs.

---

## Full Inventory of Storage-Touching Code

### Server — actual Supabase Storage SDK calls

| File | Location | Storage call | Trigger |
|---|---|---|---|
| `server/routes/attachments.routes.ts` | Line 1004 — `GET /objects/:objectPath` (Supabase path) | `createSignedUrl(key, 3600)` + `fetch(signedUrl)` | Every browser image/file load |
| `server/routes/attachments.routes.ts` | Line 704 — `GET /api/objects/download` | Same pattern | Every explicit download |
| `server/routes/attachments.routes.ts` | Lines 2364, 2668 | Same pattern | Other file-serving routes |
| `server/routes/orders.routes.ts` | Line 6341 | Same pattern | Order file downloads |
| `server/supabaseStorage.ts` | Line 302 — `fileExists` via `storage.list()` | `storage.from(bucket).list(folder, {search, limit:1})` | Once per upload (post-upload self-check) |
| `server/services/thumbnailGenerator.ts` | Line 216 — `downloadOriginalFile` | `createSignedUrl` + `fetch` | Each thumbnail generation job |
| `server/prepressFileService.ts` | Lines 342, 447 | `getSignedDownloadUrl` + `fetch` | Prepress job file access |

### Server — DB-only enrichment (no storage calls)

| File | Function | What it does |
|---|---|---|
| `server/lib/supabaseObjectHelpers.ts` | `enrichAttachmentWithUrls` | DB queries → returns `/objects/` proxy URLs |
| `server/lib/supabaseObjectHelpers.ts` | `resolveOriginalFileAccess` | DB queries → returns proxy URL |
| `server/lib/supabaseObjectHelpers.ts` | `resolveDerivativeFileAccess` | DB queries → returns proxy URL |
| `server/services/storage/CanonicalFileReadResolver.ts` | `resolveOriginal` | 3 sequential DB queries per attachment |
| `server/services/storage/CanonicalDerivativeReadResolver.ts` | `resolveDerivative` | 2 DB queries per derivative |
| `server/services/assets/enrichAssetWithUrls.ts` | `enrichAssetWithUrls` | DB queries → returns proxy URLs |

### Server — background workers

| Worker | Interval | Storage calls | Idle behavior |
|---|---|---|---|
| `thumbnailWorker` | 10s (prod) | `createSignedUrl` + `fetch` per original; `upload()` per thumbnail | DB poll only when no pending work — **zero storage calls at true idle** |
| `assetPreviewWorker` | 10min (prod) | Same pattern | Minimal — long interval, only when pending assets exist |
| QB sync worker | Configurable | None — QB API only | No storage impact |

**Thumbnail worker stale-state risk:** If an attachment remains in `thumb_pending` because an exception fires before `generateImageDerivatives` sets `thumb_failed` (caught by the outer `catch` in `pollOnce` without a status update), the worker retries every 10s — calling `createSignedUrl` and downloading the original file each cycle. Rare but possible after a crashed or OOM process. Check the DB for aged `thumb_pending` rows (see fixes below).

### Frontend — image rendering paths

| Component | What it renders | Polling? | Risk |
|---|---|---|---|
| `LineItemThumbnail` | `<img src={getThumbSrc(first)}>` | Yes — 1.5s while pending | ⚠️ Each new `thumbUrl` = new `/objects/` request |
| `OrderAttachmentsPanel` | `<img>` per attachment | Yes — 1.5s while pending | ⚠️ Same concern |
| `LineItemAttachmentsPanel` | `<img>` per file in expanded panel | Yes — 1.5s while pending | ⚠️ Same concern |
| `QuoteAttachmentsPanel` | `<img>` per attachment | Yes — 1.5s while pending | ⚠️ Same concern |
| `FlatbedProductionView` | `<img>` for each job card artwork | No | ⚠️ N thumbnails on cold load = N×2 Supabase calls |
| `RollProductionView` | Same | No | ⚠️ Same |
| `StaffProofingPage` | `<img>` or `<iframe>` for selected proof | No (user-triggered) | Low — user must select a row |
| `OrderArtworkPanel` | `<img>` per file | No | Low — mounted on order detail view |

---

## Top Offenders

### 1. `/objects/` proxy — no server-side signed URL cache

**Highest impact.** Every browser image load calls `createSignedUrl` on Supabase, even for files unchanged for weeks. Signed URLs are valid for 3600 seconds, but the server never reuses them. If 50 requests arrive for the same thumbnail within one hour, the server makes 50 separate Supabase Storage API calls to generate 50 identical signed URLs.

On a page with 20 thumbnails, a cold browser (new tab, cleared cache, new session) generates **20 × 2 = 40 Supabase Storage API calls** on load.

Relevant code: `server/routes/attachments.routes.ts:979–1083`

### 2. Production board artwork thumbnails

`FlatbedProductionView` and `RollProductionView` render an artwork thumbnail for every job card. With 30+ active jobs, opening the production page generates **60+ Supabase Storage calls** per visit. No polling — single load — but the volume per page visit is high.

### 3. Attachment polling → new thumbnail URL → new browser request

When the 1.5s attachment poller detects a `thumbUrl` change (file processing completes), React renders a new `<img>` tag. Browser has no cache entry for that URL → full proxy round-trip → 2 Supabase calls. This is intentional behavior, but the 1.5s interval over a 3-minute window means a single uploading user can drive 240 polling cycles per attachment during processing.

### 4. Order/quote list pages with line item thumbnails

`OrderLineItemsSection` renders one `LineItemThumbnail` per line item. Cold page load with 10 line items × 2 attachments each = 20 `/objects/` requests = 40 Supabase Storage calls.

---

## Duplicate-Load Analysis

**Same line item, `LineItemThumbnail` + `LineItemAttachmentsPanel`:**
Both components reference the same query key (`filesApiPath`). TanStack Query deduplicates the API call — only one HTTP request is made. Both render `<img>` tags with the same URL string — browser makes one network request per unique URL. **No effective duplication at the network level.**

**`useOrderFiles` + `LineItemThumbnail`:**
`OrderLineItemsSection` fetches all order files via `useOrderFiles` and passes them as the `attachments` prop to `LineItemThumbnail`. When the prop is provided, `LineItemThumbnail` skips its own fetch. ✅ Correctly handled.

**`useOrderLineItemPreviews`:**
`/api/orders/:orderId/line-item-previews` returns thumbnail URLs for all line items in one batch request. No per-line-item polling. The hook has no `refetchInterval`. ✅ Not a concern.

---

## Signed URL and Cache Analysis

### Server-side: no signed URL reuse (critical gap)

```typescript
// server/routes/attachments.routes.ts:1004
// Called on EVERY /objects/ request — no cache check before this line
const signedUrl = await supabaseService.getSignedDownloadUrl(keyToTry, 3600);
```

A cache keyed on `(bucket, objectKey)` with a ~55-minute TTL would eliminate this call for any recently served object.

### Browser-side: correct but fragile

The proxy sets `Cache-Control: public, max-age=86400` on non-download responses. This is correct. However:

- **No `ETag` or `Last-Modified` headers** are set. Browsers cannot make conditional GET requests (304 Not Modified). Every cache miss requires a full round-trip and full file download.
- **No `Vary` header** is set. This is appropriate — responses don't vary per user.
- **Session cookies are present** on every request (`isAuthenticated`). Most modern browsers honor `public, max-age` regardless of session cookies, but edge cases exist in restrictive configurations.
- **Cache-Control is missing on some paths.** Lines 678 and 716 in `attachments.routes.ts` set `private, max-age=0, must-revalidate` — these responses are never cached. Verify these paths are only for download-disposition variants.

### `scheduleSupabaseObjectSelfCheck`

Called via `setImmediate` after each quote attachment upload response. Makes one `storage.list()` call per upload to verify existence. This is upload-triggered (not idle), single-shot, and fail-soft. Low impact, but every upload adds one Supabase Storage API call.

---

## Recommended Fixes (ordered by impact)

### Fix 1 — Server-side signed URL cache *(highest impact, ~10 lines)*

In the `/objects/` proxy, before calling `getSignedDownloadUrl`, check an in-process Map or LRU cache keyed by `bucket + objectKey`. Cache the signed URL for 55 minutes (within its 60-minute expiry). On a hit, skip the `createSignedUrl` call entirely and proceed directly to `fetch(cachedSignedUrl)`.

This eliminates one of the two Supabase calls per proxy request for any recently served object. For a production board with 30 job thumbnails, this reduces 30 `createSignedUrl` calls to 0 after the first load within the cache window.

**Location:** `server/routes/attachments.routes.ts` around line 979 (before the Supabase block).

---

### Fix 2 — Check for stuck `thumb_pending` attachments *(immediate diagnostic)*

Run this query against the production DB:

```sql
SELECT 'quote' AS type, id, thumb_status, thumb_error, created_at
FROM quote_attachments
WHERE thumb_status IN ('uploaded', 'thumb_pending')
  AND file_record_id IS NOT NULL
  AND created_at < now() - interval '1 hour'
UNION ALL
SELECT 'order', id, thumb_status, thumb_error, created_at
FROM order_attachments
WHERE thumb_status IN ('uploaded', 'thumb_pending')
  AND file_record_id IS NOT NULL
  AND created_at < now() - interval '1 hour'
ORDER BY created_at;
```

If any rows are returned, those attachments are being retried by the thumbnail worker every 10 seconds — each retry downloads the original file from Supabase. Manually setting `thumb_status = 'thumb_failed'` on stuck rows stops the bleed.

---

### Fix 3 — Add `ETag` response header to proxy *(medium impact)*

After fetching bytes from Supabase, compute a simple ETag (e.g., content-length + last-modified from the upstream response headers, or a hash of the object key) and set it on the response. This enables browsers to make conditional GET requests. On a revalidation hit, the server can respond 304 Not Modified without re-downloading from Supabase.

**Location:** `server/routes/attachments.routes.ts` — add after line 1044 (`res.setHeader("Content-Type", ...)`).

---

### Fix 4 — Reduce attachment poll interval from 1500ms to 3000ms *(low risk)*

The 1.5s default interval in `attachmentStatus.ts` was chosen for fast thumbnail feedback. Given that the thumbnail worker runs on a 10s cycle, polling faster than ~3s provides no practical benefit — the thumbnail won't be ready any sooner. Halving the rate halves the API call volume during attachment processing windows.

**Location:** `client/src/lib/attachments/attachmentStatus.ts:127` — change `intervalMs = 1500` default to `intervalMs = 3000`.

---

### Fix 5 — CDN caching for `/objects/` responses *(architectural, highest ceiling)*

With `Cache-Control: public, max-age=86400` already set, placing a CDN in front of the server allows thumbnail responses to be served entirely from the CDN edge — zero server hits, zero Supabase calls — for 24 hours after first load. Requires tenant-isolation verification (ensure the CDN key includes the object path and does not mix tenant content).

This does not require code changes to the app itself beyond confirming the Cache-Control header is correct (it already is for non-download responses).

---

## Summary Table

| Issue | Type | Impact | Fix complexity |
|---|---|---|---|
| No server-side signed URL cache | Architecture | High | Low — ~10 lines |
| Stuck `thumb_pending` attachments | Data/ops | High (if any exist) | Zero — DB update |
| No ETag on proxy responses | Missing header | Medium | Low |
| Production board cold load (30+ thumbnails) | Design | Medium | Requires CDN or lazy-load |
| 1.5s attachment poll interval | Tuning | Low-medium | Trivial |
| CDN caching for `/objects/` | Architecture | Very high | Medium-high |
| `scheduleSupabaseObjectSelfCheck` per upload | Minor overhead | Low | N/A — intentional |
