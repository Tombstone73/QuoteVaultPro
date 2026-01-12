-- Add Option Tree v2 (schemaVersion=2) additive columns
-- - products.option_tree_json
-- - quote_line_items.option_selections_json
-- - order_line_items.option_selections_json
-- - invoice_line_items.option_selections_json

ALTER TABLE IF EXISTS public.products
  ADD COLUMN IF NOT EXISTS option_tree_json jsonb NULL;

ALTER TABLE IF EXISTS public.quote_line_items
  ADD COLUMN IF NOT EXISTS option_selections_json jsonb NULL;

ALTER TABLE IF EXISTS public.order_line_items
  ADD COLUMN IF NOT EXISTS option_selections_json jsonb NULL;

ALTER TABLE IF EXISTS public.invoice_line_items
  ADD COLUMN IF NOT EXISTS option_selections_json jsonb NULL;
