-- Migration 0061: Seed next_order_number and next_invoice_number for existing organizations
--
-- These rows are auto-initialized by application code on first use, but seeding them here
-- ensures admin settings UI shows the values immediately without waiting for the first order
-- or invoice to be created. Safe defaults: 1000 for both sequences.
--
-- Uses INSERT ... ON CONFLICT DO NOTHING so re-running is always safe.

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
