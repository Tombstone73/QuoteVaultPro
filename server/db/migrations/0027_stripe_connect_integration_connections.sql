-- Stripe Connect per-organization integration connections
-- Stores non-secret connection identifiers (e.g. stripeAccountId) scoped by organization.
-- NOTE: organizations.id is a varchar in this schema, so we keep ids as varchar and cast
-- gen_random_uuid() to text to avoid any implicit uuid->text coercion edge cases.

CREATE TABLE IF NOT EXISTS integration_connections (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  provider varchar(32) NOT NULL,
  external_account_id varchar(128),
  status varchar(20) NOT NULL DEFAULT 'disconnected',
  mode varchar(10) NOT NULL DEFAULT 'test',
  last_error text,
  connected_at timestamptz,
  disconnected_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS integration_connections_org_provider_uidx
  ON integration_connections (organization_id, provider);

CREATE INDEX IF NOT EXISTS integration_connections_provider_external_account_id_idx
  ON integration_connections (provider, external_account_id);

-- Prevent the same external account from being attached to multiple orgs for a given provider.
CREATE UNIQUE INDEX IF NOT EXISTS integration_connections_provider_external_account_id_uidx
  ON integration_connections (provider, external_account_id)
  WHERE external_account_id IS NOT NULL;
