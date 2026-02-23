-- Migration 0057: Add bug_reports.type for bug vs feature feedback
--
-- Rules:
-- - type is immutable after creation (app-level behavior)
-- - default is 'bug'
-- - allowed values: 'bug' | 'feature'

ALTER TABLE bug_reports
  ADD COLUMN IF NOT EXISTS type text NOT NULL DEFAULT 'bug';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'bug_reports_type_check'
  ) THEN
    ALTER TABLE bug_reports
      ADD CONSTRAINT bug_reports_type_check
      CHECK (type IN ('bug', 'feature'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS bug_reports_org_type_idx
  ON bug_reports (org_id, type);

COMMENT ON COLUMN bug_reports.type IS 'Feedback type: bug or feature';