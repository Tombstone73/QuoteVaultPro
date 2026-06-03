-- Migration 0086: Harden AI usage records for future organization-level billing
--
-- Adds durable billing-basis fields and tightens nullable columns without
-- implementing billing, dashboards, limits, or per-user accounting.

ALTER TABLE ai_usage
  ADD COLUMN IF NOT EXISTS cost_currency text NOT NULL DEFAULT 'USD';

ALTER TABLE ai_usage
  ADD COLUMN IF NOT EXISTS pricing_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb;

UPDATE ai_usage
SET model = 'unknown'
WHERE model IS NULL OR btrim(model) = '';

UPDATE ai_usage
SET estimated_cost_cents = 0
WHERE estimated_cost_cents IS NULL;

UPDATE ai_usage
SET pricing_snapshot = jsonb_build_object(
  'basis', 'legacy_default',
  'currency', cost_currency,
  'provider', provider,
  'model', model,
  'mode', mode,
  'inputTokens', input_tokens,
  'outputTokens', output_tokens,
  'totalTokens', total_tokens,
  'estimatedCostCents', estimated_cost_cents
)
WHERE pricing_snapshot = '{}'::jsonb;

ALTER TABLE ai_usage
  ALTER COLUMN model SET NOT NULL,
  ALTER COLUMN estimated_cost_cents SET DEFAULT 0,
  ALTER COLUMN estimated_cost_cents SET NOT NULL;

ALTER TABLE ai_usage
  DROP CONSTRAINT IF EXISTS ai_usage_model_nonblank_check;

ALTER TABLE ai_usage
  ADD CONSTRAINT ai_usage_model_nonblank_check
    CHECK (btrim(model) <> '');

ALTER TABLE ai_usage
  DROP CONSTRAINT IF EXISTS ai_usage_cost_currency_nonblank_check;

ALTER TABLE ai_usage
  ADD CONSTRAINT ai_usage_cost_currency_nonblank_check
    CHECK (btrim(cost_currency) <> '');
