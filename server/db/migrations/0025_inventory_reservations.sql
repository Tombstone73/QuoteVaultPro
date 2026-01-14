-- Migration 0025: Inventory reservations (order intent; reversible)

CREATE TABLE IF NOT EXISTS public.inventory_reservations (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),

  organization_id VARCHAR NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  order_id VARCHAR NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  order_line_item_id VARCHAR NULL REFERENCES order_line_items(id) ON DELETE SET NULL,

  source_type TEXT NOT NULL, -- PBV2_MATERIAL | PBV2_COMPONENT | MANUAL
  source_key TEXT NOT NULL,  -- skuRef or productId (no invented SKUs)
  uom TEXT NOT NULL,
  qty NUMERIC(10, 2) NOT NULL,

  status TEXT NOT NULL DEFAULT 'RESERVED', -- RESERVED | RELEASED

  created_by_user_id VARCHAR NULL REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),

  CONSTRAINT inventory_reservations_status_chk CHECK (status IN ('RESERVED','RELEASED')),
  CONSTRAINT inventory_reservations_source_type_chk CHECK (source_type IN ('PBV2_MATERIAL','PBV2_COMPONENT','MANUAL')),
  CONSTRAINT inventory_reservations_qty_positive_chk CHECK (qty > 0)
);

CREATE INDEX IF NOT EXISTS inventory_reservations_org_id_idx
  ON public.inventory_reservations(organization_id);

CREATE INDEX IF NOT EXISTS inventory_reservations_order_id_idx
  ON public.inventory_reservations(order_id);

CREATE INDEX IF NOT EXISTS inventory_reservations_org_order_source_status_idx
  ON public.inventory_reservations(organization_id, order_id, source_key, uom, status);
