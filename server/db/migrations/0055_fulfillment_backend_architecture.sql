-- 0055_fulfillment_backend_architecture
-- Fulfillment v1 backend architecture:
-- - Expand shipments for draft/shipped/voided + multi-order scope
-- - Add shipment_orders, shipment_items, pickup_tickets
-- - Add outbound_notifications + fulfillment_events
-- Multi-tenant: all new tables include organization_id

-- -------------------------------------------------------------------
-- 1) Expand existing shipments table (backward-compatible)
-- -------------------------------------------------------------------
ALTER TABLE shipments
  ADD COLUMN IF NOT EXISTS organization_id varchar REFERENCES organizations(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS status varchar(20) NOT NULL DEFAULT 'DRAFT',
  ADD COLUMN IF NOT EXISTS scope varchar(20) NOT NULL DEFAULT 'SINGLE_ORDER',
  ADD COLUMN IF NOT EXISTS primary_order_id varchar REFERENCES orders(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS service_level text,
  ADD COLUMN IF NOT EXISTS ship_date date,
  ADD COLUMN IF NOT EXISTS box_count integer,
  ADD COLUMN IF NOT EXISTS weight_lbs numeric(10,2),
  ADD COLUMN IF NOT EXISTS dim_length_in numeric(10,2),
  ADD COLUMN IF NOT EXISTS dim_width_in numeric(10,2),
  ADD COLUMN IF NOT EXISTS dim_height_in numeric(10,2),
  ADD COLUMN IF NOT EXISTS internal_notes text,
  ADD COLUMN IF NOT EXISTS carrier_shipment_id text,
  ADD COLUMN IF NOT EXISTS label_storage_key text,
  ADD COLUMN IF NOT EXISTS carrier_last_status text,
  ADD COLUMN IF NOT EXISTS carrier_raw_response jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Backfill organization_id from related order where available.
UPDATE shipments s
SET organization_id = o.organization_id
FROM orders o
WHERE s.organization_id IS NULL
  AND s.order_id = o.id;

DO $$
DECLARE
  missing_count integer;
BEGIN
  SELECT COUNT(*) INTO missing_count
  FROM shipments
  WHERE organization_id IS NULL;

  IF missing_count > 0 THEN
    RAISE EXCEPTION
      'Migration 0055 blocked: % shipments have NULL organization_id after backfill. Investigate shipments with missing/invalid order_id before retrying.',
      missing_count;
  END IF;
END $$;

-- Backfill primary_order_id from existing order_id when missing.
UPDATE shipments
SET primary_order_id = order_id
WHERE primary_order_id IS NULL
  AND order_id IS NOT NULL;

-- Existing rows are historical shipped rows.
UPDATE shipments
SET status = CASE
  WHEN delivered_at IS NOT NULL OR shipped_at IS NOT NULL THEN 'SHIPPED'
  ELSE status
END
WHERE status IS DISTINCT FROM 'SHIPPED'
  AND (delivered_at IS NOT NULL OR shipped_at IS NOT NULL);

-- Relax legacy constraints so DRAFT shipments can exist.
ALTER TABLE shipments ALTER COLUMN carrier DROP NOT NULL;
ALTER TABLE shipments ALTER COLUMN shipped_at DROP NOT NULL;
ALTER TABLE shipments ALTER COLUMN created_by_user_id DROP NOT NULL;
ALTER TABLE shipments ALTER COLUMN order_id DROP NOT NULL;

-- Make org column required after backfill.
ALTER TABLE shipments ALTER COLUMN organization_id SET NOT NULL;

-- Constraint guards (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'shipments_status_chk'
  ) THEN
    ALTER TABLE shipments
      ADD CONSTRAINT shipments_status_chk
      CHECK (status IN ('DRAFT','SHIPPED','VOIDED'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'shipments_scope_chk'
  ) THEN
    ALTER TABLE shipments
      ADD CONSTRAINT shipments_scope_chk
      CHECK (scope IN ('SINGLE_ORDER','MULTI_ORDER'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS shipments_org_status_idx
  ON shipments (organization_id, status);

CREATE INDEX IF NOT EXISTS shipments_org_scope_idx
  ON shipments (organization_id, scope);

CREATE INDEX IF NOT EXISTS shipments_primary_order_idx
  ON shipments (primary_order_id);

CREATE INDEX IF NOT EXISTS shipments_org_carrier_shipment_id_idx
  ON shipments (organization_id, carrier_shipment_id);

CREATE UNIQUE INDEX IF NOT EXISTS shipments_org_carrier_shipment_id_uidx
  ON shipments (organization_id, carrier_shipment_id)
  WHERE carrier_shipment_id IS NOT NULL;

-- -------------------------------------------------------------------
-- 2) shipment_orders (join: shipment <-> orders)
-- -------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS shipment_orders (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  shipment_id varchar NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
  order_id varchar NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS shipment_orders_shipment_order_uidx
  ON shipment_orders (shipment_id, order_id);

CREATE INDEX IF NOT EXISTS shipment_orders_org_idx
  ON shipment_orders (organization_id);

CREATE INDEX IF NOT EXISTS shipment_orders_shipment_idx
  ON shipment_orders (shipment_id);

CREATE INDEX IF NOT EXISTS shipment_orders_order_idx
  ON shipment_orders (order_id);

-- -------------------------------------------------------------------
-- 3) shipment_items (partial shipment quantities per line item)
-- -------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS shipment_items (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  shipment_id varchar NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
  order_id varchar NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  order_line_item_id varchar NOT NULL REFERENCES order_line_items(id) ON DELETE CASCADE,
  quantity integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT shipment_items_quantity_positive_chk CHECK (quantity > 0)
);

CREATE INDEX IF NOT EXISTS shipment_items_org_order_idx
  ON shipment_items (organization_id, order_id);

CREATE INDEX IF NOT EXISTS shipment_items_org_line_item_idx
  ON shipment_items (organization_id, order_line_item_id);

CREATE INDEX IF NOT EXISTS shipment_items_shipment_idx
  ON shipment_items (shipment_id);

CREATE UNIQUE INDEX IF NOT EXISTS shipment_items_shipment_line_item_uidx
  ON shipment_items (shipment_id, order_line_item_id);

-- -------------------------------------------------------------------
-- 4) pickup_tickets
-- -------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pickup_tickets (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  order_id varchar NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  status varchar(32) NOT NULL DEFAULT 'DRAFT',
  ready_at timestamptz,
  picked_up_at timestamptz,
  staging_location text,
  pickup_notes text,
  contact_name text,
  contact_email text,
  contact_phone text,
  created_by_user_id varchar REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS pickup_tickets_order_uidx
  ON pickup_tickets (order_id);

CREATE INDEX IF NOT EXISTS pickup_tickets_org_status_idx
  ON pickup_tickets (organization_id, status);

CREATE INDEX IF NOT EXISTS pickup_tickets_org_order_idx
  ON pickup_tickets (organization_id, order_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'pickup_tickets_status_chk'
  ) THEN
    ALTER TABLE pickup_tickets
      ADD CONSTRAINT pickup_tickets_status_chk
      CHECK (status IN ('DRAFT','READY_FOR_PICKUP','PICKED_UP'));
  END IF;
END $$;

-- -------------------------------------------------------------------
-- 5) outbound_notifications
-- -------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS outbound_notifications (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  related_type varchar(40) NOT NULL,
  related_id varchar NOT NULL,
  channel varchar(20) NOT NULL,
  to_address text NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'PENDING',
  provider text,
  provider_message_id text,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz
);

CREATE INDEX IF NOT EXISTS outbound_notifications_org_status_idx
  ON outbound_notifications (organization_id, status);

CREATE INDEX IF NOT EXISTS outbound_notifications_related_idx
  ON outbound_notifications (related_type, related_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'outbound_notifications_related_type_chk'
  ) THEN
    ALTER TABLE outbound_notifications
      ADD CONSTRAINT outbound_notifications_related_type_chk
      CHECK (related_type IN ('PICKUP_TICKET'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'outbound_notifications_channel_chk'
  ) THEN
    ALTER TABLE outbound_notifications
      ADD CONSTRAINT outbound_notifications_channel_chk
      CHECK (channel IN ('email','sms'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'outbound_notifications_status_chk'
  ) THEN
    ALTER TABLE outbound_notifications
      ADD CONSTRAINT outbound_notifications_status_chk
      CHECK (status IN ('PENDING','SENT','FAILED'));
  END IF;
END $$;

-- -------------------------------------------------------------------
-- 6) fulfillment_events (append-only audit)
-- -------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS fulfillment_events (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  actor_user_id varchar REFERENCES users(id) ON DELETE SET NULL,
  entity_type varchar(40) NOT NULL,
  entity_id varchar NOT NULL,
  event_type varchar(64) NOT NULL,
  payload_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS fulfillment_events_org_entity_created_idx
  ON fulfillment_events (organization_id, entity_type, entity_id, created_at DESC);

CREATE INDEX IF NOT EXISTS fulfillment_events_org_event_created_idx
  ON fulfillment_events (organization_id, event_type, created_at DESC);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fulfillment_events_entity_type_chk'
  ) THEN
    ALTER TABLE fulfillment_events
      ADD CONSTRAINT fulfillment_events_entity_type_chk
      CHECK (entity_type IN ('SHIPMENT','PICKUP_TICKET'));
  END IF;
END $$;
