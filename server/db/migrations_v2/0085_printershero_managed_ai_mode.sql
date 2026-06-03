-- Migration 0085: Rename managed AI mode to Printers Hero ownership
--
-- Converts the AI Foundation managed-provider mode from the legacy
-- titanos_managed value to printershero_managed. Existing migration files are
-- intentionally left unchanged.

UPDATE organization_ai_settings
SET mode = 'printershero_managed',
    updated_at = now()
WHERE mode = 'titanos_managed';

UPDATE ai_usage
SET mode = 'printershero_managed'
WHERE mode = 'titanos_managed';

ALTER TABLE organization_ai_settings
  DROP CONSTRAINT IF EXISTS organization_ai_settings_mode_check;

ALTER TABLE organization_ai_settings
  ADD CONSTRAINT organization_ai_settings_mode_check
    CHECK (mode IN ('disabled', 'printershero_managed', 'bring_your_own'));

ALTER TABLE ai_usage
  DROP CONSTRAINT IF EXISTS ai_usage_mode_check;

ALTER TABLE ai_usage
  ADD CONSTRAINT ai_usage_mode_check
    CHECK (mode IN ('disabled', 'printershero_managed', 'bring_your_own', 'legacy_env'));
