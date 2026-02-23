# Bug Report Screenshot Fix - Quick Test Guide

## 🔍 Pre-Flight Checks

### 1. Verify Bucket Exists
```sql
-- In Supabase SQL Editor
SELECT name FROM storage.buckets WHERE name = 'art';
-- Should return: art
```

### 2. Check Environment Variables
```bash
# .env file must have:
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJhbG...  # Service role key (NOT anon key)
```

### 3. Restart Server
```bash
npm run dev
```

## ✅ Test Workflow

### Test 1: Upload Screenshot (Desktop)

1. **Open bug report modal** (Click bug icon in app)
2. **Fill form:**
   - Title: "Test multiple screenshots"
   - Severity: Medium
   - Description: "Testing new bucket configuration"
3. **Attach 2-3 screenshots**
4. **Submit**
5. **Check server logs:**
   ```
   [BugReports] Uploading screenshot: { bucket: 'art', path: 'bug-reports/...' }
   [BugReports] Upload successful: bug-reports/temp-abc123/...
   ```

### Test 2: Verify Database Storage

```sql
-- Check most recent bug report
SELECT 
  id, 
  title, 
  screenshot_urls,
  created_at 
FROM bug_reports 
ORDER BY created_at DESC 
LIMIT 1;

-- screenshot_urls should show:
-- ["bug-reports/temp-abc123/1708464000000-def456.png", "bug-reports/temp-abc123/..."]
-- NOT: ["https://xyz.supabase.co/storage/..."]
```

### Test 3: View Screenshots (Admin Panel)

1. **Navigate to Admin → Bug Reports**
2. **Click on test bug report**
3. **Verify:**
   - Screenshots section appears
   - Images load (no "bucket not found")
   - Grid layout shows all screenshots
4. **Check browser DevTools → Network:**
   ```
   GET /api/bug-reports/{id}/screenshot-urls
   Response: { success: true, data: [{ path: "...", url: "https://...?token=..." }] }
   ```
5. **Click an image** to open in new tab
6. **Verify signed URL works** (image displays in new tab)

### Test 4: Mobile Upload

1. **Open bug modal on mobile browser**
2. **Click "Attach screenshots"**
3. **Select 2 photos from camera roll**
4. **Submit**
5. **Verify upload logs show bucket: 'art'**

### Test 5: Local Development (No Supabase)

1. **Temporarily disable Supabase:**
   ```bash
   # Comment out in .env:
   # SUPABASE_URL=...
   # SUPABASE_SERVICE_ROLE_KEY=...
   ```
2. **Restart server:** `npm run dev`
3. **Upload screenshot**
4. **Check file created:**
   ```bash
   ls uploads/bug-reports/temp-*/
   # Should show: {timestamp}-{random}.png
   ```
5. **View bug report**
6. **Verify local URL:** `http://localhost:5000/api/bug-reports/screenshot/file/...`

### Test 6: Backward Compatibility

1. **Find old bug report** (before this fix) with `screenshot_url` populated
2. **View detail**
3. **Verify legacy screenshot still displays**
4. **Create new report with screenshots**
5. **Verify both old and new work**

## 🚨 Common Issues

### Issue: "bucket not found"

**Fix:**
```bash
# 1. Check server logs - what bucket is being used?
[BugReports] Uploading screenshot: { bucket: '???', ... }

# 2. If not 'art', check env var:
echo $SUPABASE_BUG_REPORT_BUCKET  # Should be empty or 'art'

# 3. Verify bucket exists in Supabase Dashboard → Storage
```

### Issue: Images not loading (403)

**Fix:**
```bash
# 1. Check signed URL response:
# Browser DevTools → Network → /api/bug-reports/{id}/screenshot-urls
# Should return URLs with ?token= parameter

# 2. Verify service role key (not anon key):
echo $SUPABASE_SERVICE_ROLE_KEY | cut -c1-20
# Should start with: eyJhbGciOiJIUzI1NiI...

# 3. Check bucket permissions in Supabase
```

### Issue: Upload fails silently

**Fix:**
```bash
# 1. Check server logs for errors:
[BugReports] Supabase upload failed: ...

# 2. Verify file size < 5 MB
# 3. Verify MIME type is image/png, image/jpeg, or image/webp
# 4. Check Supabase bucket file size limits
```

## 📊 Success Indicators

✅ Server logs show: `bucket: 'art'`  
✅ Database has paths: `["bug-reports/..."]`  
✅ Detail view loads images  
✅ No "bucket not found" errors  
✅ Signed URLs have `?token=` parameter  
✅ Old bug reports still work  

## 🔧 Diagnostic Commands

### Check uploaded files in Supabase
```sql
-- In Supabase SQL Editor
SELECT 
  name, 
  bucket_id,
  created_at
FROM storage.objects 
WHERE bucket_id = 'art' 
  AND name LIKE 'bug-reports/%'
ORDER BY created_at DESC
LIMIT 10;
```

### Check bug report screenshot data
```sql
SELECT 
  id,
  title,
  array_length(screenshot_urls, 1) as screenshot_count,
  screenshot_urls[1] as first_screenshot_path,
  created_at
FROM bug_reports
WHERE screenshot_urls != '{}'
ORDER BY created_at DESC
LIMIT 5;
```

### Verify local uploads
```bash
# Windows PowerShell
Get-ChildItem -Recurse uploads/bug-reports/ | Select-Object FullName, Length, LastWriteTime

# Should show files like:
# uploads/bug-reports/temp-abc123/1708464000000-def456.png
```

## 📝 Quick Validation Script

```bash
# PowerShell - Test complete workflow
Write-Host "1. Checking bucket exists..." -ForegroundColor Yellow
# Run SQL query in Supabase

Write-Host "2. Uploading test screenshot..." -ForegroundColor Yellow
# Upload via UI

Write-Host "3. Checking database..." -ForegroundColor Yellow
# Run SQL query

Write-Host "4. Viewing screenshot..." -ForegroundColor Yellow
# Open detail view

Write-Host "5. Verifying signed URL..." -ForegroundColor Yellow
# Check Network tab

Write-Host "✅ All tests passed!" -ForegroundColor Green
```

---

**If all tests pass:** Bug report screenshots are fully operational with "art" bucket ✅  
**If any test fails:** Check corresponding troubleshooting section above
