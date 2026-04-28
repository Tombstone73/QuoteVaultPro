CREATE TABLE IF NOT EXISTS material_reorder_requests (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  material_id varchar NOT NULL REFERENCES materials(id) ON DELETE CASCADE,
  vendor_id varchar REFERENCES vendors(id) ON DELETE SET NULL,
  status varchar(20) NOT NULL DEFAULT 'requested',
  requested_quantity numeric(10, 2) NOT NULL,
  received_quantity numeric(10, 2),
  current_stock_quantity numeric(10, 2),
  min_stock_alert numeric(10, 2),
  notes text,
  requested_by_user_id varchar REFERENCES users(id) ON DELETE SET NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  ordered_by_user_id varchar REFERENCES users(id) ON DELETE SET NULL,
  ordered_at timestamptz,
  received_by_user_id varchar REFERENCES users(id) ON DELETE SET NULL,
  received_at timestamptz,
  cancelled_by_user_id varchar REFERENCES users(id) ON DELETE SET NULL,
  cancelled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS material_reorder_requests_org_idx
  ON material_reorder_requests (organization_id);

CREATE INDEX IF NOT EXISTS material_reorder_requests_material_idx
  ON material_reorder_requests (material_id);

CREATE INDEX IF NOT EXISTS material_reorder_requests_status_idx
  ON material_reorder_requests (status);

CREATE INDEX IF NOT EXISTS material_reorder_requests_vendor_idx
  ON material_reorder_requests (vendor_id);

CREATE INDEX IF NOT EXISTS material_reorder_requests_requested_at_idx
  ON material_reorder_requests (requested_at);

CREATE UNIQUE INDEX IF NOT EXISTS material_reorder_requests_open_material_uidx
  ON material_reorder_requests (organization_id, material_id)
  WHERE status IN ('requested', 'ordered');

ALTER TABLE inventory_adjustments
  ADD COLUMN IF NOT EXISTS organization_id varchar REFERENCES organizations(id) ON DELETE CASCADE;

ALTER TABLE inventory_adjustments
  ADD COLUMN IF NOT EXISTS movement_type varchar(20) NOT NULL DEFAULT 'adjustment';

ALTER TABLE inventory_adjustments
  ADD COLUMN IF NOT EXISTS quantity_before numeric(10, 2);

ALTER TABLE inventory_adjustments
  ADD COLUMN IF NOT EXISTS quantity_after numeric(10, 2);

ALTER TABLE inventory_adjustments
  ADD COLUMN IF NOT EXISTS notes text;

ALTER TABLE inventory_adjustments
  ADD COLUMN IF NOT EXISTS reorder_request_id varchar REFERENCES material_reorder_requests(id) ON DELETE SET NULL;

UPDATE inventory_adjustments ia
SET organization_id = m.organization_id
FROM materials m
WHERE ia.organization_id IS NULL
  AND ia.material_id = m.id;

ALTER TABLE inventory_adjustments
  ALTER COLUMN organization_id SET NOT NULL;

UPDATE inventory_adjustments
SET movement_type = CASE
  WHEN type = 'job_usage' THEN 'usage'
  WHEN type = 'purchase_receipt' THEN 'receipt'
  ELSE 'adjustment'
END
WHERE movement_type IS DISTINCT FROM CASE
  WHEN type = 'job_usage' THEN 'usage'
  WHEN type = 'purchase_receipt' THEN 'receipt'
  ELSE 'adjustment'
END;

CREATE INDEX IF NOT EXISTS inventory_adjustments_organization_id_idx
  ON inventory_adjustments (organization_id);

CREATE INDEX IF NOT EXISTS inventory_adjustments_movement_type_idx
  ON inventory_adjustments (movement_type);

CREATE INDEX IF NOT EXISTS inventory_adjustments_reorder_request_id_idx
  ON inventory_adjustments (reorder_request_id);