-- Migration 0028: Repair numbering and snapshot columns
--
-- Forward-only repair. All operations are idempotent.
-- Ensures changes from 0026 and 0027 are definitively applied.

ALTER TABLE orders ADD COLUMN IF NOT EXISTS source_quote_number INTEGER;

--> statement-breakpoint

ALTER TABLE invoices ADD COLUMN IF NOT EXISTS source_order_number INTEGER;

--> statement-breakpoint

INSERT INTO global_variables (id, organization_id, name, value, description, category, is_active, created_at, updated_at)
SELECT
  gen_random_uuid(),
  o.id,
  'next_order_number',
  '1000',
  'Next order number sequence',
  'numbering',
  true,
  NOW(),
  NOW()
FROM organizations o
WHERE NOT EXISTS (
  SELECT 1 FROM global_variables gv
  WHERE gv.organization_id = o.id
    AND gv.name = 'next_order_number'
);

--> statement-breakpoint

INSERT INTO global_variables (id, organization_id, name, value, description, category, is_active, created_at, updated_at)
SELECT
  gen_random_uuid(),
  o.id,
  'next_invoice_number',
  '1000',
  'Next invoice number sequence',
  'numbering',
  true,
  NOW(),
  NOW()
FROM organizations o
WHERE NOT EXISTS (
  SELECT 1 FROM global_variables gv
  WHERE gv.organization_id = o.id
    AND gv.name = 'next_invoice_number'
);
