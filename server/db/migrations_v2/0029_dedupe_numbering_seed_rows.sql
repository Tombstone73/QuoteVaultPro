-- Migration 0029: Deduplicate numbering seed rows and enforce org-scoped uniqueness
--
-- Root cause: migrations 0026 and 0028 both contained INSERT...WHERE NOT EXISTS
-- seed logic for next_order_number and next_invoice_number. When Drizzle applied
-- all pending migrations in a single transaction, PostgreSQL's snapshot isolation
-- caused 0028's NOT EXISTS check to not see 0026's uncommitted inserts, so both
-- executed and produced one duplicate row per org per numbering key.
--
-- Dedupe rule: for each (organization_id, name) pair, keep the row with the
-- highest numeric value. This avoids resetting any sequence backward.
--
-- After dedup, enforce uniqueness on (organization_id, name) across the whole
-- table so this cannot happen again for any key.

DELETE FROM global_variables
WHERE name IN ('next_order_number', 'next_invoice_number')
  AND id NOT IN (
    SELECT DISTINCT ON (organization_id, name) id
    FROM global_variables
    WHERE name IN ('next_order_number', 'next_invoice_number')
    ORDER BY organization_id, name, CAST(value AS INTEGER) DESC
  );

--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS global_variables_org_name_unique_idx
  ON global_variables (organization_id, name);
