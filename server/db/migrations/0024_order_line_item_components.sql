-- Migration 0024: Order line item components (PBV2 child items acceptance)

CREATE TABLE IF NOT EXISTS public.order_line_item_components (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),

  organization_id VARCHAR NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  -- Helpful for query patterns; components still ultimately belong to an order line item.
  order_id VARCHAR NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  order_line_item_id VARCHAR NOT NULL REFERENCES order_line_items(id) ON DELETE CASCADE,

  status TEXT NOT NULL DEFAULT 'ACCEPTED', -- ACCEPTED | VOIDED
  source TEXT NOT NULL DEFAULT 'PBV2',

  kind TEXT NOT NULL, -- inlineSku | productRef (future-safe)
  title TEXT NOT NULL,
  sku_ref TEXT NULL,
  child_product_id VARCHAR NULL,

  qty NUMERIC(10, 2) NOT NULL,
  unit_price_cents INTEGER NULL,
  amount_cents INTEGER NULL,

  invoice_visibility TEXT NOT NULL DEFAULT 'rollup', -- hidden | rollup | separateLine

  pbv2_tree_version_id VARCHAR NULL,
  pbv2_source_node_id VARCHAR NULL,
  pbv2_effect_index INTEGER NULL,

  created_by_user_id VARCHAR NULL REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),

  CONSTRAINT order_line_item_components_status_chk CHECK (status IN ('ACCEPTED','VOIDED')),
  CONSTRAINT order_line_item_components_invoice_visibility_chk CHECK (invoice_visibility IN ('hidden','rollup','separateLine'))
);

CREATE INDEX IF NOT EXISTS order_line_item_components_org_idx
  ON public.order_line_item_components(organization_id);

CREATE INDEX IF NOT EXISTS order_line_item_components_order_id_idx
  ON public.order_line_item_components(order_id);

CREATE INDEX IF NOT EXISTS order_line_item_components_line_item_id_idx
  ON public.order_line_item_components(order_line_item_id);

CREATE UNIQUE INDEX IF NOT EXISTS order_line_item_components_pbv2_key_accepted_unique
  ON public.order_line_item_components(organization_id, order_line_item_id, pbv2_source_node_id, pbv2_effect_index)
  WHERE status='ACCEPTED'
    AND pbv2_source_node_id IS NOT NULL
    AND pbv2_effect_index IS NOT NULL;
