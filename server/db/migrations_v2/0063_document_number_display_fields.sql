-- Migration 0063: Phase 1 configurable document number display fields
--
-- Adds immutable display numbers and numeric cores for quotes, orders, and invoices.
-- Adds org-scoped prefix settings in global_variables. Existing records are backfilled
-- with the Phase 1 default prefixes without changing legacy numeric/source columns.

ALTER TABLE quotes ADD COLUMN IF NOT EXISTS display_number VARCHAR(64);
--> statement-breakpoint
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS number_core INTEGER;
--> statement-breakpoint
ALTER TABLE orders ADD COLUMN IF NOT EXISTS display_number VARCHAR(64);
--> statement-breakpoint
ALTER TABLE orders ADD COLUMN IF NOT EXISTS number_core INTEGER;
--> statement-breakpoint
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS display_number VARCHAR(64);
--> statement-breakpoint
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS number_core INTEGER;

--> statement-breakpoint

INSERT INTO global_variables (id, organization_id, name, value, description, category, is_active, created_at, updated_at)
SELECT gen_random_uuid(), o.id, 'quote_number_prefix', 'QT-', 'Quote number prefix', 'numbering', true, NOW(), NOW()
FROM organizations o
ON CONFLICT (organization_id, name) DO NOTHING;

--> statement-breakpoint

INSERT INTO global_variables (id, organization_id, name, value, description, category, is_active, created_at, updated_at)
SELECT gen_random_uuid(), o.id, 'order_number_prefix', 'ORD-', 'Order number prefix', 'numbering', true, NOW(), NOW()
FROM organizations o
ON CONFLICT (organization_id, name) DO NOTHING;

--> statement-breakpoint

INSERT INTO global_variables (id, organization_id, name, value, description, category, is_active, created_at, updated_at)
SELECT gen_random_uuid(), o.id, 'invoice_number_prefix', 'INV-', 'Invoice number prefix', 'numbering', true, NOW(), NOW()
FROM organizations o
ON CONFLICT (organization_id, name) DO NOTHING;

--> statement-breakpoint

UPDATE quotes
SET
  number_core = COALESCE(number_core, quote_number),
  display_number = COALESCE(display_number, 'QT-' || quote_number::text)
WHERE quote_number IS NOT NULL
  AND (number_core IS NULL OR display_number IS NULL);

--> statement-breakpoint

UPDATE orders
SET
  number_core = COALESCE(
    number_core,
    CASE WHEN order_number ~ '^[0-9]+$' THEN order_number::integer ELSE NULL END
  ),
  display_number = COALESCE(
    display_number,
    CASE WHEN order_number ~ '^[0-9]+$' THEN 'ORD-' || order_number ELSE order_number END
  )
WHERE order_number IS NOT NULL
  AND (number_core IS NULL OR display_number IS NULL);

--> statement-breakpoint

UPDATE invoices
SET
  number_core = COALESCE(number_core, invoice_number),
  display_number = COALESCE(display_number, 'INV-' || invoice_number::text)
WHERE invoice_number IS NOT NULL
  AND (number_core IS NULL OR display_number IS NULL);

--> statement-breakpoint

CREATE INDEX IF NOT EXISTS quotes_display_number_idx ON quotes(display_number);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS quotes_number_core_idx ON quotes(number_core);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS orders_display_number_idx ON orders(display_number);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS orders_number_core_idx ON orders(number_core);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS invoices_display_number_idx ON invoices(display_number);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS invoices_number_core_idx ON invoices(number_core);

--> statement-breakpoint

-- Do not add org/display_number uniqueness yet. Existing environments can
-- contain duplicate legacy numbers; a later cleanup migration should resolve
-- historical duplicates before adding a strict unique index.
