-- Durable V2 Artwork upload intent. This is intentionally limited to the
-- private v2-artwork object namespace; it is not a second file authority.
-- v2_artwork_files remains the canonical adopted-file reference.

CREATE TABLE v2_artwork_storage_upload_intents (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  storage_provider varchar(64) NOT NULL,
  object_key varchar(1024) NOT NULL,
  request_identity varchar(160) NOT NULL,
  expected_checksum_sha256 varchar(64) NOT NULL,
  expected_content_type varchar(255) NOT NULL,
  expected_byte_size bigint NOT NULL,
  state varchar(32) NOT NULL DEFAULT 'pending_write',
  object_created_by_intent boolean NOT NULL DEFAULT false,
  adopted_artwork_file_id varchar,
  cleanup_attempts integer NOT NULL DEFAULT 0,
  last_error_code varchar(120),
  stored_at timestamptz,
  adopted_at timestamptz,
  cleaned_at timestamptz,
  reconciliation_lease_token varchar(64),
  reconciliation_lease_expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT v2_artwork_storage_upload_intents_state_chk CHECK (state IN ('pending_write','stored','adopted','cleanup_pending','reconciling','cleaned','retained')),
  CONSTRAINT v2_artwork_storage_upload_intents_checksum_chk CHECK (expected_checksum_sha256 ~ '^[A-Fa-f0-9]{64}$'),
  CONSTRAINT v2_artwork_storage_upload_intents_size_chk CHECK (expected_byte_size >= 0),
  CONSTRAINT v2_artwork_storage_upload_intents_adopted_chk CHECK ((state <> 'adopted') OR adopted_artwork_file_id IS NOT NULL),
  CONSTRAINT v2_artwork_storage_upload_intents_org_object_uidx UNIQUE (organization_id, storage_provider, object_key)
);

ALTER TABLE v2_artwork_storage_upload_intents
  ADD CONSTRAINT v2_artwork_storage_upload_intents_file_tenant_fk
  FOREIGN KEY (adopted_artwork_file_id, organization_id)
  REFERENCES v2_artwork_files(id, organization_id) ON DELETE RESTRICT;

CREATE INDEX v2_artwork_storage_upload_intents_reconcile_idx
  ON v2_artwork_storage_upload_intents(state, updated_at)
  WHERE state IN ('pending_write','stored','cleanup_pending','reconciling');
CREATE INDEX v2_artwork_storage_upload_intents_org_created_idx
  ON v2_artwork_storage_upload_intents(organization_id, created_at DESC);
