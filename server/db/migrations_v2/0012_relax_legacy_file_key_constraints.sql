ALTER TABLE quote_attachments
  ALTER COLUMN file_url DROP NOT NULL;

ALTER TABLE order_attachments
  ALTER COLUMN file_url DROP NOT NULL;

ALTER TABLE assets
  ALTER COLUMN file_key DROP NOT NULL;