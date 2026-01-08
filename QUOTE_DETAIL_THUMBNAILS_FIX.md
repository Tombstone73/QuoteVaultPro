# Quote Detail Attachment Thumbnails - Resolution

## Issue
Quote Detail attachment preview grid showed generic file icons instead of thumbnail previews, while Order Detail correctly displayed thumbnails.

## Root Cause
**Thumbnails are generated asynchronously** by a background worker (`server/workers/thumbnailWorker.ts`) that polls every 10 seconds:

1. When a file is uploaded, `thumbStatus` is set to `'uploaded'`
2. Worker picks up attachment and processes it (PDF → thumbnail, image → thumb + preview)
3. Worker writes thumbnail files to disk and updates `thumbKey`, `thumbUrl`, `thumbStatus = 'thumb_ready'`
4. UI fetches attachment data with enriched thumbnail URLs

The issue was:
- **Newly uploaded attachments** don't have thumbnails immediately (0-10 second delay)
- **UI showed static file icon** with no indication that thumbnail generation was in progress
- **No auto-refresh** to display thumbnails once generated

## Solution Implemented

### 1. Pending State Indicator
Added visual feedback when thumbnails are being generated:

```tsx
const isPending = a.thumbStatus === 'uploaded' || a.thumbStatus === 'thumb_pending';

{isPending && !thumbSrc && (
  <div className="absolute top-1 left-1 rounded-full bg-amber-500/90 p-1" title="Generating thumbnail...">
    <Loader2 className="w-3 h-3 text-white animate-spin" />
  </div>
)}
```

### 2. Auto-Refresh Polling
Added smart polling to refresh attachments while thumbnails are pending:

```tsx
refetchInterval: (query) => {
  const data = query?.state?.data;
  const hasPending = data?.some((a: QuoteAttachment) => 
    a.thumbStatus === 'uploaded' || a.thumbStatus === 'thumb_pending'
  );
  return hasPending ? 5000 : false; // Poll every 5s when pending, stop when all ready
},
```

**Benefits**:
- Polls every 5 seconds while ANY attachment has pending thumbnail
- Stops polling automatically once all thumbnails are ready
- No unnecessary network requests for stable state
- Thumbnails appear automatically without page refresh

## Files Modified
- [client/src/components/QuoteAttachmentsPanel.tsx](client/src/components/QuoteAttachmentsPanel.tsx)
  - Added `isPending` check based on `thumbStatus`
  - Added spinner badge overlay for pending thumbnails
  - Added `refetchInterval` to auto-refresh while pending

## Verification

### Manual Testing
1. Navigate to Quote Detail page
2. Upload a new attachment (PDF or image)
3. **Expected Behavior**:
   - File tile appears immediately with file icon
   - Small amber spinner badge appears in top-left corner
   - After 5-10 seconds, thumbnail appears automatically
   - Spinner badge disappears

### Server Logs to Watch
```
[Thumbnail Worker] Processing quote attachment {id}
[PdfProcessing] PDF processing started for attachmentId=...
[PdfProcessing] Thumbnail stored successfully
[PdfProcessing] ✅ Thumbnail persisted to DB: thumbStatus=thumb_ready
```

### Database Verification
```sql
-- Check thumbnail status for recent quote attachments
SELECT 
  id,
  file_name,
  thumb_status,
  thumb_key,
  thumbnail_generated_at,
  created_at
FROM quote_attachments
WHERE organization_id = 'org_titan_001'
ORDER BY created_at DESC
LIMIT 10;
```

Expected progression:
- Upload: `thumb_status = 'uploaded'`, `thumb_key = NULL`
- Processing: `thumb_status = 'thumb_pending'`
- Complete: `thumb_status = 'thumb_ready'`, `thumb_key = 'thumbs/org_titan_001/quote/{id}.thumb.jpg'`

## Technical Notes

### Why Orders Showed Thumbnails
Order attachments that were uploaded earlier had already been processed by the worker, so their thumbnails existed and displayed immediately.

### Worker Architecture
- **Worker**: `server/workers/thumbnailWorker.ts`
- **Poll Interval**: 10 seconds (default)
- **Batch Size**: 10 attachments per poll
- **PDF Processing**: `server/services/pdfProcessing.ts`
- **Image Processing**: `server/services/thumbnailGenerator.ts`

### Thumbnail Storage Paths
- **Quote PDFs**: `thumbs/{orgId}/quote/{attachmentId}.thumb.jpg`
- **Order PDFs**: `thumbs/{orgId}/order/{attachmentId}.thumb.jpg`
- **Images**: Both `.thumb.jpg` (320px) and `.preview.jpg` (1600px)

### Backend Enrichment
Both quote and order endpoints call `enrichAttachmentWithUrls()` which:
1. Checks if `thumbKey` exists in database
2. Generates signed URL for thumbnail file
3. Adds `thumbUrl`, `previewUrl`, `originalUrl` to response
4. Frontend uses `getThumbSrc()` helper to resolve best available URL

## Related Documentation
- [docs/attachments-and-thumbnails.md](docs/attachments-and-thumbnails.md)
- Worker configuration: `ATTACHMENT_THUMBNAIL_WORKER_ENABLED`, `THUMBNAIL_WORKER_POLL_INTERVAL_MS`
- Debug logging: `DEBUG_THUMBNAILS=1`

## Status
✅ **Complete** - Quote Detail attachments now:
- Show pending indicator during thumbnail generation
- Auto-refresh to display thumbnails once ready
- Match Order Detail UX behavior
