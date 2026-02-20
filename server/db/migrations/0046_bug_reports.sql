-- Migration 0046: Bug Reports
-- Creates bug_reports table for tracking user-submitted in-app bug reports.
--
-- ID convention: character varying PRIMARY KEY DEFAULT gen_random_uuid()::text
-- (mirrors migration 0044 / 0035 convention for this codebase).
--
-- severity values validated at app layer: 'low' | 'medium' | 'high' | 'critical'
-- status values: 'open' | 'in_review' | 'resolved' | 'closed'

CREATE TABLE IF NOT EXISTS bug_reports (
  id                    character varying PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id                character varying NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  created_by_user_id    character varying NULL     REFERENCES users(id)         ON DELETE SET NULL,
  created_by_email      text NOT NULL,
  title                 text NOT NULL,
  description           text NOT NULL,
  severity              text NOT NULL,
  url                   text NOT NULL,
  user_agent            text NOT NULL,
  screen_width          integer NULL,
  screen_height         integer NULL,
  screenshot_url        text NULL,
  status                text NOT NULL DEFAULT 'open',
  metadata              jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS bug_reports_org_created_at_idx ON bug_reports (org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS bug_reports_org_severity_idx   ON bug_reports (org_id, severity);
CREATE INDEX IF NOT EXISTS bug_reports_org_status_idx     ON bug_reports (org_id, status);

COMMENT ON TABLE bug_reports IS 'User-submitted in-app bug reports, org-scoped. severity: low|medium|high|critical. status: open|in_review|resolved|closed.';
