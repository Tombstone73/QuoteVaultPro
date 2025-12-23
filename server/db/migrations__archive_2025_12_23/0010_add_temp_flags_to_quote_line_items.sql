-- 0010_add_temp_flags_to_quote_line_items.sql
-- Add is_temporary and created_by_user_id to quote_line_items

ALTER TABLE quote_line_items
ADD COLUMN IF NOT EXISTS is_temporary boolean NOT NULL DEFAULT false;

ALTER TABLE quote_line_items
ADD COLUMN IF NOT EXISTS created_by_user_id varchar(255);

-- Optional index to quickly find temp items per org+user
CREATE INDEX IF NOT EXISTS quote_line_items_temp_org_user_idx
ON quote_line_items (organization_id, created_by_user_id, is_temporary);
