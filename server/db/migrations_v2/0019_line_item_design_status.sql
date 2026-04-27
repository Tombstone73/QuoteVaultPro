ALTER TABLE order_line_items
    ADD COLUMN IF NOT EXISTS design_status varchar(50);

CREATE INDEX IF NOT EXISTS order_line_items_design_status_idx
    ON order_line_items (design_status);

UPDATE order_line_items
SET design_status = lower(workflow_state)
WHERE design_status IS NULL
  AND lower(workflow_state) IN ('needs_design', 'in_design');