-- Stage 18K: explicit artwork-side intake metadata for assigned customer artwork references.

ALTER TABLE order_attachments
  ADD COLUMN IF NOT EXISTS customer_upload_artwork_selection_type varchar(32),
  ADD COLUMN IF NOT EXISTS customer_upload_artwork_selected_by_user_id varchar REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS customer_upload_artwork_selected_at timestamp,
  ADD COLUMN IF NOT EXISTS customer_upload_artwork_selection_note text;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'order_attachments_customer_upload_artwork_selection_type_check'
  ) THEN
    ALTER TABLE order_attachments
      ADD CONSTRAINT order_attachments_customer_upload_artwork_selection_type_check
      CHECK (
        (customer_upload_artwork_selection_type IS NULL
          AND customer_upload_artwork_selected_by_user_id IS NULL
          AND customer_upload_artwork_selected_at IS NULL
          AND customer_upload_artwork_selection_note IS NULL)
        OR
        (customer_upload_artwork_selection_type = 'artwork_side_intake'
          AND customer_upload_artwork_selected_by_user_id IS NOT NULL
          AND customer_upload_artwork_selected_at IS NOT NULL)
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS order_attachments_customer_upload_artwork_selection_idx
  ON order_attachments (order_id, customer_upload_artwork_selection_type);
