# Bug Reports Multiple Screenshots Implementation

## Summary

Enhanced the bug reporting system to support multiple screenshots (up to 5) instead of just one, with improved thumbnail previews and backward compatibility for existing single-screenshot reports.

## Changes Overview

### 1. Database Migration

**File:** `server/db/migrations/0049_bug_reports_multiple_screenshots.sql`

- Added `screenshot_urls TEXT[]` column to `bug_reports` table
- Backfilled existing `screenshot_url` values into the new array column
- Maintained `screenshot_url` column for backward compatibility
- Marked old column as DEPRECATED in comments

### 2. Schema Updates

**File:** `shared/schema.ts`

- Added `screenshotUrls` field as TEXT array with default empty array
- Kept `screenshotUrl` field with DEPRECATED comment
- Both fields are optional/nullable

### 3. Backend API Changes

**File:** `server/routes/bugReports.ts`

#### Screenshot Upload Endpoint

**Before:**
- Accepted single file via `screenshot` field
- Returned `{ screenshotUrl: string }`
- Limited to 1 file

**After:**
- Accepts multiple files via `screenshots` field(s)
- Returns `{ screenshotUrls: string[], errors?: string[] }`
- Limited to 5 files
- Processes files in parallel with error tolerance
- Each file validated independently (MIME type, size)
- Failed uploads logged but don't block successful ones

#### Create Bug Report Endpoint

**Updated Schema:**
```typescript
{
  screenshotUrl?: string;    // DEPRECATED: backward compatibility
  screenshotUrls?: string[]; // NEW: up to 5 URLs
}
```

**Logic:**
- Accepts both `screenshotUrl` (legacy) and `screenshotUrls` (new)
- Merges into `finalScreenshotUrls` array
- Stores both in database for backward compatibility

### 4. Frontend Changes

#### Bug Report Modal

**File:** `client/src/components/bug-report/BugReportModal.tsx`

**Before:**
- Single file input
- Text display of filename
- No preview

**After:**
- Multiple file input (`multiple` attribute)
- Thumbnail preview grid (2 columns)
- Individual remove buttons per screenshot
- Client-side validation:
  - Max 5 files
  - Max 5 MB per file
  - Toast notifications for violations
- Hover effects on thumbnails
- File names displayed under previews

**API Integration:**
- Uploads all selected files to `/api/bug-reports/screenshot`
- Sends `screenshotUrls` array to create endpoint

#### Bug Reports Page (Admin View)

**File:** `client/src/pages/admin/BugReportsPage.tsx`

**Updated Interface:**
```typescript
interface BugReportDetail {
  screenshotUrl: string | null;   // DEPRECATED: backward compatibility
  screenshotUrls: string[];       // NEW
  // ... other fields
}
```

**Display Logic:**
- Checks `screenshotUrls` array first
- Falls back to legacy `screenshotUrl` if array is empty
- Single screenshot: Full-width display (max 320px height)
- Multiple screenshots: 2-column grid (max 200px height each)
- Click to open in new tab
- Hover opacity effect

## Backward Compatibility

✅ **Fully backward compatible**

1. **Database:** Old `screenshot_url` column preserved
2. **API:** Accepts both old and new formats
3. **Display:** Handles both single and multiple screenshots
4. **Migration:** Automatically backfills existing data

## Storage Architecture

### Current Implementation

**Supabase Storage (Production):**
- Files stored at `bug-screenshots/{orgId}/{uuid}.{ext}`
- Returns public URL via `getPublicUrl()`
- Requires bucket configured as public

**Local Development:**
- Files stored in `uploads/bug-screenshots/{orgId}/{filename}`
- Served via `/api/bug-reports/screenshot/file/:orgId/:filename` endpoint
- URL format: `http://localhost:5000/api/bug-reports/screenshot/file/{orgId}/{filename}`

### URL Storage Strategy

**Current approach:** Store full URLs in database
- ✅ Works for public Supabase buckets
- ✅ Works for local development URLs
- ⚠️ May break if bucket becomes private

**Note:** If using private Supabase buckets, URLs will need to be regenerated as signed URLs on display. Current implementation assumes public buckets.

## Broken Link Issue - Root Causes & Solutions

### Issue 1: Private Supabase Bucket

**Problem:** If Supabase bucket is private, `getPublicUrl()` returns a URL but accessing it gives 403 Forbidden.

**Solution:**
```typescript
// In storeScreenshot function (bugReports.ts)
if (isSupabaseConfigured()) {
  const { SupabaseStorageService } = await import("../supabaseStorage");
  const svc = new SupabaseStorageService();
  const result = await svc.uploadFile(storageKey, fileBuffer, mimeType);
  
  // Option 1: Make bucket public (recommended for bug reports)
  return result.publicUrl ?? `/api/bug-reports/screenshot/file/${orgId}/${filename}`;
  
  // Option 2: Store path and generate signed URL on display
  // return storageKey; // Store path only
  // Then in display component, call API to get signed URL
}
```

**To make bucket public:**
1. Go to Supabase Dashboard → Storage
2. Select your bucket
3. Settings → Make bucket public

### Issue 2: Expired Signed URLs

**Problem:** If storing signed URLs (not the case currently), they expire after 1 hour.

**Solution:** Store paths, not signed URLs. Generate signed URLs dynamically on display.

### Issue 3: Local Development File Access

**Problem:** Local files might not be accessible if server restarts or `uploads/` directory is cleared.

**Solution:**
- Ensure `uploads/` directory persists
- Add to `.gitignore` but not to cleanup scripts
- Consider syncing to Supabase even in dev mode

## Validation & Constraints

### Client-Side
- Max 5 files per submission
- Max 5 MB per file
- MIME types: `image/png`, `image/jpeg`, `image/webp`
- Toast notifications for violations

### Server-Side
- Max 5 files (Busboy limit)
- Max 5 MB per file (fileSize limit)
- MIME type whitelist: PNG, JPEG, JPG, WebP
- Individual file validation with error collection

### Database
- `screenshot_urls TEXT[]` - no length limit at DB level
- App enforces max 5 URLs via API validation

## Testing Checklist

### Manual Testing

#### Desktop Upload
```bash
# 1. Create new bug report
# 2. Select 3 image files
# 3. Verify thumbnail previews appear in 2-column grid
# 4. Remove one screenshot
# 5. Add 2 more screenshots (total 4)
# 6. Submit report
# 7. View bug report detail
# 8. Verify all 4 screenshots display in grid
# 9. Click each screenshot to open in new tab
```

#### Mobile Upload
```bash
# 1. Open bug report modal on mobile browser
# 2. Click "Attach screenshots"
# 3. Select 2 photos from camera roll
# 4. Verify thumbnails display correctly (responsive grid)
# 5. Submit report
# 6. View on desktop - verify mobile screenshots visible
```

#### Edge Cases
```bash
# 1. Try to upload 6 files → Should show toast error
# 2. Try to upload 10 MB file → Should show toast error
# 3. Try to upload non-image file → Should show toast error
# 4. Upload 1 screenshot, remove it, upload different one → Should work
# 5. View old bug report (from before migration) → Should show legacy screenshot
```

#### Backward Compatibility
```bash
# 1. Apply migration WITHOUT running backfill
# 2. View old bug report with screenshot_url populated
# 3. Verify screenshot displays correctly
# 4. Create new report with multiple screenshots
# 5. Verify both old and new reports display correctly
```

### API Testing

#### Upload Multiple Screenshots
```powershell
# Create multipart form data with 3 images
$boundary = [System.Guid]::NewGuid().ToString()
$headers = @{
    "Content-Type" = "multipart/form-data; boundary=$boundary"
}

# Test endpoint
curl.exe -X POST http://localhost:5000/api/bug-reports/screenshot `
  -H "Cookie: connect.sid=YOUR_SESSION_ID" `
  -F "screenshots=@screenshot1.png" `
  -F "screenshots=@screenshot2.png" `
  -F "screenshots=@screenshot3.png"

# Expected response:
# {
#   "success": true,
#   "screenshotUrls": [
#     "http://localhost:5000/api/bug-reports/screenshot/file/org_id/uuid1.png",
#     "http://localhost:5000/api/bug-reports/screenshot/file/org_id/uuid2.png",
#     "http://localhost:5000/api/bug-reports/screenshot/file/org_id/uuid3.png"
#   ]
# }
```

#### Create Bug Report with Multiple Screenshots
```powershell
$body = @{
    title = "Test Bug with Multiple Screenshots"
    description = "Testing multiple screenshot upload feature"
    severity = "medium"
    url = "http://localhost:5000/test"
    screenshotUrls = @(
        "http://localhost:5000/api/bug-reports/screenshot/file/org_id/uuid1.png",
        "http://localhost:5000/api/bug-reports/screenshot/file/org_id/uuid2.png"
    )
} | ConvertTo-Json

curl.exe -X POST http://localhost:5000/api/bug-reports `
  -H "Content-Type: application/json" `
  -H "Cookie: connect.sid=YOUR_SESSION_ID" `
  -d $body

# Expected response:
# {
#   "id": "bug_report_id"
# }
```

## Migration Instructions

### 1. Apply Migration

```bash
# Option A: Using apply-manual-migration script
npx tsx apply-manual-migration.ts server/db/migrations/0049_bug_reports_multiple_screenshots.sql

# Option B: Direct psql
psql $DATABASE_URL -f server/db/migrations/0049_bug_reports_multiple_screenshots.sql
```

### 2. Verify Migration

```sql
-- Check column exists
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'bug_reports'
  AND column_name IN ('screenshot_url', 'screenshot_urls');

-- Check backfill (should show counts)
SELECT
  COUNT(*) FILTER (WHERE screenshot_url IS NOT NULL) AS has_legacy_url,
  COUNT(*) FILTER (WHERE cardinality(screenshot_urls) > 0) AS has_new_urls,
  COUNT(*) FILTER (WHERE screenshot_url IS NOT NULL AND cardinality(screenshot_urls) = 0) AS migration_failed
FROM bug_reports;

-- If migration_failed > 0, re-run backfill:
UPDATE bug_reports
SET screenshot_urls = ARRAY[screenshot_url]
WHERE screenshot_url IS NOT NULL
  AND screenshot_urls = '{}';
```

### 3. Restart Application

```bash
npm run dev
```

### 4. Update Journal

Already updated in `server/db/migrations/meta/_journal.json`:
- idx: 41
- when: 1739318963485
- tag: "0049_bug_reports_multiple_screenshots"

## Performance Considerations

### Upload Performance
- Multiple files uploaded in single request (less HTTP overhead)
- Parallel processing on server (async file handling)
- Each file independently validated (fail-soft approach)

### Display Performance
- Thumbnail grid uses CSS grid (efficient layout)
- Images lazy-loaded by browser
- Object URLs revoked after preview load (memory cleanup)
- Max 5 images limits DOM size

### Storage Costs
- 5 screenshots × 5 MB = 25 MB max per bug report
- Typical screenshot: 200-500 KB
- Realistic storage: 1-2 MB per bug report
- 1000 bug reports ≈ 1-2 GB storage

## Future Enhancements

### 1. Image Compression
```typescript
// Client-side compression before upload
import imageCompression from 'browser-image-compression';

const compressedFile = await imageCompression(file, {
  maxSizeMB: 1,
  maxWidthOrHeight: 1920,
  useWebWorker: true
});
```

### 2. Lightbox/Gallery View
- Full-screen image viewer
- Arrow key navigation
- Zoom in/out
- Download all as ZIP

### 3. Drag & Drop
- Drag files onto modal
- Reorder screenshots before upload
- Visual drop zone

### 4. Private Bucket Support
```typescript
// Store paths instead of URLs
async function storeScreenshot(...): Promise<string> {
  const storageKey = `bug-screenshots/${orgId}/${filename}`;
  await svc.uploadFile(storageKey, buffer, mimeType);
  return storageKey; // Store path, not URL
}

// Generate signed URL on display
async function getScreenshotSignedUrl(path: string): Promise<string> {
  const svc = new SupabaseStorageService();
  return await svc.getSignedDownloadUrl(path, 3600); // 1 hour expiry
}
```

### 5. Annotate Screenshots
- Draw arrows/boxes on screenshots
- Add text labels
- Highlight problem areas
- Save annotations with report

## Rollback Plan

If issues arise, rollback is safe and non-destructive:

```sql
-- 1. New reports will still work (screenshotUrls field optional)
-- 2. Old reports continue working (screenshot_url preserved)
-- 3. To fully rollback, simply use old code version
--    Migration does not need to be reversed

-- Optional: Remove new column (not recommended)
-- ALTER TABLE bug_reports DROP COLUMN IF EXISTS screenshot_urls;
```

## Files Modified

1. ✅ `server/db/migrations/0049_bug_reports_multiple_screenshots.sql` (NEW)
2. ✅ `server/db/migrations/meta/_journal.json` (UPDATED)
3. ✅ `shared/schema.ts` (UPDATED - added screenshotUrls field)
4. ✅ `server/routes/bugReports.ts` (UPDATED - upload + create endpoints)
5. ✅ `client/src/components/bug-report/BugReportModal.tsx` (UPDATED - multiple file input)
6. ✅ `client/src/pages/admin/BugReportsPage.tsx` (UPDATED - gallery display)

## TypeScript Compilation

✅ **All modified files compile without errors**

Pre-existing errors in other files (not related to this change):
- `server/routes/platform.ts` (express-rate-limit import, req type)
- `server/storage/*.ts` (type assertions)
- `shared/schema.ts` (circular reference warnings - pre-existing)

## Success Criteria

- [x] Database migration created and documented
- [x] Schema updated with new field + backward compatibility
- [x] Backend accepts multiple file uploads (up to 5)
- [x] Backend stores screenshot URLs in array
- [x] Frontend shows thumbnail previews in grid
- [x] Frontend allows individual screenshot removal
- [x] Frontend validates file count and size
- [x] Admin view displays screenshot gallery
- [x] Backward compatibility with old single-screenshot reports
- [x] No TypeScript errors in modified files
- [x] Zero breaking changes for existing bug reports

## Known Limitations

1. **Bucket Privacy:** Current implementation assumes public Supabase bucket. Private buckets will return 403 errors on screenshot URLs.

2. **URL Permanence:** URLs are stored directly in database. If Supabase bucket is deleted/renamed, URLs become invalid.

3. **No Compression:** Screenshots stored at full resolution (up to 5 MB each).

4. **No Annotation:** Can't draw on screenshots to highlight issues.

5. **Mobile Browser Support:** Multiple file selection may vary across mobile browsers (iOS Safari, Android Chrome, etc.).

## Configuration Required

### Supabase Setup (Production)

```bash
# .env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
SUPABASE_BUCKET=titan-private
```

**Bucket Configuration:**
- Name: `titan-private` (or custom via env var)
- Public: ✅ YES (for public URLs to work)
- File size limit: 50 MB (Supabase default)
- Allowed MIME types: Configure in Supabase dashboard or keep unrestricted

### Local Development Setup

```bash
# Automatic - files stored in uploads/bug-screenshots/
# No additional configuration needed
```

## Monitoring & Observability

### Console Logs
- Upload failures: `[BugReports] Screenshot upload failed:`
- File stream errors: `[BugReports] File stream error:`
- Busboy errors: `[BugReports] Busboy error:`

### Metrics to Track
- Average screenshots per bug report
- Upload success/failure rate
- Storage usage growth
- Average file size per screenshot

### Alerts to Configure
- Upload failure rate > 10%
- Individual file > 4.5 MB (approaching limit)
- Bucket storage > 90% capacity
- 403 errors on screenshot URLs (indicates bucket privacy issue)

---

**Implementation Date:** 2026-02-20  
**Migration Number:** 0049  
**Breaking Changes:** None  
**Rollback Required:** No  
