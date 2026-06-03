ALTER TABLE organization_payment_settings
  ALTER COLUMN eps_supported_modes SET DEFAULT '["hosted_cnp"]'::jsonb;

UPDATE organization_payment_settings
SET eps_supported_modes = '["hosted_cnp"]'::jsonb,
    updated_at = now()
WHERE eps_supported_modes <> '["hosted_cnp"]'::jsonb;
