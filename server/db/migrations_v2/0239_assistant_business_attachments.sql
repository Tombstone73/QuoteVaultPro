-- Keep the existing tenant/conversation attachment association and private
-- storage. Extend only the bounded file size and validated MIME allowlist.
ALTER TABLE public.ai_message_attachments
  DROP CONSTRAINT ai_message_attachments_size_ck,
  DROP CONSTRAINT ai_message_attachments_mime_ck,
  ALTER COLUMN mime_type TYPE varchar(128),
  ADD CONSTRAINT ai_message_attachments_size_ck CHECK (size_bytes > 0 AND size_bytes <= 10485760),
  ADD CONSTRAINT ai_message_attachments_mime_ck CHECK (mime_type IN (
    'image/jpeg', 'image/png', 'image/gif', 'image/webp',
    'application/pdf', 'text/csv', 'text/tab-separated-values',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain'
  ));
