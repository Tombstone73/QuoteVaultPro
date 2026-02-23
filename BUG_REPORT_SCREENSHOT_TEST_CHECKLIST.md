# Bug Report Screenshot Test Checklist

## Pre-flight Checks

1. **Verify Supabase bucket exists:**
   - Go to Supabase Dashboard → Storage → Buckets
   - Confirm "titan-private" bucket exists
   - If not, create it with public: false

2. **Check environment variables:**
   ```bash
   # Optional: Set custom bucket name (defaults to "titan-private")
   SUPABASE_BUG_REPORT_BUCKET=titan-private
   ```

3. **Verify migration applied:**
   ```sql
   SELECT column_name FROM information_schema.columns 
   WHERE table_name = 'bug_reports' AND column_name = 'screenshot_urls';
   ```
   Should return `screenshot_urls` column.

## Test Scenarios

### Test 1: Upload 2 Screenshots
1. Navigate to Bug Report form
2. Click "Report a Bug"
3. Fill out title, description, severity
4. Upload 2 screenshots (PNG/JPEG, < 5MB each)
5. Submit form
6. **Expected:** Success message, no errors in console

### Test 2: Verify Storage Paths
1. Check database for newly created bug report:
   ```sql
   SELECT id, screenshot_urls FROM bug_reports 
   ORDER BY created_at DESC LIMIT 1;
   ```
2. **Expected:** `screenshot_urls` contains paths like:
   ```json
   ["org_titan_001/bug-screenshots/{bugReportId}/{timestamp}-{uuid}.png"]
   ```
   NOT full URLs starting with "https://"

### Test 3: Admin Panel Display
1. Login as admin/owner
2. Navigate to Admin Tools → Bug Reports
3. Click on the newly created bug report
4. Scroll to Screenshots section
5. **Expected:** 
   - 2 screenshot thumbnails displayed
   - Images load without "Image unavailable" placeholder
   - No console errors about bucket not found

### Test 4: Signed URL Generation
1. Open browser DevTools → Network tab
2. View bug report detail (from Test 3)
3. Filter for `/api/bug-reports/{id}/screenshot-urls`
4. **Expected response:**
   ```json
   {
     "success": true,
     "data": [
       { 
         "path": "org_titan_001/bug-screenshots/...",
         "url": "https://...supabase.co/storage/v1/object/sign/titan-private/..."
       }
     ]
   }
   ```

### Test 5: Server Logs
1. Tail server logs during screenshot upload:
   ```bash
   # Look for these log entries
   [BugReports] Uploading screenshot: {
     bucket: 'titan-private',
     path: 'org_titan_001/bug-screenshots/...',
     size: 123456,
     mimeType: 'image/png'
   }
   [BugReports] Upload successful: org_titan_001/bug-screenshots/...
   ```
2. **Expected:** No errors about missing bucket

### Test 6: Local Development (Optional)
1. Run without Supabase configured (comment out env vars)
2. Upload screenshot
3. **Expected:**
   - File saved to `uploads/bug-screenshots/{bugReportId}/`
   - Path stored as `local:bug-screenshots/{bugReportId}/{filename}`
   - Image served via `/api/bug-reports/screenshot/file/{bugReportId}/{filename}`

## Common Issues

| Issue | Cause | Fix |
|-------|-------|-----|
| "bucket not found" | titan-private bucket doesn't exist | Create bucket in Supabase Dashboard |
| Images don't load | Signed URL generation failed | Check server logs for error details |
| Paths are URLs | Old code running | Restart server, clear browser cache |
| Upload fails | File too large (>5MB) | Use smaller image or compress |

## Success Indicators

✅ Screenshots upload without errors  
✅ Database contains storage paths (not URLs)  
✅ Admin panel displays screenshots correctly  
✅ Server logs show `bucket: 'titan-private'`  
✅ Signed URLs generated with 1-hour expiry  
✅ No TypeScript compilation errors

## Rollback Plan

If issues occur:
1. Revert changes to `server/routes/bugReports.ts`
2. Set `SUPABASE_BUG_REPORT_BUCKET=art` in environment
3. Restart server
4. Investigate bucket configuration in Supabase Dashboard
