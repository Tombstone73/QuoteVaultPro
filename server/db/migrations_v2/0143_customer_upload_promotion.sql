-- Stage 18G: durable, explicit promotion metadata for accepted customer uploads.
-- Promotion remains attachment-only and is not a final-art or workflow state.

ALTER TABLE quote_attachments
  ADD COLUMN IF NOT EXISTS customer_upload_promotion_type varchar(32),
  ADD COLUMN IF NOT EXISTS customer_upload_promoted_by_user_id varchar REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS customer_upload_promoted_at timestamp;

ALTER TABLE order_attachments
  ADD COLUMN IF NOT EXISTS customer_upload_promotion_type varchar(32),
  ADD COLUMN IF NOT EXISTS customer_upload_promoted_by_user_id varchar REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS customer_upload_promoted_at timestamp;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'quote_attachments_customer_upload_promotion_type_check'
  ) THEN
    ALTER TABLE quote_attachments
      ADD CONSTRAINT quote_attachments_customer_upload_promotion_type_check
      CHECK (customer_upload_promotion_type IS NULL OR customer_upload_promotion_type = 'reference');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'order_attachments_customer_upload_promotion_type_check'
  ) THEN
    ALTER TABLE order_attachments
      ADD CONSTRAINT order_attachments_customer_upload_promotion_type_check
      CHECK (customer_upload_promotion_type IS NULL OR customer_upload_promotion_type IN ('reference', 'artwork'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS quote_attachments_customer_upload_promotion_idx
  ON quote_attachments (organization_id, customer_upload_promotion_type);

CREATE INDEX IF NOT EXISTS order_attachments_customer_upload_promotion_idx
  ON order_attachments (order_id, customer_upload_promotion_type);
