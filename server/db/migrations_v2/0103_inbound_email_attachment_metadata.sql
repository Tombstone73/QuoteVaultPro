-- Migration 0103: Inbound email attachment metadata
--
-- Adds provider metadata to inbound_order_files so Gmail attachments can be
-- linked to TEMP_INBOUND records without creating downstream artwork/proof/order records.

ALTER TABLE inbound_order_files
  ADD COLUMN IF NOT EXISTS provider_attachment_id varchar(255),
  ADD COLUMN IF NOT EXISTS provider_message_id varchar(255),
  ADD COLUMN IF NOT EXISTS content_disposition varchar(100),
  ADD COLUMN IF NOT EXISTS metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS inbound_order_files_org_provider_attachment_idx
  ON inbound_order_files (organization_id, provider_message_id, provider_attachment_id);
