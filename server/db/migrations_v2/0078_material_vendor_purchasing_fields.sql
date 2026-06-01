ALTER TABLE materials
  ADD COLUMN IF NOT EXISTS preferred_vendor_name varchar(255),
  ADD COLUMN IF NOT EXISTS vendor_product_url text,
  ADD COLUMN IF NOT EXISTS vendor_notes text,
  ADD COLUMN IF NOT EXISTS vendor_last_price_cents integer,
  ADD COLUMN IF NOT EXISTS vendor_last_price_updated_at timestamp;
