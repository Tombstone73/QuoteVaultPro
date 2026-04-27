# Thumbnail Regeneration Loop Fix

**Date:** 2026-03-25
**Symptom:** Supabase Storage logs showed continuous `pages/0.thumb.jpg` and `pages/0.preview.jpg` `ObjectCreated → ObjectRemoved → ObjectCreated` cycling — every 10 seconds — for already-completed PDF attachments.

---

## Root Cause

Three compounding bugs produced an infinite regeneration loop:

### Bug 1 — Page loop had no `thumb_ready` skip guard (PRIMARY)

`persistQuoteAttachmentPageDerivatives` looped over all pages of a PDF and unconditionally re-rendered + re-uploaded every page, regardless of existing `quoteAttachmentPages` row state. Because `SupabaseStorageService.uploadFile` uses `upsert: true`, each upload to an already-existing key triggers Supabase to emit `ObjectRemoved` + `ObjectCreated` — the pattern visible in the logs.

### Bug 2 — `processPdfAttachmentDerivedData` reset `thumb_ready` → `thumb_pending`

The status-normalization block at the top of `processPdfAttachmentDerivedData` ran unconditionally. Its condition `if (anyAttachment.pageCountStatus !== 'detecting' || anyAttachment.thumbStatus !== 'thumb_pending')` was TRUE for a completed (`thumb_ready`) attachment, so it updated the row back to `thumb_pending`. The worker's `commonWhere` clause then re-queued the row within 10 seconds.

### Bug 3 — Broken key-based idempotency check

`generateImageDerivatives` and `processPdfAttachmentDerivedData` previously stored `thumbKey: null, previewKey: null` in the success DB write (by design — canonical keys live in `file_derivatives`, not the attachment row). The early-exit check `if (attachment.thumbKey && attachment.previewKey)` could never pass. Any second invocation always regenerated, regardless of existing derivatives.

### The race that kicked it off

Upload routes fire `generateImageDerivatives` / `processPdfAttachmentDerivedData` immediately (fire-and-forget). The worker picks up the same `thumb_pending` row within 10 s. Both execute concurrently. Both upload to the same deterministic keys with `upsert: true` → `ObjectRemoved + ObjectCreated` noise even on the first completion.

---

## Files Changed

### `server/services/thumbnailGenerator.ts`

1. **Added `thumbStatus` to DB select** — necessary to read the attachment's current state.

2. **State machine guard** (after `isSupportedImageType` check, before key-based check):
   ```typescript
   if (attachment.thumbStatus === 'thumb_ready') {
     console.log(`[ThumbnailGenerator] Skipping ${attachmentId}: already thumb_ready`);
     return;
   }
   ```

3. **Success write now stores actual keys** (was `thumbKey: null, previewKey: null`):
   ```typescript
   thumbKey: thumbUploaded.storageKey,
   previewKey: previewUploaded.storageKey,
   ```

4. **Invariant check extended** — added `!record.thumbKey` to the failure condition and issues array.

### `server/services/pdfProcessing.ts`

1. **State machine guard in `processPdfAttachmentDerivedData`** — inserted after not-found check, before the fileUrl mismatch check and before the status-reset block:
   ```typescript
   if ((attachment as any).thumbStatus === 'thumb_ready') {
     console.log(`[PdfProcessing] Skipping ${attachmentId}: already thumb_ready`);
     return;
   }
   ```
   This prevents Bug 2 (the `thumb_pending` reset) from ever running on a completed attachment.

2. **Page-skip guard in `persistQuoteAttachmentPageDerivatives`** — at the top of the `for` loop, before render/upload:
   ```typescript
   const existingRow = existingByIndex.get(pageIndex) ?? null;
   if (existingRow?.thumbStatus === 'thumb_ready') {
     continue;
   }
   ```
   `existingRow` hoisted out of the `try`/`catch` blocks (was defined redundantly inside both).

3. **PDF main thumbnail success write now stores actual key** (was `thumbKey: null`):
   ```typescript
   thumbKey: thumbUploaded.storageKey,
   ```

4. **Invariant check extended** — added `!record.thumbKey` to the failure condition and issues array.

---

## Exact Conditions That Trigger the Fixed Bugs

| Bug | Condition |
|---|---|
| Bug 1 (page loop) | `persistQuoteAttachmentPageDerivatives` called on an attachment whose pages already have `thumbStatus = 'thumb_ready'` rows |
| Bug 2 (status reset) | `processPdfAttachmentDerivedData` called on an attachment with `thumbStatus = 'thumb_ready'` |
| Bug 3 (broken idempotency) | Second call to `generateImageDerivatives` or `processPdfAttachmentDerivedData` after first call has already written `thumb_ready` with `thumbKey: null` |

---

## Prevention

The `thumb_ready` state machine guard is the primary defense. It is checked at the **database re-read** inside the function — not at the call site — so it catches both the upload-route and worker paths regardless of how they were invoked. Since the fix also stores actual keys in the success write, the secondary key-based check (`if (attachment.thumbKey && attachment.previewKey)`) now also functions correctly as a backup guard.

---

## Edge Cases

**Partial failure / retry**: If generation fails after uploading the thumb but before uploading the preview (or before the DB write), the attachment stays `thumb_pending`. The worker re-queues it normally. The page-skip guard in the page loop uses `existingRow?.thumbStatus === 'thumb_ready'`, so partially-written pages are not skipped — they are retried.

**Explicit invalidation**: Nothing in this fix prevents future re-generation if needed. Any code that explicitly resets `thumbStatus` to `'thumb_pending'` or `'uploaded'` will cause the guard to pass and derivatives to be regenerated. The guard is a one-way lock on the terminal success state only.

**`upsert: true` on Supabase**: Still in use. On first generation the key does not exist, so no `ObjectRemoved` event fires. On a genuine retry (partial failure), re-uploading to the same key is expected and the `ObjectRemoved + ObjectCreated` pair is acceptable for that one-time case. The loop is eliminated because the guard ensures no second completion attempt.

---

## TypeScript

`npm run check` returned zero errors after all changes.

---

## Summary Table

| Fix | File | Guards against |
|---|---|---|
| State machine guard | `thumbnailGenerator.ts` | Upload-route + worker race re-running generation after `thumb_ready` |
| Store actual keys on success | `thumbnailGenerator.ts` | Key-based idempotency check permanently broken |
| State machine guard | `pdfProcessing.ts` | Same race; also prevents `thumb_ready` → `thumb_pending` status reset |
| Page-skip guard | `pdfProcessing.ts` → `persistQuoteAttachmentPageDerivatives` | Per-page re-render + re-upload of already-complete pages |
| Store actual key on success | `pdfProcessing.ts` | Key-based idempotency check permanently broken |
