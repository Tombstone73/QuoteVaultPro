ALTER TABLE order_attachments
  ADD COLUMN IF NOT EXISTS customer_visible boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS portal_file_category varchar(64),
  ADD COLUMN IF NOT EXISTS portal_display_name varchar(500),
  ADD COLUMN IF NOT EXISTS portal_description text,
  ADD COLUMN IF NOT EXISTS portal_visibility_updated_at timestamp,
  ADD COLUMN IF NOT EXISTS portal_visibility_updated_by varchar REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE quote_attachments
  ADD COLUMN IF NOT EXISTS customer_visible boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS portal_file_category varchar(64),
  ADD COLUMN IF NOT EXISTS portal_display_name varchar(500),
  ADD COLUMN IF NOT EXISTS portal_description text,
  ADD COLUMN IF NOT EXISTS portal_visibility_updated_at timestamp,
  ADD COLUMN IF NOT EXISTS portal_visibility_updated_by varchar REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS order_attachments_portal_visible_idx
  ON order_attachments (order_id, customer_visible);

CREATE INDEX IF NOT EXISTS quote_attachments_portal_visible_idx
  ON quote_attachments (organization_id, quote_id, customer_visible);
