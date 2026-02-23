/**
 * Migration 0049: Add bug report multiple screenshots support
 * 
 * Changes:
 * - Add screenshot_urls TEXT[] column (array of storage paths for multiple screenshots)
 * - Backfill from existing screenshot_url column where it exists
 * - Keep screenshot_url column for backward compatibility (deprecated)
 * 
 * Note: Storage paths are stored in format:
 *   - Supabase: "org_{orgId}/bug-screenshots/{bugReportId}/{timestamp}-{random}.ext"
 *   - Local dev: "local:bug-screenshots/{bugReportId}/{timestamp}-{random}.ext"
 * 
 * Signed URLs are generated at view time via GET /api/bug-reports/:id/screenshot-urls
 */

-- Add screenshot_urls array column for multiple screenshots
ALTER TABLE bug_reports
  ADD COLUMN IF NOT EXISTS screenshot_urls TEXT[] DEFAULT '{}';

-- Backfill screenshot_urls from legacy screenshot_url column
UPDATE bug_reports
SET screenshot_urls = ARRAY[screenshot_url]
WHERE screenshot_url IS NOT NULL
  AND screenshot_url <> ''
  AND screenshot_urls = '{}';

-- Create index for querying reports with screenshots
CREATE INDEX IF NOT EXISTS idx_bug_reports_has_screenshots
  ON bug_reports ((CASE WHEN array_length(screenshot_urls, 1) > 0 THEN 1 ELSE 0 END))
  WHERE array_length(screenshot_urls, 1) > 0;
