-- Migration 0089: Bug report screenshot attachment metadata
-- Adds per-screenshot metadata while preserving legacy screenshot_url and screenshot_urls.

ALTER TABLE bug_reports
  ADD COLUMN IF NOT EXISTS screenshot_attachments jsonb NOT NULL DEFAULT '[]'::jsonb;

UPDATE bug_reports
SET screenshot_attachments = (
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'filename', COALESCE(NULLIF(regexp_replace(path_value, '^.*\/', ''), ''), 'screenshot-' || ordinality::text || '.png'),
        'mimeType', 'image/*',
        'size', 0,
        'storagePath', path_value,
        'displayOrder', ordinality - 1
      )
      ORDER BY ordinality
    ),
    '[]'::jsonb
  )
  FROM unnest(
    CASE
      WHEN screenshot_urls IS NOT NULL AND array_length(screenshot_urls, 1) > 0 THEN screenshot_urls
      WHEN screenshot_url IS NOT NULL AND screenshot_url <> '' THEN ARRAY[screenshot_url]
      ELSE ARRAY[]::text[]
    END
  ) WITH ORDINALITY AS paths(path_value, ordinality)
)
WHERE screenshot_attachments = '[]'::jsonb
  AND (
    (screenshot_urls IS NOT NULL AND array_length(screenshot_urls, 1) > 0)
    OR (screenshot_url IS NOT NULL AND screenshot_url <> '')
  );

CREATE INDEX IF NOT EXISTS bug_reports_screenshot_attachments_gin_idx
  ON bug_reports USING gin (screenshot_attachments);
