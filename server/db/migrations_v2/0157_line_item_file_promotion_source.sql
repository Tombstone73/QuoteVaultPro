-- Track customer-artwork promotion provenance on production artwork copies.

ALTER TABLE line_item_files
  ADD COLUMN IF NOT EXISTS production_artwork_source_type varchar(64),
  ADD COLUMN IF NOT EXISTS source_file_id varchar REFERENCES line_item_files(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_order_attachment_id varchar REFERENCES order_attachments(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_artwork_side file_side;

CREATE INDEX IF NOT EXISTS line_item_files_source_file_idx
  ON line_item_files(source_file_id);

CREATE INDEX IF NOT EXISTS line_item_files_source_attachment_idx
  ON line_item_files(source_order_attachment_id);

CREATE UNIQUE INDEX IF NOT EXISTS line_item_files_active_promoted_source_uidx
  ON line_item_files(
    organization_id,
    line_item_id,
    role,
    status,
    COALESCE(tag, ''),
    COALESCE(source_artwork_side, 'na'::file_side),
    COALESCE(source_file_id, ''),
    COALESCE(source_order_attachment_id, '')
  )
  WHERE production_artwork_source_type = 'customer_artwork_promotion'
    AND role = 'final'
    AND status = 'active';
