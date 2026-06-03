-- Migration 0084: AI foundation settings and usage tracking
--
-- Adds the centralized organization-level AI settings and usage foundation.
-- This does not add new AI business features and does not mutate existing
-- bug report or feedback_ai_reviews behavior.

CREATE TABLE IF NOT EXISTS organization_ai_settings (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  mode text NOT NULL DEFAULT 'disabled',
  provider text,
  model text,
  encrypted_api_key text,
  api_key_last4 varchar(8),
  encryption_key_id text,
  is_enabled boolean NOT NULL DEFAULT false,
  bug_review_enabled boolean NOT NULL DEFAULT false,
  feature_review_enabled boolean NOT NULL DEFAULT false,
  duplicate_detection_enabled boolean NOT NULL DEFAULT false,
  order_parsing_enabled boolean NOT NULL DEFAULT false,
  email_processing_enabled boolean NOT NULL DEFAULT false,
  customer_support_enabled boolean NOT NULL DEFAULT false,
  inventory_recommendations_enabled boolean NOT NULL DEFAULT false,
  production_assistance_enabled boolean NOT NULL DEFAULT false,
  monthly_usage_limit integer,
  included_monthly_credits_cents integer,
  overage_enabled boolean NOT NULL DEFAULT false,
  billing_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT organization_ai_settings_mode_check
    CHECK (mode IN ('disabled', 'titanos_managed', 'bring_your_own')),
  CONSTRAINT organization_ai_settings_provider_check
    CHECK (provider IS NULL OR provider IN ('openai', 'anthropic', 'future')),
  CONSTRAINT organization_ai_settings_monthly_usage_limit_check
    CHECK (monthly_usage_limit IS NULL OR monthly_usage_limit > 0),
  CONSTRAINT organization_ai_settings_included_credits_check
    CHECK (included_monthly_credits_cents IS NULL OR included_monthly_credits_cents >= 0),
  CONSTRAINT organization_ai_settings_disabled_no_secret_check
    CHECK (mode <> 'disabled' OR encrypted_api_key IS NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS organization_ai_settings_org_uidx
  ON organization_ai_settings (org_id);

CREATE INDEX IF NOT EXISTS organization_ai_settings_mode_idx
  ON organization_ai_settings (mode);

CREATE INDEX IF NOT EXISTS organization_ai_settings_provider_idx
  ON organization_ai_settings (provider);

CREATE TABLE IF NOT EXISTS ai_usage (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  feature text NOT NULL,
  provider text NOT NULL,
  model text,
  request_count integer NOT NULL DEFAULT 1,
  input_tokens integer NOT NULL DEFAULT 0,
  output_tokens integer NOT NULL DEFAULT 0,
  total_tokens integer NOT NULL DEFAULT 0,
  estimated_cost_cents integer,
  mode text NOT NULL,
  source text NOT NULL DEFAULT 'server',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT ai_usage_feature_check
    CHECK (feature IN (
      'bug_review',
      'feature_review',
      'duplicate_detection',
      'order_parsing',
      'email_processing',
      'customer_support',
      'inventory_recommendations',
      'production_assistance'
    )),
  CONSTRAINT ai_usage_provider_check
    CHECK (provider IN ('openai', 'anthropic', 'future', 'openai_compatible')),
  CONSTRAINT ai_usage_mode_check
    CHECK (mode IN ('disabled', 'titanos_managed', 'bring_your_own', 'legacy_env')),
  CONSTRAINT ai_usage_request_count_check
    CHECK (request_count > 0),
  CONSTRAINT ai_usage_token_check
    CHECK (input_tokens >= 0 AND output_tokens >= 0 AND total_tokens >= 0),
  CONSTRAINT ai_usage_estimated_cost_check
    CHECK (estimated_cost_cents IS NULL OR estimated_cost_cents >= 0)
);

CREATE INDEX IF NOT EXISTS ai_usage_org_feature_created_idx
  ON ai_usage (org_id, feature, created_at DESC);

CREATE INDEX IF NOT EXISTS ai_usage_org_provider_created_idx
  ON ai_usage (org_id, provider, created_at DESC);

CREATE INDEX IF NOT EXISTS ai_usage_org_created_idx
  ON ai_usage (org_id, created_at DESC);

COMMENT ON TABLE organization_ai_settings IS
  'Tenant-scoped AI provider mode, feature toggles, and encrypted BYOK configuration. Secrets are never returned to the frontend.';

COMMENT ON TABLE ai_usage IS
  'Tenant-scoped AI usage foundation for future billing, limits, and analytics.';
