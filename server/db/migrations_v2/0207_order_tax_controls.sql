-- Transaction-specific Order tax controls. Product and Customer tax settings
-- remain defaults; these nullable fields record explicit Order intent.
ALTER TABLE order_line_items
  ADD COLUMN IF NOT EXISTS taxability_override boolean;

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS tax_override_mode varchar(16) NOT NULL DEFAULT 'auto',
  ADD COLUMN IF NOT EXISTS tax_rate_override numeric(5,4),
  ADD COLUMN IF NOT EXISTS tax_override_reason text,
  ADD COLUMN IF NOT EXISTS tax_override_at timestamptz,
  ADD COLUMN IF NOT EXISTS tax_override_by_user_id varchar REFERENCES users(id) ON DELETE SET NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'orders_tax_override_mode_check') THEN
    ALTER TABLE orders
      ADD CONSTRAINT orders_tax_override_mode_check
      CHECK (tax_override_mode IN ('auto', 'exempt', 'rate'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'orders_tax_rate_override_range_check') THEN
    ALTER TABLE orders
      ADD CONSTRAINT orders_tax_rate_override_range_check
      CHECK (tax_rate_override IS NULL OR (tax_rate_override >= 0 AND tax_rate_override <= 1));
  END IF;
END $$;
