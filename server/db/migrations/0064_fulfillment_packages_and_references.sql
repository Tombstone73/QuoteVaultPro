-- Fulfillment workspace: durable operator-facing shipment references and
-- physical package grouping. Existing shipment-level allocations remain valid
-- with package_id NULL; newly saved package allocations use this same table.

ALTER TABLE shipments
  ADD COLUMN IF NOT EXISTS shipment_reference varchar(80);

CREATE UNIQUE INDEX IF NOT EXISTS shipments_org_reference_uidx
  ON shipments (organization_id, shipment_reference)
  WHERE shipment_reference IS NOT NULL;

CREATE TABLE IF NOT EXISTS shipment_packages (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  shipment_id varchar NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
  ordinal integer NOT NULL,
  package_reference varchar(100) NOT NULL,
  weight_lbs numeric(10,2),
  dim_length_in numeric(10,2),
  dim_width_in numeric(10,2),
  dim_height_in numeric(10,2),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT shipment_packages_ordinal_positive_chk CHECK (ordinal > 0),
  CONSTRAINT shipment_packages_weight_nonnegative_chk CHECK (weight_lbs IS NULL OR weight_lbs >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS shipment_packages_shipment_ordinal_uidx
  ON shipment_packages (shipment_id, ordinal);
CREATE UNIQUE INDEX IF NOT EXISTS shipment_packages_org_reference_uidx
  ON shipment_packages (organization_id, package_reference);
CREATE INDEX IF NOT EXISTS shipment_packages_org_shipment_idx
  ON shipment_packages (organization_id, shipment_id);

ALTER TABLE shipment_items
  ADD COLUMN IF NOT EXISTS package_id varchar REFERENCES shipment_packages(id) ON DELETE CASCADE;

-- A line may now be split across packages; package-less historic rows remain
-- unique at the shipment level and are deliberately preserved.
DROP INDEX IF EXISTS shipment_items_shipment_line_item_uidx;
CREATE UNIQUE INDEX IF NOT EXISTS shipment_items_shipment_package_line_item_uidx
  ON shipment_items (shipment_id, package_id, order_line_item_id)
  WHERE package_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS shipment_items_shipment_unpacked_line_item_uidx
  ON shipment_items (shipment_id, order_line_item_id)
  WHERE package_id IS NULL;
CREATE INDEX IF NOT EXISTS shipment_items_package_idx ON shipment_items (package_id);

ALTER TABLE fulfillment_checklist_items
  ADD COLUMN IF NOT EXISTS fulfilled_quantity integer NOT NULL DEFAULT 0;
ALTER TABLE fulfillment_checklist_items
  ADD CONSTRAINT fulfillment_checklist_items_fulfilled_quantity_nonnegative_chk
  CHECK (fulfilled_quantity >= 0);
