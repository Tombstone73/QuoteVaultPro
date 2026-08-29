-- CRM master corrections use explicit revision counters for durable stale-write
-- protection.  Relationship-owned primary contact uniqueness already exists in
-- 0079; this migration deliberately does not create a second primary authority.
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS crm_revision bigint NOT NULL DEFAULT 1
  CHECK (crm_revision > 0);

ALTER TABLE customer_contacts
  ADD COLUMN IF NOT EXISTS crm_revision bigint NOT NULL DEFAULT 1
  CHECK (crm_revision > 0);
