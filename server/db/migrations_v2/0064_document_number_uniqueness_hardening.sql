-- Migration 0064: Pre-launch document number uniqueness hardening
-- Repairs disposable duplicate/null numbering data and enforces per-document-type
-- uniqueness inside each organization. Sequences remain separate across quotes,
-- orders, and invoices.

--> statement-breakpoint

WITH prefix_by_org AS (
  SELECT
    o.id AS organization_id,
    COALESCE(qp.value, 'QT-') AS prefix
  FROM organizations o
  LEFT JOIN global_variables qp
    ON qp.organization_id = o.id
   AND qp.name = 'quote_number_prefix'
),
ranked AS (
  SELECT
    q.id,
    q.organization_id,
    q.created_at,
    q.display_number,
    q.number_core,
    p.prefix,
    COUNT(*) OVER (PARTITION BY q.organization_id, q.display_number) AS display_count,
    ROW_NUMBER() OVER (PARTITION BY q.organization_id, q.display_number ORDER BY q.created_at, q.id) AS display_rank,
    COUNT(*) OVER (PARTITION BY q.organization_id, q.number_core) AS core_count,
    ROW_NUMBER() OVER (PARTITION BY q.organization_id, q.number_core ORDER BY q.created_at, q.id) AS core_rank
  FROM quotes q
  JOIN prefix_by_org p ON p.organization_id = q.organization_id
),
to_repair AS (
  SELECT *
  FROM ranked
  WHERE number_core IS NULL
     OR display_number IS NULL
     OR btrim(display_number) = ''
     OR (display_number IS NOT NULL AND btrim(display_number) <> '' AND display_count > 1 AND display_rank > 1)
     OR (number_core IS NOT NULL AND core_count > 1 AND core_rank > 1)
),
maxes AS (
  SELECT organization_id, COALESCE(MAX(number_core), 999) AS max_core
  FROM quotes
  GROUP BY organization_id
),
assigned AS (
  SELECT
    r.id,
    r.organization_id,
    r.prefix,
    (m.max_core + ROW_NUMBER() OVER (PARTITION BY r.organization_id ORDER BY r.created_at, r.id))::integer AS new_core
  FROM to_repair r
  JOIN maxes m ON m.organization_id = r.organization_id
)
UPDATE quotes q
SET
  quote_number = a.new_core,
  number_core = a.new_core,
  display_number = a.prefix || a.new_core::text
FROM assigned a
WHERE q.id = a.id;

--> statement-breakpoint

WITH prefix_by_org AS (
  SELECT
    o.id AS organization_id,
    COALESCE(op.value, 'ORD-') AS prefix
  FROM organizations o
  LEFT JOIN global_variables op
    ON op.organization_id = o.id
   AND op.name = 'order_number_prefix'
),
ranked AS (
  SELECT
    o.id,
    o.organization_id,
    o.created_at,
    o.display_number,
    o.number_core,
    o.order_number,
    p.prefix,
    COUNT(*) OVER (PARTITION BY o.organization_id, o.display_number) AS display_count,
    ROW_NUMBER() OVER (PARTITION BY o.organization_id, o.display_number ORDER BY o.created_at, o.id) AS display_rank,
    COUNT(*) OVER (PARTITION BY o.organization_id, o.number_core) AS core_count,
    ROW_NUMBER() OVER (PARTITION BY o.organization_id, o.number_core ORDER BY o.created_at, o.id) AS core_rank
  FROM orders o
  JOIN prefix_by_org p ON p.organization_id = o.organization_id
),
to_repair AS (
  SELECT *
  FROM ranked
  WHERE number_core IS NULL
     OR display_number IS NULL
     OR btrim(display_number) = ''
     OR (display_number IS NOT NULL AND btrim(display_number) <> '' AND display_count > 1 AND display_rank > 1)
     OR (number_core IS NOT NULL AND core_count > 1 AND core_rank > 1)
),
maxes AS (
  SELECT organization_id, COALESCE(MAX(number_core), 999) AS max_core
  FROM orders
  GROUP BY organization_id
),
assigned AS (
  SELECT
    r.id,
    r.organization_id,
    r.prefix,
    (m.max_core + ROW_NUMBER() OVER (PARTITION BY r.organization_id ORDER BY r.created_at, r.id))::integer AS new_core
  FROM to_repair r
  JOIN maxes m ON m.organization_id = r.organization_id
)
UPDATE orders o
SET
  order_number = a.new_core::text,
  number_core = a.new_core,
  display_number = a.prefix || a.new_core::text,
  updated_at = NOW()
FROM assigned a
WHERE o.id = a.id;

--> statement-breakpoint

WITH prefix_by_org AS (
  SELECT
    o.id AS organization_id,
    COALESCE(ip.value, 'INV-') AS prefix
  FROM organizations o
  LEFT JOIN global_variables ip
    ON ip.organization_id = o.id
   AND ip.name = 'invoice_number_prefix'
),
ranked AS (
  SELECT
    i.id,
    i.organization_id,
    i.created_at,
    i.display_number,
    i.number_core,
    p.prefix,
    COUNT(*) OVER (PARTITION BY i.organization_id, i.display_number) AS display_count,
    ROW_NUMBER() OVER (PARTITION BY i.organization_id, i.display_number ORDER BY i.created_at, i.id) AS display_rank,
    COUNT(*) OVER (PARTITION BY i.organization_id, i.number_core) AS core_count,
    ROW_NUMBER() OVER (PARTITION BY i.organization_id, i.number_core ORDER BY i.created_at, i.id) AS core_rank
  FROM invoices i
  JOIN prefix_by_org p ON p.organization_id = i.organization_id
),
to_repair AS (
  SELECT *
  FROM ranked
  WHERE number_core IS NULL
     OR display_number IS NULL
     OR btrim(display_number) = ''
     OR (display_number IS NOT NULL AND btrim(display_number) <> '' AND display_count > 1 AND display_rank > 1)
     OR (number_core IS NOT NULL AND core_count > 1 AND core_rank > 1)
),
maxes AS (
  SELECT organization_id, COALESCE(MAX(number_core), 999) AS max_core
  FROM invoices
  GROUP BY organization_id
),
assigned AS (
  SELECT
    r.id,
    r.organization_id,
    r.prefix,
    (m.max_core + ROW_NUMBER() OVER (PARTITION BY r.organization_id ORDER BY r.created_at, r.id))::integer AS new_core
  FROM to_repair r
  JOIN maxes m ON m.organization_id = r.organization_id
)
UPDATE invoices i
SET
  invoice_number = a.new_core,
  number_core = a.new_core,
  display_number = a.prefix || a.new_core::text,
  updated_at = NOW()
FROM assigned a
WHERE i.id = a.id;

--> statement-breakpoint

INSERT INTO global_variables (id, organization_id, name, value, description, category, is_active, created_at, updated_at)
SELECT gen_random_uuid(), o.id, 'next_quote_number', '1000', 'Next quote number sequence (auto-initialized)', 'numbering', true, NOW(), NOW()
FROM organizations o
ON CONFLICT (organization_id, name) DO NOTHING;

--> statement-breakpoint

INSERT INTO global_variables (id, organization_id, name, value, description, category, is_active, created_at, updated_at)
SELECT gen_random_uuid(), o.id, 'next_order_number', '1000', 'Next order number sequence (auto-initialized)', 'numbering', true, NOW(), NOW()
FROM organizations o
ON CONFLICT (organization_id, name) DO NOTHING;

--> statement-breakpoint

INSERT INTO global_variables (id, organization_id, name, value, description, category, is_active, created_at, updated_at)
SELECT gen_random_uuid(), o.id, 'next_invoice_number', '1000', 'Next invoice number sequence (auto-initialized)', 'numbering', true, NOW(), NOW()
FROM organizations o
ON CONFLICT (organization_id, name) DO NOTHING;

--> statement-breakpoint

WITH maxes AS (
  SELECT organization_id, COALESCE(MAX(number_core), 999) + 1 AS next_value
  FROM quotes
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
  AND gv.name = 'next_quote_number';

--> statement-breakpoint

WITH maxes AS (
  SELECT organization_id, COALESCE(MAX(number_core), 999) + 1 AS next_value
  FROM orders
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
  AND gv.name = 'next_order_number';

--> statement-breakpoint

WITH maxes AS (
  SELECT organization_id, COALESCE(MAX(number_core), 999) + 1 AS next_value
  FROM invoices
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
  AND gv.name = 'next_invoice_number';

--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS quotes_org_display_number_unique
  ON quotes(organization_id, display_number)
  WHERE display_number IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS orders_org_display_number_unique
  ON orders(organization_id, display_number)
  WHERE display_number IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS invoices_org_display_number_unique
  ON invoices(organization_id, display_number)
  WHERE display_number IS NOT NULL;

--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS quotes_org_number_core_unique
  ON quotes(organization_id, number_core)
  WHERE number_core IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS orders_org_number_core_unique
  ON orders(organization_id, number_core)
  WHERE number_core IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS invoices_org_number_core_unique
  ON invoices(organization_id, number_core)
  WHERE number_core IS NOT NULL;
