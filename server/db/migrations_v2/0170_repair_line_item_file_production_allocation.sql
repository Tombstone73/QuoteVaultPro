-- Repair the remaining historical 0149 allocation-column drift. The
-- line_item_files projection is non-canonical, but the canonical artwork
-- reader selects its production allocation fields on every normal read.
ALTER TABLE line_item_files
  ADD COLUMN IF NOT EXISTS production_quantity integer,
  ADD COLUMN IF NOT EXISTS production_group_id varchar(128);

ALTER TABLE line_item_files
  DROP CONSTRAINT IF EXISTS line_item_files_production_quantity_positive_chk;
ALTER TABLE line_item_files
  ADD CONSTRAINT line_item_files_production_quantity_positive_chk
  CHECK (production_quantity IS NULL OR production_quantity > 0);

CREATE INDEX IF NOT EXISTS line_item_files_production_group_idx
  ON line_item_files (line_item_id, production_group_id);
