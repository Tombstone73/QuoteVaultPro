-- Stage 18O: Keep staff primary-artwork candidacy distinct from operational is_primary/final-art state.
ALTER TABLE order_attachments
  ADD COLUMN IF NOT EXISTS customer_upload_primary_candidate_side file_side,
  ADD COLUMN IF NOT EXISTS customer_upload_primary_candidate_by_user_id varchar REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS customer_upload_primary_candidate_at timestamp,
  ADD COLUMN IF NOT EXISTS customer_upload_primary_candidate_note text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'order_attachments_customer_upload_primary_candidate_check'
  ) THEN
    ALTER TABLE order_attachments
      ADD CONSTRAINT order_attachments_customer_upload_primary_candidate_check
      CHECK (
        (customer_upload_primary_candidate_side IS NULL
          AND customer_upload_primary_candidate_by_user_id IS NULL
          AND customer_upload_primary_candidate_at IS NULL
          AND customer_upload_primary_candidate_note IS NULL)
        OR
        (customer_upload_primary_candidate_side IN ('front', 'back', 'both')
          AND customer_upload_primary_candidate_by_user_id IS NOT NULL
          AND customer_upload_primary_candidate_at IS NOT NULL
          AND customer_upload_primary_candidate_side = side
          AND portal_file_category = 'customer_upload'
          AND customer_upload_review_status = 'accepted'
          AND customer_upload_promotion_type = 'artwork'
          AND customer_upload_assignment_type = 'reference_for_line_item'
          AND customer_upload_artwork_selection_type = 'artwork_side_intake'
          AND customer_upload_assigned_to_order_line_item_id = order_line_item_id
          AND role = 'artwork'
          AND is_primary = false)
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS order_attachments_customer_upload_primary_candidate_idx
  ON order_attachments (order_id, customer_upload_primary_candidate_side);

CREATE UNIQUE INDEX IF NOT EXISTS order_attachments_customer_upload_primary_candidate_line_side_uidx
  ON order_attachments (order_line_item_id, customer_upload_primary_candidate_side)
  WHERE customer_upload_primary_candidate_side IS NOT NULL;
