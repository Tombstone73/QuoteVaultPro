-- Canonical business ownership/lineage for order-line artwork. Physical bytes
-- remain owned by file_records and their placements/derivatives.
DO $$ BEGIN
  CREATE TYPE line_item_artwork_role AS ENUM ('customer_source', 'production', 'modified_production');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE line_item_artwork_status AS ENUM ('current', 'superseded');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE line_item_artwork_side AS ENUM ('front', 'back', 'both', 'unknown', 'not_applicable');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE line_item_artwork_origin AS ENUM ('customer_upload', 'staff_upload', 'promoted_existing', 'modified_copy', 'legacy_backfill');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS line_item_artwork (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  order_id varchar NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  line_item_id varchar NOT NULL REFERENCES order_line_items(id) ON DELETE CASCADE,
  file_record_id varchar NOT NULL REFERENCES file_records(id) ON DELETE RESTRICT,
  role line_item_artwork_role NOT NULL,
  status line_item_artwork_status NOT NULL DEFAULT 'current',
  side line_item_artwork_side NOT NULL DEFAULT 'unknown',
  allocation_quantity integer,
  allocation_group_id varchar(128),
  origin line_item_artwork_origin NOT NULL,
  parent_artwork_id varchar REFERENCES line_item_artwork(id) ON DELETE RESTRICT,
  supersedes_artwork_id varchar REFERENCES line_item_artwork(id) ON DELETE RESTRICT,
  created_by_user_id varchar REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  superseded_at timestamptz,
  superseded_by_user_id varchar REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS line_item_artwork_org_line_idx ON line_item_artwork (organization_id, line_item_id);
CREATE INDEX IF NOT EXISTS line_item_artwork_current_idx ON line_item_artwork (organization_id, line_item_id, role, status);
CREATE INDEX IF NOT EXISTS line_item_artwork_file_record_idx ON line_item_artwork (file_record_id);
CREATE INDEX IF NOT EXISTS line_item_artwork_parent_idx ON line_item_artwork (parent_artwork_id);
CREATE INDEX IF NOT EXISTS line_item_artwork_supersedes_idx ON line_item_artwork (supersedes_artwork_id);
