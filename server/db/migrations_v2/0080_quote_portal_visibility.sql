ALTER TABLE quotes
  ADD COLUMN IF NOT EXISTS visible_in_customer_portal boolean;

UPDATE quotes
SET visible_in_customer_portal = true
WHERE visible_in_customer_portal IS NULL
  AND (
    status IN ('pending', 'active', 'canceled')
    OR converted_to_order_id IS NOT NULL
  );

UPDATE quotes
SET visible_in_customer_portal = false
WHERE visible_in_customer_portal IS NULL;

ALTER TABLE quotes
  ALTER COLUMN visible_in_customer_portal SET DEFAULT false;

ALTER TABLE quotes
  ALTER COLUMN visible_in_customer_portal SET NOT NULL;

CREATE INDEX IF NOT EXISTS quotes_portal_visibility_idx
  ON quotes (organization_id, customer_id, visible_in_customer_portal);
