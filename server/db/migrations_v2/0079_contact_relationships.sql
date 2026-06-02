ALTER TABLE customer_contacts
  ADD COLUMN IF NOT EXISTS organization_id varchar,
  ADD COLUMN IF NOT EXISTS status varchar(30) NOT NULL DEFAULT 'active';

UPDATE customer_contacts cc
SET organization_id = c.organization_id
FROM customers c
WHERE cc.customer_id = c.id
  AND cc.organization_id IS NULL;

ALTER TABLE customer_contacts
  ALTER COLUMN organization_id SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE constraint_name = 'customer_contacts_organization_id_organizations_id_fk'
      AND table_name = 'customer_contacts'
  ) THEN
    ALTER TABLE customer_contacts
      ADD CONSTRAINT customer_contacts_organization_id_organizations_id_fk
      FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;
  END IF;
END $$;

ALTER TABLE customer_contacts
  DROP CONSTRAINT IF EXISTS customer_contacts_customer_id_customers_id_fk;

ALTER TABLE customer_contacts
  ALTER COLUMN customer_id DROP NOT NULL;

ALTER TABLE customer_contacts
  ADD CONSTRAINT customer_contacts_customer_id_customers_id_fk
  FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS customer_contact_links (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  customer_id varchar NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  contact_id varchar NOT NULL REFERENCES customer_contacts(id) ON DELETE CASCADE,
  status varchar(30) NOT NULL DEFAULT 'active',
  is_primary boolean NOT NULL DEFAULT false,
  is_billing boolean NOT NULL DEFAULT false,
  is_portal boolean NOT NULL DEFAULT false,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

INSERT INTO customer_contact_links (
  organization_id,
  customer_id,
  contact_id,
  status,
  is_primary,
  is_billing,
  is_portal,
  created_at,
  updated_at
)
SELECT
  cc.organization_id,
  cc.customer_id,
  cc.id,
  'active',
  cc.is_primary,
  COALESCE(cc.flags ? 'billing_contact', false),
  EXISTS (
    SELECT 1
    FROM customer_portal_access cpa
    WHERE cpa.contact_id = cc.id
      AND cpa.customer_id = cc.customer_id
  ),
  cc.created_at,
  cc.updated_at
FROM customer_contacts cc
WHERE cc.customer_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM customer_contact_links ccl
    WHERE ccl.customer_id = cc.customer_id
      AND ccl.contact_id = cc.id
      AND ccl.status <> 'removed'
  );

CREATE INDEX IF NOT EXISTS customer_contacts_org_idx
  ON customer_contacts (organization_id);

CREATE INDEX IF NOT EXISTS customer_contacts_legacy_customer_idx
  ON customer_contacts (customer_id);

CREATE INDEX IF NOT EXISTS customer_contacts_status_idx
  ON customer_contacts (status);

CREATE INDEX IF NOT EXISTS customer_contact_links_org_idx
  ON customer_contact_links (organization_id);

CREATE INDEX IF NOT EXISTS customer_contact_links_customer_idx
  ON customer_contact_links (customer_id);

CREATE INDEX IF NOT EXISTS customer_contact_links_contact_idx
  ON customer_contact_links (contact_id);

CREATE INDEX IF NOT EXISTS customer_contact_links_status_idx
  ON customer_contact_links (status);

CREATE UNIQUE INDEX IF NOT EXISTS customer_contact_links_active_pair_uidx
  ON customer_contact_links (customer_id, contact_id)
  WHERE status <> 'removed';

WITH ranked_primary_links AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY customer_id
      ORDER BY created_at ASC, id ASC
    ) AS primary_rank
  FROM customer_contact_links
  WHERE is_primary = true
    AND status = 'active'
)
UPDATE customer_contact_links ccl
SET is_primary = false,
    updated_at = now()
FROM ranked_primary_links ranked
WHERE ccl.id = ranked.id
  AND ranked.primary_rank > 1;

CREATE UNIQUE INDEX IF NOT EXISTS customer_contact_links_primary_uidx
  ON customer_contact_links (customer_id)
  WHERE is_primary = true AND status = 'active';
