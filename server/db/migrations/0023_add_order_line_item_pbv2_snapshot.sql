-- Migration 0023: Persist PBV2 snapshot on order line items

ALTER TABLE IF EXISTS public.order_line_items
  ADD COLUMN IF NOT EXISTS pbv2_tree_version_id VARCHAR NULL;

ALTER TABLE IF EXISTS public.order_line_items
  ADD COLUMN IF NOT EXISTS pbv2_snapshot_json JSONB NULL DEFAULT NULL;

CREATE INDEX IF NOT EXISTS order_line_items_pbv2_tree_version_id_idx
  ON public.order_line_items(pbv2_tree_version_id);
