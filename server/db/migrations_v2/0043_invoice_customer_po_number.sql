-- Migration 0043: Add customer PO number and QB PO source tracking to invoices
-- Required before QuickBooks invoice import so PO data is never buried in the
-- qb_line_items_snapshot JSON blob and is always visible on the invoice record.
--
-- customer_po_number: the PO/reference string extracted from the QB invoice (or
--   entered manually on any TitanOS invoice). Intentionally wider than orders.po_number
--   (varchar 64) to accommodate QB values that may include prefixes/formats.
--
-- qb_po_source: records which QB field the PO was extracted from during import,
--   so an admin can verify the extraction without re-fetching from QB.
--   Values: 'custom_field' | 'private_note' | 'customer_memo' | 'line_description' | null

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS customer_po_number varchar(100),
  ADD COLUMN IF NOT EXISTS qb_po_source varchar(50);

-- Lightweight index for PO-based lookups per org (e.g. "find invoice by customer PO")
CREATE INDEX IF NOT EXISTS invoices_customer_po_number_org_idx
  ON invoices (organization_id, customer_po_number)
  WHERE customer_po_number IS NOT NULL;
