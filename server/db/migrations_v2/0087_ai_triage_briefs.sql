-- Migration 0087: AI Triage Brief foundation
--
-- Adds a saved advisory planning artifact for collection-level Bug Reports
-- triage. This does not mutate bug report status, severity, priority, roadmap,
-- or work items.

ALTER TABLE organization_ai_settings
  ADD COLUMN IF NOT EXISTS triage_brief_enabled boolean NOT NULL DEFAULT false;

ALTER TABLE ai_usage
  DROP CONSTRAINT IF EXISTS ai_usage_feature_check;

ALTER TABLE ai_usage
  ADD CONSTRAINT ai_usage_feature_check
    CHECK (feature IN (
      'bug_review',
      'triage_brief',
      'feature_review',
      'duplicate_detection',
      'order_parsing',
      'email_processing',
      'customer_support',
      'inventory_recommendations',
      'production_assistance'
    ));

CREATE TABLE IF NOT EXISTS feedback_ai_triage_briefs (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending',
  requested_by_user_id varchar REFERENCES users(id) ON DELETE SET NULL,
  requested_by_email text NOT NULL,
  filters_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  report_snapshot jsonb NOT NULL DEFAULT '[]'::jsonb,
  provider text,
  model text,
  mode text,
  prompt_version text NOT NULL,
  result jsonb,
  summary text,
  top_risks jsonb,
  top_features jsonb,
  recommended_priorities jsonb,
  duplicate_signals jsonb,
  workflow_risks jsonb,
  revenue_risks jsonb,
  unknowns jsonb,
  confidence numeric(5, 3),
  provider_metadata jsonb,
  usage_metadata jsonb,
  error_code text,
  error_message text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  started_at timestamp with time zone,
  completed_at timestamp with time zone,
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT feedback_ai_triage_briefs_status_check
    CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  CONSTRAINT feedback_ai_triage_briefs_confidence_check
    CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1))
);

CREATE INDEX IF NOT EXISTS feedback_ai_triage_briefs_org_status_created_idx
  ON feedback_ai_triage_briefs (org_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS feedback_ai_triage_briefs_org_created_idx
  ON feedback_ai_triage_briefs (org_id, created_at DESC);

COMMENT ON TABLE feedback_ai_triage_briefs IS
  'Tenant-scoped advisory AI triage planning briefs generated from bug reports and feature requests. Briefs are historical artifacts and do not mutate tickets.';
