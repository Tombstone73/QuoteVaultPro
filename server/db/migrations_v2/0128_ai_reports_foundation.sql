-- Stage 8 analytical reporting: immutable saved report versions and opaque
-- share tokens. Definitions and snapshots are validated in the application;
-- this schema deliberately contains no executable query text.
CREATE TABLE IF NOT EXISTS ai_reports (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  owner_user_id varchar NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  conversation_id varchar REFERENCES ai_conversations(id) ON DELETE SET NULL,
  source_turn_id varchar REFERENCES ai_turns(id) ON DELETE SET NULL,
  title varchar(240) NOT NULL,
  description text,
  status varchar(32) NOT NULL DEFAULT 'ready',
  report_type varchar(80) NOT NULL DEFAULT 'analytical',
  audience varchar(32) NOT NULL DEFAULT 'private',
  definition_json jsonb NOT NULL,
  query_plan_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  data_snapshot_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  snapshot_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  data_snapshot_at timestamptz NOT NULL,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_reports_org_status_updated_idx ON ai_reports(organization_id, status, updated_at);
CREATE INDEX IF NOT EXISTS ai_reports_org_owner_updated_idx ON ai_reports(organization_id, owner_user_id, updated_at);

CREATE TABLE IF NOT EXISTS ai_report_versions (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id varchar NOT NULL REFERENCES ai_reports(id) ON DELETE CASCADE,
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  version_number integer NOT NULL,
  definition_json jsonb NOT NULL,
  data_snapshot_json jsonb NOT NULL,
  created_by_user_id varchar REFERENCES users(id) ON DELETE SET NULL,
  change_summary varchar(500),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(report_id, version_number)
);
CREATE INDEX IF NOT EXISTS ai_report_versions_org_report_created_idx ON ai_report_versions(organization_id, report_id, created_at);

CREATE TABLE IF NOT EXISTS ai_report_shares (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id varchar NOT NULL REFERENCES ai_reports(id) ON DELETE CASCADE,
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  token_hash varchar(128) NOT NULL,
  audience varchar(32) NOT NULL DEFAULT 'customer_safe',
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  download_allowed boolean NOT NULL DEFAULT false,
  created_by_user_id varchar REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_report_shares_token_hash_uidx UNIQUE(token_hash)
);
CREATE INDEX IF NOT EXISTS ai_report_shares_org_report_idx ON ai_report_shares(organization_id, report_id);
CREATE INDEX IF NOT EXISTS ai_report_shares_expires_at_idx ON ai_report_shares(expires_at);

CREATE TABLE IF NOT EXISTS ai_report_views (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  report_id varchar NOT NULL REFERENCES ai_reports(id) ON DELETE CASCADE,
  share_id varchar NOT NULL REFERENCES ai_report_shares(id) ON DELETE CASCADE,
  viewed_at timestamptz NOT NULL DEFAULT now(),
  viewer_hash varchar(128)
);
CREATE INDEX IF NOT EXISTS ai_report_views_org_report_viewed_idx ON ai_report_views(organization_id, report_id, viewed_at);
CREATE INDEX IF NOT EXISTS ai_report_views_share_viewed_idx ON ai_report_views(share_id, viewed_at);

-- Confirmed access path for posted-invoice aggregate reporting.
CREATE INDEX IF NOT EXISTS invoices_org_status_issue_date_idx
  ON invoices(organization_id, status, issue_date);
