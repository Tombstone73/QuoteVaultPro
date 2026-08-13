-- Preserve the operational difference between an unset credit limit and an
-- intentionally configured $0 limit. Existing non-zero limits are safe to
-- recognize; historic zeroes remain unset because intent cannot be inferred.
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS credit_limit_configured_at timestamptz;

UPDATE customers
SET credit_limit_configured_at = COALESCE(credit_limit_configured_at, updated_at, now())
WHERE credit_limit_configured_at IS NULL
  AND credit_limit IS NOT NULL
  AND credit_limit <> 0;
