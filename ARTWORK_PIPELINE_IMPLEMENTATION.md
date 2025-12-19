# Artwork Pipeline Implementation Summary

## Changes Made

### 1. Database Schema (`server/db/migrations/0020_add_async_artwork_processing.sql`)
- Added `file_processing_status` enum: uploaded, processing, ready, error
- Added columns to `quote_attachments`:
  - `processing_status` (file_processing_status, default 'uploaded')
  - `thumb_storage_key` (TEXT) - 256px thumbnail
  - `preview_storage_key` (TEXT) - 1024px preview
  - `derived_print_storage_key` (TEXT) - print-ready PDF
  - `derived_print_filename` (VARCHAR(500))
  - `processing_error` (TEXT)
  - `bucket` (VARCHAR(100), default 'titan-private')

### 2. Async Processing Service (`server/services/artworkProcessor.ts`)
- In-process queue using `p-queue` (concurrency: 2)
- `enqueueArtworkProcessing()` - adds jobs to queue
- Generates thumbnails for images using `sharp`:
  - 256x256px thumbnail → `thumb_256.png`
  - 1024x1024px preview → `preview_1024.png`
- Updates DB with storage keys and status
- Error handling with `processing_error` field

### 3. Server Routes (`server/routes.ts`)

#### Upload Endpoint (Modified)
- `POST /api/quotes/:quoteId/line-items/:lineItemId/files`
- Now sets `bucket` and `processingStatus` fields
- Enqueues async processing for image files
- Storage key: `uploads/<uuid>` (from client)

#### Download Endpoint (Modified)
- `GET /api/quotes/:quoteId/line-items/:lineItemId/files/:fileId/download`
- Returns `{ success, data: { signedUrl, fileName } }`
- Uses `originalFilename` for correct display name

#### Proxy Download Endpoint (NEW)
- `GET /api/quotes/:quoteId/line-items/:lineItemId/files/:fileId/download/proxy`
- Streams file with `Content-Disposition: attachment; filename="..."`
- Ensures browser downloads with correct filename

### 4. Client (`client/src/components/LineItemAttachmentsPanel.tsx`)
- Upload button uses `stopPropagation()` to prevent accordion collapse
- Download uses proxy endpoint for correct filename
- Displays `originalFilename` (already implemented)

### 5. Shared Schema (`shared/schema.ts`)
- Added new fields to `quoteAttachments` table definition

### 6. Dependencies (`package.json`)
- Added `p-queue: ^8.0.1` - async job queue
- Added `sharp: ^0.33.5` - image processing

## Installation Required

```bash
npm install p-queue@8.0.1 sharp@0.33.5
```

## Run Migration

```sql
-- Execute server/db/migrations/0020_add_async_artwork_processing.sql
```

## Storage Key Structure

All keys use stable identifiers (no reorderable fields):

```
org/{orgId}/quotes/{quoteId}/line-items/{lineItemId}/files/{fileId}/
  ├── original (stored as uploads/<uuid> currently)
  ├── thumb_256.png
  ├── preview_1024.png
  └── print_ready.pdf (future)
```

## Processing Flow

1. **Upload**: Client uploads to Supabase → creates DB record → enqueues processing
2. **Processing**: Background worker generates thumbnails → uploads to Supabase → updates DB
3. **Download**: Proxy endpoint streams with correct filename

## Future: Print-Ready PDF (TODO)

Endpoint design (not yet implemented):
- `POST /api/quotes/:quoteId/line-items/:lineItemId/files/:fileId/prepare`
- Body: metadata (jobNumber, customerName, dimensions, etc.)
- Generates derived PDF with injected metadata
- `GET /api/quotes/:quoteId/line-items/:lineItemId/files/:fileId/download/print`

## Non-Regressions

- TEMP→PERMANENT flow unchanged
- Quote/line item creation logic unchanged
- Pricing engine unchanged
- Upload on `/quotes/new` still works via `ensureQuoteId`/`ensureLineItemId`

## Files Modified

1. `server/db/migrations/0020_add_async_artwork_processing.sql` (NEW)
2. `server/services/artworkProcessor.ts` (NEW)
3. `server/routes.ts` (upload + download endpoints, proxy endpoint)
4. `client/src/components/LineItemAttachmentsPanel.tsx` (download handler)
5. `shared/schema.ts` (quoteAttachments fields)
6. `package.json` (dependencies)

## Validation

```bash
# TypeScript check (after npm install)
npx tsc --noEmit

# Test flow:
1. Create quote
2. Add line item
3. Upload image → check DB processingStatus=uploaded
4. Wait ~5s → check processingStatus=ready, thumbStorageKey populated
5. Download → check filename matches originalFilename
6. Reorder line items → files still linked correctly (by IDs)
```

