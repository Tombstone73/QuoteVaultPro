-- Add Product.artworkPolicy to support real line-item flag derivation
-- Default is not_required for existing + new products.

ALTER TABLE IF EXISTS public.products
  ADD COLUMN IF NOT EXISTS artwork_policy varchar(32) NOT NULL DEFAULT 'not_required';
