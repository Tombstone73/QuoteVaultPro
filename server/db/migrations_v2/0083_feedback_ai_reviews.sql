-- Migration 0083: Feedback AI review history
--
-- Adds a tenant-scoped, immutable AI review history table for manual bug report
-- reviews. This migration intentionally does not alter bug_reports, workflow
-- state, roadmap data, or work item tables.

CREATE TABLE IF NOT EXISTS feedback_ai_reviews (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  bug_report_id varchar NOT NULL REFERENCES bug_reports(id) ON DELETE CASCADE,
  review_kind text NOT NULL DEFAULT 'bug_review',
  status text NOT NULL DEFAULT 'pending',
  is_current boolean NOT NULL DEFAULT true,
  requested_by_user_id varchar REFERENCES users(id) ON DELETE SET NULL,
  requested_by_email text NOT NULL,
  provider text,
  model text,
  provider_metadata jsonb,
  prompt_version text NOT NULL,
  input_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  result jsonb,
  summary text,
  severity_assessment text,
  business_impact text,
  urgency text,
  implementation_priority text,
  workflow_impact text,
  revenue_risk text,
  suggested_owner text,
  confidence numeric(4, 3),
  validation_errors jsonb,
  error_code text,
  error_message text,
  started_at timestamp with time zone,
  completed_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT feedback_ai_reviews_review_kind_check
    CHECK (review_kind IN ('bug_review')),
  CONSTRAINT feedback_ai_reviews_status_check
    CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  CONSTRAINT feedback_ai_reviews_severity_assessment_check
    CHECK (severity_assessment IS NULL OR severity_assessment IN ('low', 'medium', 'high', 'critical')),
  CONSTRAINT feedback_ai_reviews_business_impact_check
    CHECK (business_impact IS NULL OR business_impact IN ('low', 'medium', 'high', 'critical')),
  CONSTRAINT feedback_ai_reviews_urgency_check
    CHECK (urgency IS NULL OR urgency IN ('low', 'medium', 'high', 'critical')),
  CONSTRAINT feedback_ai_reviews_implementation_priority_check
    CHECK (implementation_priority IS NULL OR implementation_priority IN ('low', 'medium', 'high', 'critical')),
  CONSTRAINT feedback_ai_reviews_workflow_impact_check
    CHECK (workflow_impact IS NULL OR workflow_impact IN ('none', 'minor', 'moderate', 'major', 'blocking')),
  CONSTRAINT feedback_ai_reviews_revenue_risk_check
    CHECK (revenue_risk IS NULL OR revenue_risk IN ('none', 'low', 'medium', 'high', 'critical')),
  CONSTRAINT feedback_ai_reviews_suggested_owner_check
    CHECK (suggested_owner IS NULL OR suggested_owner IN (
      'Orders',
      'Quotes',
      'PBV2',
      'Production',
      'Proofing',
      'Shipping',
      'Billing',
      'Customer Portal',
      'Inventory',
      'Admin'
    )),
  CONSTRAINT feedback_ai_reviews_confidence_check
    CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1))
);

CREATE INDEX IF NOT EXISTS feedback_ai_reviews_org_bug_current_idx
  ON feedback_ai_reviews (org_id, bug_report_id, is_current);

CREATE INDEX IF NOT EXISTS feedback_ai_reviews_org_status_created_idx
  ON feedback_ai_reviews (org_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS feedback_ai_reviews_org_kind_created_idx
  ON feedback_ai_reviews (org_id, review_kind, created_at DESC);

CREATE INDEX IF NOT EXISTS feedback_ai_reviews_org_suggested_owner_idx
  ON feedback_ai_reviews (org_id, suggested_owner);

CREATE INDEX IF NOT EXISTS feedback_ai_reviews_org_workflow_impact_idx
  ON feedback_ai_reviews (org_id, workflow_impact);

CREATE INDEX IF NOT EXISTS feedback_ai_reviews_org_revenue_risk_idx
  ON feedback_ai_reviews (org_id, revenue_risk);

CREATE UNIQUE INDEX IF NOT EXISTS feedback_ai_reviews_one_current_bug_review_uidx
  ON feedback_ai_reviews (org_id, bug_report_id, review_kind)
  WHERE is_current = true;

COMMENT ON TABLE feedback_ai_reviews IS
  'Tenant-scoped advisory AI review history for bug reports. AI reviews never mutate bug report state.';
