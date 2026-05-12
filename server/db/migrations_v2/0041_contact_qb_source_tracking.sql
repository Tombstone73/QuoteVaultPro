-- Migration 0041: Add QuickBooks source-tracking columns to customer_contacts
-- Enables stable, idempotent QB contact sync without relying on name/email fuzzy match.
-- external_source + external_source_id together form the definitive contact identity link.

ALTER TABLE customer_contacts
  ADD COLUMN IF NOT EXISTS external_source varchar(30),
  ADD COLUMN IF NOT EXISTS external_source_id text,
  ADD COLUMN IF NOT EXISTS external_source_type varchar(50);

-- Lookup index for source-based dedup queries during QB pull
CREATE INDEX IF NOT EXISTS customer_contacts_external_source_idx
  ON customer_contacts (customer_id, external_source, external_source_id)
  WHERE external_source IS NOT NULL AND external_source_id IS NOT NULL;

-- Partial unique index: one contact per QB source identity per customer.
-- Scoped to customer_id so the same QB Customer.Id in different QB companies/orgs
-- does NOT create a cross-tenant collision (each org has its own customer rows).
CREATE UNIQUE INDEX IF NOT EXISTS customer_contacts_qb_source_uidx
  ON customer_contacts (customer_id, external_source, external_source_id, external_source_type)
  WHERE external_source IS NOT NULL AND external_source_id IS NOT NULL;

-- Backfill: attach QB source fields to existing primary contacts that were created
-- by a prior QB pull run (before source tracking existed).
-- Conditions:
--   1. contact.customer_id belongs to a customer with externalAccountingId set (= was QB-imported)
--   2. contact.external_source is NULL (not yet source-tagged)
--   3. contact.is_primary = TRUE (QB pull only creates primary contacts)
--   4. Only the earliest-created primary contact per customer is tagged (rn=1),
--      preventing unique-constraint violations if a customer somehow has multiple primaries.
WITH ranked_primaries AS (
  SELECT
    cc.id AS contact_id,
    c.external_accounting_id AS qb_customer_id,
    ROW_NUMBER() OVER (PARTITION BY cc.customer_id ORDER BY cc.created_at ASC) AS rn
  FROM customer_contacts cc
  JOIN customers c ON c.id = cc.customer_id
  WHERE c.external_accounting_id IS NOT NULL
    AND cc.is_primary = TRUE
    AND cc.external_source IS NULL
)
UPDATE customer_contacts cc
SET
  external_source      = 'quickbooks',
  external_source_id   = rp.qb_customer_id,
  external_source_type = 'customer_primary_contact'
FROM ranked_primaries rp
WHERE cc.id = rp.contact_id
  AND rp.rn = 1;
