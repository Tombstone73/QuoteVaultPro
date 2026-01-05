# Asset Pipeline Phase 2 - Testing Guide

## Status: Integration Complete ✅

**Commits**:
- Phase 1: `144c974` - Foundation (schema, repository, generator, worker)
- Phase 2: `69e0edf` - Integration (uploads, reads, conversion)

---

## What Was Integrated

### READ ENDPOINTS ✅
1. **Quote Line Item Files** (`GET /api/quotes/:quoteId/line-items/:lineItemId/files`)
   - Returns: `{ success, data: enrichedFiles[], assets: enrichedAssets[] }`
   - `assets` array includes linked assets with `thumbnailUrl`, `previewUrl`, `role`

2. **Order Files** (`GET /api/orders/:id/files`)
   - Returns: `{ success, data: enrichedFiles[], assets: enrichedAssets[] }`
   - `assets` array includes order-level linked assets

### UPLOAD ENDPOINTS ✅
3. **Quote Artwork Upload** (`POST /api/quotes/:quoteId/line-items/:lineItemId/files`)
   - After creating quote_attachment:
     - Creates asset with `fileKey`, `fileName`, `mimeType`, `sizeBytes`
     - Creates asset_link: `parentType='quote_line_item'`, `role='primary'`
   - **Fail-soft**: Asset errors logged, upload still succeeds

4. **Order Attachment Upload** (`POST /api/orders/:orderId/attachments`)
   - After creating order_attachment:
     - Creates asset with file metadata
     - Creates asset_link: `parentType='order'`, `role='attachment'`
   - **Fail-soft**: Asset errors logged, upload still succeeds

### CONVERSION ✅
5. **Quote→Order** (`convertQuoteToOrder` in orders.repo.ts)
   - Copies asset_links from `quote_line_item` → `order_line_item`
   - Preserves `assetId` (no preview regeneration)
   - Preserves `role` from source link
   - **Fail-soft**: Asset link copy errors logged, conversion succeeds

---

## Manual Testing Checklist

### Pre-Flight
- [ ] Migration 0013 applied successfully (check separate PowerShell window)
- [ ] Server running: `npm run dev` (check for worker startup logs)
- [ ] Both workers started: `[Thumbnail Worker]` and `[AssetPreviewWorker]`

### Test 1: Quote Artwork Upload + Preview Generation
**Goal**: Verify asset creation + thumbnail generation

1. **Upload PNG as Quote Artwork**
   - Navigate to Quotes → Open quote → Add line item
   - Upload PNG file (e.g., logo.png)
   - **Expected**: Upload succeeds, file appears in UI

2. **Check Database (Immediate)**
   ```sql
   SELECT id, file_name, mime_type, preview_status, created_at
   FROM assets
   WHERE organization_id = 'org_titan_001'
   ORDER BY created_at DESC
   LIMIT 5;
   ```
   - **Expected**: New asset row with `preview_status='pending'`

3. **Check Asset Links (Immediate)**
   ```sql
   SELECT al.*, a.file_name
   FROM asset_links al
   JOIN assets a ON al.asset_id = a.id
   WHERE al.organization_id = 'org_titan_001'
   AND al.parent_type = 'quote_line_item'
   ORDER BY al.created_at DESC
   LIMIT 5;
   ```
   - **Expected**: New asset_link with `role='primary'`, `parent_id` = quote line item ID

4. **Wait 10 Seconds**
   - Watch server logs for: `[AssetPreviewGenerator] Processing asset ...`

5. **Check Preview Status (After 10s)**
   ```sql
   SELECT id, file_name, preview_status, thumb_key, preview_key
   FROM assets
   WHERE organization_id = 'org_titan_001'
   AND preview_status = 'ready'
   ORDER BY created_at DESC
   LIMIT 5;
   ```
   - **Expected**: `preview_status='ready'`, `thumb_key` and `preview_key` populated

6. **Check Network Tab**
   - Open browser DevTools → Network
   - Reload quote page
   - **Expected**: Request to `/objects/thumbs/org_org_titan_001/asset/{assetId}/thumb.jpg` returns 200

7. **Verify Thumbnail Renders**
   - Quote line item should show thumbnail image (not icon)
   - **Expected**: `<img>` element with `src="/objects/thumbs/..."`

### Test 2: Quote→Order Conversion (No Regeneration)
**Goal**: Verify asset_links copied without preview regeneration

1. **Convert Quote to Order**
   - From Test 1 quote, click "Convert to Order"
   - Fill in required fields, submit

2. **Check Order Line Item Assets**
   ```sql
   SELECT oli.id as order_line_item_id, oli.quote_line_item_id,
          al.asset_id, al.role, a.file_name, a.preview_status
   FROM order_line_items oli
   LEFT JOIN asset_links al ON al.parent_id = oli.id AND al.parent_type = 'order_line_item'
   LEFT JOIN assets a ON al.asset_id = a.id
   WHERE oli.order_id = '<new_order_id>'
   ORDER BY oli.created_at DESC;
   ```
   - **Expected**: `asset_id` matches source quote asset (same ID)
   - **Expected**: `preview_status='ready'` (not 'pending')

3. **Check Server Logs**
   - Look for: `[CONVERT QUOTE] Copied X asset_links from quote to order`
   - **Expected**: No `[AssetPreviewGenerator] Processing asset` for copied assets

4. **Verify Order Thumbnails (Immediate)**
   - Navigate to Orders list
   - **Expected**: Order shows thumbnail immediately (no delay)
   - Open Order detail
   - **Expected**: Line item thumbnail renders instantly

5. **Check Network Tab**
   - **Expected**: Same `/objects/thumbs/.../thumb.jpg` URL as quote (assetId unchanged)
   - **Expected**: No new thumbnail generation requests

### Test 3: Order Attachment Upload
**Goal**: Verify order-level attachment creates asset

1. **Upload PDF as Order Attachment**
   - Open order → Attachments panel
   - Upload PDF file

2. **Check Database**
   ```sql
   SELECT al.*, a.file_name, a.mime_type, a.preview_status
   FROM asset_links al
   JOIN assets a ON al.asset_id = a.id
   WHERE al.organization_id = 'org_titan_001'
   AND al.parent_type = 'order'
   ORDER BY al.created_at DESC
   LIMIT 5;
   ```
   - **Expected**: New asset_link with `role='attachment'`
   - **Expected**: `preview_status='pending'`

3. **Wait 10s, Check Preview**
   - **Expected**: PDF first page rendered as thumbnail
   - **Expected**: Thumbnail appears in order attachments list

### Test 4: Legacy Compatibility
**Goal**: Verify old attachments still work

1. **Check Existing Orders/Quotes**
   - Navigate to orders/quotes created before Phase 2
   - **Expected**: Thumbnails still render (fallback to legacy fields)
   - **Expected**: No errors in console

2. **Verify Response Structure**
   - Open DevTools → Network → XHR
   - Check GET /api/quotes/:id/line-items/:id/files response
   - **Expected**: `{ success: true, data: [...], assets: [...] }`
   - **Expected**: `assets` array present even if empty

---

## SQL Diagnostic Queries

### Check Assets Summary
```sql
SELECT 
  preview_status,
  COUNT(*) as count,
  COUNT(CASE WHEN thumb_key IS NOT NULL THEN 1 END) as with_thumbnails
FROM assets
WHERE organization_id = 'org_titan_001'
GROUP BY preview_status;
```

### Check Asset Links by Type
```sql
SELECT 
  parent_type,
  role,
  COUNT(*) as count
FROM asset_links
WHERE organization_id = 'org_titan_001'
GROUP BY parent_type, role
ORDER BY parent_type, role;
```

### Find Pending Previews
```sql
SELECT 
  id, 
  file_name, 
  mime_type, 
  preview_status,
  created_at,
  NOW() - created_at as age
FROM assets
WHERE preview_status = 'pending'
ORDER BY created_at DESC;
```

### Check Storage Keys
```sql
SELECT 
  id, 
  file_name, 
  file_key,
  thumb_key,
  preview_key
FROM assets
WHERE organization_id = 'org_titan_001'
ORDER BY created_at DESC
LIMIT 10;
```

### Verify Quote→Order Link Copies
```sql
WITH quote_assets AS (
  SELECT DISTINCT al.asset_id, qli.quote_id, qli.id as quote_line_item_id
  FROM asset_links al
  JOIN quote_line_items qli ON al.parent_id = qli.id AND al.parent_type = 'quote_line_item'
  WHERE qli.quote_id = '<quote_id>'
),
order_assets AS (
  SELECT DISTINCT al.asset_id, oli.order_id, oli.quote_line_item_id
  FROM asset_links al
  JOIN order_line_items oli ON al.parent_id = oli.id AND al.parent_type = 'order_line_item'
  WHERE oli.order_id = '<order_id>'
)
SELECT 
  qa.asset_id as quote_asset_id,
  oa.asset_id as order_asset_id,
  CASE WHEN qa.asset_id = oa.asset_id THEN '✓ Match' ELSE '✗ Mismatch' END as status
FROM quote_assets qa
FULL OUTER JOIN order_assets oa ON qa.asset_id = oa.asset_id;
```

---

## Expected Server Logs

### On Upload (Quote Artwork)
```
[LineItemFiles:POST] Created attachment id=...
[LineItemFiles:POST] Created asset <asset_id> + linked to quote_line_item <line_item_id>
```

### On Worker Processing
```
[AssetPreviewWorker] Found 1 pending assets globally
[AssetPreviewGenerator] Processing asset <asset_id> (logo.png)
[AssetPreviewGenerator] Downloading uploads/org_.../asset/.../logo.png to ...
[AssetPreviewGenerator] Uploaded thumbnail to thumbs/org_.../asset/.../thumb.jpg
[AssetPreviewGenerator] Uploaded preview to thumbs/org_.../asset/.../preview.jpg
[AssetPreviewGenerator] Successfully processed asset <asset_id>
```

### On Quote→Order Conversion
```
[CONVERT QUOTE TO ORDER] Starting conversion...
[CONVERT QUOTE] Copied 3 asset_links from quote to order
```

### On Order Attachment Upload
```
[OrderAttachments:POST] Created asset <asset_id> + linked to order <order_id>
```

---

## Common Issues & Fixes

### Issue: No assets created on upload
**Symptom**: Asset table empty, only legacy attachments created
**Check**: Server logs for `Asset creation failed (non-blocking)` errors
**Fix**: Check `fileKey` is valid, organizationId is set, file metadata is complete

### Issue: Preview stuck in 'pending'
**Symptom**: Asset exists, but preview_status never changes
**Check**: Worker logs for processing attempts
**Fix**: 
- Verify worker started: Look for `[AssetPreviewWorker] Starting worker`
- Check file exists at fileKey location
- Check file type is supported (PNG, JPG, PDF only)

### Issue: Thumbnails not rendering
**Symptom**: Asset has thumb_key, but UI shows icon
**Check**: Network tab for 404 on /objects/* requests
**Fix**:
- Verify storage path matches: `thumbs/org_{orgId}/asset/{assetId}/thumb.jpg`
- Check file permissions in storage
- Verify enrichment returns `thumbnailUrl` field

### Issue: Quote→Order doesn't copy assets
**Symptom**: Order line items have no asset_links
**Check**: Server logs for `Failed to copy asset_links (non-blocking)`
**Fix**:
- Verify source quote line items have asset_links
- Check organizationId matches between quote and order
- Verify line item mapping (quoteLineItemId → orderLineItemId)

---

## Rollback Plan

If Phase 2 causes issues, rollback is safe:

1. **Revert commits**:
   ```bash
   git revert 69e0edf  # Phase 2 integration
   git revert 144c974  # Phase 1 foundation (if needed)
   ```

2. **No data loss**: Legacy thumbKey/previewKey fields still work

3. **No breaking changes**: All upload/read endpoints return success even if asset creation fails

---

## Success Criteria

✅ **Upload Flow**:
- PNG upload creates asset + asset_link
- Worker processes within 10s
- Thumbnail renders in UI

✅ **Conversion Flow**:
- Quote→Order copies asset_links
- No preview regeneration (same assetId)
- Order thumbnails render immediately

✅ **Read Flow**:
- GET endpoints return `assets` array
- Enriched URLs include `thumbnailUrl`, `previewUrl`
- Legacy attachments still work

✅ **No Regressions**:
- Existing quotes/orders still functional
- Upload failures don't block creation
- Asset failures don't crash server

---

## Next Steps (Future)

After Phase 2 verification:
- [ ] Remove legacy `thumb_status` polling from old worker
- [ ] Migrate existing attachments to asset pipeline (backfill)
- [ ] Decommission `server/workers/thumbnailWorker.ts`
- [ ] Add prepress workflow (asset_status transitions)
- [ ] Add variant cleanup (orphaned thumb/preview deletion)

