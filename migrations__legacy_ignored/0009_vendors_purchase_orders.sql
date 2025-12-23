-- 0009_vendors_purchase_orders.sql
-- MVP Vendors & Purchase Orders

-- Vendors table
CREATE TABLE IF NOT EXISTS vendors (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar(255) NOT NULL,
  email varchar(255),
  phone varchar(50),
  website varchar(255),
  notes text,
  payment_terms varchar(50) NOT NULL DEFAULT 'due_on_receipt',
  default_lead_time_days integer,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS vendors_name_idx ON vendors(name);
CREATE INDEX IF NOT EXISTS vendors_is_active_idx ON vendors(is_active);

-- Purchase Orders table
CREATE TABLE IF NOT EXISTS purchase_orders (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  po_number varchar(50) NOT NULL UNIQUE,
  vendor_id varchar NOT NULL REFERENCES vendors(id) ON DELETE RESTRICT,
  status varchar(30) NOT NULL DEFAULT 'draft',
  issue_date timestamp NOT NULL,
  expected_date timestamp,
  received_date timestamp,
  notes text,
  subtotal numeric(10,2) NOT NULL DEFAULT 0,
  tax_total numeric(10,2) NOT NULL DEFAULT 0,
  shipping_total numeric(10,2) NOT NULL DEFAULT 0,
  grand_total numeric(10,2) NOT NULL DEFAULT 0,
  created_by_user_id varchar NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS purchase_orders_vendor_id_idx ON purchase_orders(vendor_id);
CREATE INDEX IF NOT EXISTS purchase_orders_status_idx ON purchase_orders(status);
CREATE INDEX IF NOT EXISTS purchase_orders_issue_date_idx ON purchase_orders(issue_date);

-- Purchase Order Line Items
CREATE TABLE IF NOT EXISTS purchase_order_line_items (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_order_id varchar NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  material_id varchar REFERENCES materials(id) ON DELETE SET NULL,
  description varchar(255) NOT NULL,
  vendor_sku varchar(150),
  quantity_ordered numeric(10,2) NOT NULL,
  quantity_received numeric(10,2) NOT NULL DEFAULT 0,
  unit_cost numeric(10,4) NOT NULL,
  line_total numeric(10,4) NOT NULL,
  notes text,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS purchase_order_line_items_po_id_idx ON purchase_order_line_items(purchase_order_id);
CREATE INDEX IF NOT EXISTS purchase_order_line_items_material_id_idx ON purchase_order_line_items(material_id);

-- Extend materials with vendor linkage columns (idempotent)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns WHERE table_name='materials' AND column_name='preferred_vendor_id'
  ) THEN
    ALTER TABLE materials ADD COLUMN preferred_vendor_id varchar REFERENCES vendors(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns WHERE table_name='materials' AND column_name='vendor_sku'
  ) THEN
    ALTER TABLE materials ADD COLUMN vendor_sku varchar(150);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns WHERE table_name='materials' AND column_name='vendor_cost_per_unit'
  ) THEN
    ALTER TABLE materials ADD COLUMN vendor_cost_per_unit numeric(10,4);
  END IF;
END $$;

-- Add index for preferred vendor if not exists
CREATE INDEX IF NOT EXISTS materials_preferred_vendor_id_idx ON materials(preferred_vendor_id);
