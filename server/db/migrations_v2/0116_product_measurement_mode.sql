ALTER TABLE products
  ADD COLUMN IF NOT EXISTS measurement_mode varchar(32) NOT NULL DEFAULT 'dimensions_required';

-- Only migrate records whose existing configuration already explicitly meant
-- quantity-only pricing. All other products retain the safe dimensions-required default.
UPDATE products
SET measurement_mode = 'quantity_only'
WHERE measurement_mode = 'dimensions_required'
  AND (
    pricing_profile_key IN ('qty_only', 'fee')
    OR is_service = true
    OR lower(name) = 'economy yard sign stakes'
  );
