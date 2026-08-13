-- Durable customer-merge provenance. Source records remain available for
-- historical lookups while normal customer queries continue excluding them.
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS merged_into_customer_id varchar(255) REFERENCES customers(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS merged_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS merged_by_user_id varchar(255) REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS customer_merge_operation_id varchar(255);

CREATE INDEX IF NOT EXISTS customers_merged_into_customer_idx
  ON customers (organization_id, merged_into_customer_id)
  WHERE merged_into_customer_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS customer_merge_operations (
  id varchar(255) PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id varchar(255) NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  survivor_customer_id varchar(255) NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  source_customer_ids jsonb NOT NULL,
  actor_user_id varchar(255) REFERENCES users(id) ON DELETE SET NULL,
  field_choices jsonb,
  relationship_counts jsonb NOT NULL DEFAULT '{}'::jsonb,
  warnings jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS customer_merge_operations_org_created_idx
  ON customer_merge_operations (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS customer_merge_operations_survivor_idx
  ON customer_merge_operations (organization_id, survivor_customer_id);
