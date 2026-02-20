-- Migration 0047: Bug Report Notes
-- Adds internal admin-only notes to bug reports + status update support.
--
-- ID convention: character varying PRIMARY KEY DEFAULT gen_random_uuid()::text
-- (mirrors existing project convention from migrations 0035, 0044, 0046).

CREATE TABLE IF NOT EXISTS bug_report_notes (
  id                  character varying PRIMARY KEY DEFAULT gen_random_uuid()::text,
  bug_report_id       character varying NOT NULL REFERENCES bug_reports(id) ON DELETE CASCADE,
  org_id              character varying NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  created_by_user_id  character varying NULL     REFERENCES users(id)        ON DELETE SET NULL,
  created_by_email    text NOT NULL,
  note                text NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS bug_report_notes_bug_id_idx ON bug_report_notes (bug_report_id, created_at ASC);
CREATE INDEX IF NOT EXISTS bug_report_notes_org_idx    ON bug_report_notes (org_id);

COMMENT ON TABLE bug_report_notes IS 'Admin-only internal notes on bug reports. Ordered by created_at ASC. Always org-scoped via org_id.';
