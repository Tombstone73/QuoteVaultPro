INSERT INTO global_variables (id, organization_id, name, value, description, category, is_active, created_at, updated_at)
SELECT
  gen_random_uuid(),
  o.id,
  'purchase_order_number_prefix',
  'PO-',
  'Purchase order number prefix',
  'numbering',
  true,
  NOW(),
  NOW()
FROM organizations o
ON CONFLICT (organization_id, name) DO NOTHING;

--> statement-breakpoint

INSERT INTO global_variables (id, organization_id, name, value, description, category, is_active, created_at, updated_at)
SELECT
  gen_random_uuid(),
  o.id,
  'next_purchase_order_number',
  COALESCE(
    CASE WHEN legacy.value ~ '^[0-9]+$' THEN legacy.value ELSE NULL END,
    '1000'
  ),
  'Next purchase order number sequence (auto-initialized)',
  'numbering',
  true,
  NOW(),
  NOW()
FROM organizations o
LEFT JOIN global_variables legacy
  ON legacy.organization_id = o.id
 AND legacy.name = 'next_po_number'
ON CONFLICT (organization_id, name) DO NOTHING;

--> statement-breakpoint

WITH maxes AS (
  SELECT
    organization_id,
    COALESCE(MAX(NULLIF(regexp_replace(po_number, '\D', '', 'g'), '')::integer), 999) + 1 AS next_value
  FROM purchase_orders
  GROUP BY organization_id
)
UPDATE global_variables gv
SET
  value = GREATEST(
    CASE WHEN gv.value ~ '^[0-9]+$' THEN gv.value::integer ELSE 1000 END,
    COALESCE(m.next_value, 1000)
  )::text,
  updated_at = NOW()
FROM organizations o
LEFT JOIN maxes m ON m.organization_id = o.id
WHERE gv.organization_id = o.id
  AND gv.name = 'next_purchase_order_number';

--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS purchase_orders_org_po_number_unique
  ON purchase_orders(organization_id, po_number);
