CREATE TABLE IF NOT EXISTS ink_master_printers (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name varchar(160) NOT NULL,
  container_size_liters numeric(14, 6) NOT NULL CHECK (container_size_liters > 0),
  container_price_cents integer CHECK (container_price_cents >= 0),
  restock_target_liters numeric(14, 6) NOT NULL CHECK (restock_target_liters >= 0),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ink_master_printers_org_id_uidx UNIQUE (organization_id, id),
  CONSTRAINT ink_master_printers_org_name_uidx UNIQUE (organization_id, name)
);
CREATE INDEX IF NOT EXISTS ink_master_printers_org_active_idx ON ink_master_printers (organization_id, is_active);

CREATE TABLE IF NOT EXISTS ink_master_saved_specs (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name varchar(200) NOT NULL,
  printer_id varchar NOT NULL,
  print_sides varchar(6) NOT NULL CHECK (print_sides IN ('single', 'double')),
  usage_ml_per_sheet_side jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ink_master_specs_org_printer_fk FOREIGN KEY (organization_id, printer_id)
    REFERENCES ink_master_printers (organization_id, id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS ink_master_saved_specs_org_idx ON ink_master_saved_specs (organization_id);
CREATE INDEX IF NOT EXISTS ink_master_saved_specs_org_printer_idx ON ink_master_saved_specs (organization_id, printer_id);
