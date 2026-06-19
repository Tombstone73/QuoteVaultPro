-- Migration 0105: Inbound email provider IDs as text
--
-- Gmail attachment identifiers can exceed 255 characters. These values are
-- opaque provider identifiers, not user-facing labels, so store them as text
-- while preserving the existing lookup index.

ALTER TABLE inbound_order_files
  ALTER COLUMN provider_attachment_id TYPE text,
  ALTER COLUMN provider_message_id TYPE text;
