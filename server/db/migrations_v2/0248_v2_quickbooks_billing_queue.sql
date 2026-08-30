-- M6: QuickBooks is an integration projection of canonical V2 Billing facts.
-- These tables deliberately contain no mutable financial truth; they provide a
-- durable, tenant-scoped queue and provider identity links only.

CREATE TABLE v2_quickbooks_sync_links (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  entity_kind varchar(24) NOT NULL,
  entity_id varchar NOT NULL,
  provider_id varchar(200) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT v2_quickbooks_sync_links_kind_chk CHECK (entity_kind IN ('customer','invoice','payment')),
  CONSTRAINT v2_quickbooks_sync_links_entity_uidx UNIQUE (organization_id, entity_kind, entity_id),
  CONSTRAINT v2_quickbooks_sync_links_provider_uidx UNIQUE (organization_id, entity_kind, provider_id)
);

CREATE TABLE v2_quickbooks_sync_jobs (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  subject_kind varchar(24) NOT NULL,
  subject_id varchar NOT NULL,
  state varchar(24) NOT NULL DEFAULT 'queued',
  attempt_count integer NOT NULL DEFAULT 0,
  available_at timestamptz NOT NULL DEFAULT now(),
  lease_expires_at timestamptz,
  claimed_by varchar(160),
  last_error varchar(500),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CONSTRAINT v2_quickbooks_sync_jobs_kind_chk CHECK (subject_kind IN ('invoice','payment')),
  CONSTRAINT v2_quickbooks_sync_jobs_state_chk CHECK (state IN ('queued','processing','retry','succeeded','uncertain','blocked')),
  CONSTRAINT v2_quickbooks_sync_jobs_attempt_chk CHECK (attempt_count >= 0),
  CONSTRAINT v2_quickbooks_sync_jobs_subject_uidx UNIQUE (organization_id, subject_kind, subject_id)
);

CREATE INDEX v2_quickbooks_sync_jobs_claim_idx
  ON v2_quickbooks_sync_jobs (state, available_at, created_at)
  WHERE state IN ('queued', 'retry', 'processing');
