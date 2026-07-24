-- Stage 18E: explicit staff review metadata for customer portal file submissions.
-- These columns apply only to portal_file_category = 'customer_upload'.

ALTER TABLE quote_attachments
  ADD COLUMN IF NOT EXISTS customer_upload_review_status varchar(32),
  ADD COLUMN IF NOT EXISTS customer_upload_reviewed_by_user_id varchar REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS customer_upload_reviewed_at timestamp,
  ADD COLUMN IF NOT EXISTS customer_upload_review_note text;

ALTER TABLE order_attachments
  ADD COLUMN IF NOT EXISTS customer_upload_review_status varchar(32),
  ADD COLUMN IF NOT EXISTS customer_upload_reviewed_by_user_id varchar REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS customer_upload_reviewed_at timestamp,
  ADD COLUMN IF NOT EXISTS customer_upload_review_note text;

UPDATE quote_attachments
SET customer_upload_review_status = 'pending_review'
WHERE portal_file_category = 'customer_upload'
  AND customer_upload_review_status IS NULL;

UPDATE order_attachments
SET customer_upload_review_status = 'pending_review'
WHERE portal_file_category = 'customer_upload'
  AND customer_upload_review_status IS NULL;

ALTER TABLE quote_attachments
  ADD CONSTRAINT quote_attachments_customer_upload_review_status_check
  CHECK (customer_upload_review_status IS NULL OR customer_upload_review_status IN ('pending_review', 'accepted', 'rejected'));

ALTER TABLE order_attachments
  ADD CONSTRAINT order_attachments_customer_upload_review_status_check
  CHECK (customer_upload_review_status IS NULL OR customer_upload_review_status IN ('pending_review', 'accepted', 'rejected'));

CREATE INDEX IF NOT EXISTS quote_attachments_customer_upload_review_idx
  ON quote_attachments (organization_id, customer_upload_review_status);

CREATE INDEX IF NOT EXISTS order_attachments_customer_upload_review_idx
  ON order_attachments (order_id, customer_upload_review_status);
