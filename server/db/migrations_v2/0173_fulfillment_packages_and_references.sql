-- Repair fulfillment workspace schema that was introduced in the retired
-- migration stream. The workspace reads these fields for every Order, so keep
-- the V2 stream self-contained and safe if the legacy migration ran manually.

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
  updated_at timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'shipment_packages_ordinal_positive_chk'
  ) THEN
    ALTER TABLE shipment_packages
      ADD CONSTRAINT shipment_packages_ordinal_positive_chk CHECK (ordinal > 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'shipment_packages_weight_nonnegative_chk'
  ) THEN
    ALTER TABLE shipment_packages
      ADD CONSTRAINT shipment_packages_weight_nonnegative_chk
        CHECK (weight_lbs IS NULL OR weight_lbs >= 0);
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS shipment_packages_shipment_ordinal_uidx
  ON shipment_packages (shipment_id, ordinal);
CREATE UNIQUE INDEX IF NOT EXISTS shipment_packages_org_reference_uidx
  ON shipment_packages (organization_id, package_reference);
CREATE INDEX IF NOT EXISTS shipment_packages_org_shipment_idx
  ON shipment_packages (organization_id, shipment_id);

ALTER TABLE shipment_items
  ADD COLUMN IF NOT EXISTS package_id varchar REFERENCES shipment_packages(id) ON DELETE CASCADE;

-- Historic package-less allocations remain one row per line. Package-aware
-- allocations may split a line across physical packages.
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

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fulfillment_checklist_items_fulfilled_quantity_nonnegative_chk'
  ) THEN
    ALTER TABLE fulfillment_checklist_items
      ADD CONSTRAINT fulfillment_checklist_items_fulfilled_quantity_nonnegative_chk
        CHECK (fulfilled_quantity >= 0);
  END IF;
END $$;
