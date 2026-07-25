-- Stage 18I: explicit, safe line-item reference assignment for promoted customer artwork uploads.
-- This is intentionally separate from order_attachments.order_line_item_id and production artwork metadata.

ALTER TABLE order_attachments
  ADD COLUMN IF NOT EXISTS customer_upload_assigned_to_order_line_item_id varchar REFERENCES order_line_items(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS customer_upload_assignment_type varchar(32),
  ADD COLUMN IF NOT EXISTS customer_upload_assigned_by_user_id varchar REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS customer_upload_assigned_at timestamp,
  ADD COLUMN IF NOT EXISTS customer_upload_assignment_note text;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'order_attachments_customer_upload_assignment_type_check'
  ) THEN
    ALTER TABLE order_attachments
      ADD CONSTRAINT order_attachments_customer_upload_assignment_type_check
      CHECK (
        (customer_upload_assignment_type IS NULL
          AND customer_upload_assigned_to_order_line_item_id IS NULL
          AND customer_upload_assigned_by_user_id IS NULL
          AND customer_upload_assigned_at IS NULL
          AND customer_upload_assignment_note IS NULL)
        OR
        (customer_upload_assignment_type = 'reference_for_line_item'
          AND customer_upload_assigned_to_order_line_item_id IS NOT NULL
          AND customer_upload_assigned_by_user_id IS NOT NULL
          AND customer_upload_assigned_at IS NOT NULL)
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS order_attachments_customer_upload_assignment_idx
  ON order_attachments (order_id, customer_upload_assigned_to_order_line_item_id);
