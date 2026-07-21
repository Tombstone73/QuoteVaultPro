-- Migration 0125: dedicated read-only assistant provider capability
--
-- The assistant is independently disabled from other organization AI features.
-- Existing configured organizations keep the capability available by default,
-- while the organization-wide AI is_enabled switch remains the master kill switch.

ALTER TABLE organization_ai_settings
  ADD COLUMN IF NOT EXISTS assistant_enabled boolean NOT NULL DEFAULT true;

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
      'production_assistance',
      'assistant'
    ));

COMMENT ON COLUMN organization_ai_settings.assistant_enabled IS
  'Tenant-scoped kill switch for the read-only PrintersHero assistant. The master AI is_enabled switch also applies.';
