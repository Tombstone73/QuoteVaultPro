-- V2 POC-only lifecycle and recovery metadata. Current business records remain
-- in their existing tables; this never enters the V1 migration stream.
CREATE TABLE IF NOT EXISTS v2_poc_artwork_requests (
  id varchar(96) PRIMARY KEY, organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  actor_user_id varchar NOT NULL REFERENCES users(id) ON DELETE CASCADE, operation varchar(80) NOT NULL,
  request_id varchar(160) NOT NULL, request_hash varchar(64) NOT NULL, result_json jsonb,
  created_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz,
  UNIQUE (organization_id, actor_user_id, operation, request_id)
);
CREATE TABLE IF NOT EXISTS v2_poc_line_artwork_state (
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  line_item_id varchar NOT NULL REFERENCES order_line_items(id) ON DELETE CASCADE,
  revision integer NOT NULL DEFAULT 0, updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, line_item_id)
);
CREATE TABLE IF NOT EXISTS v2_poc_artwork_retirements (
  id varchar(96) PRIMARY KEY, organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  line_item_id varchar NOT NULL REFERENCES order_line_items(id) ON DELETE CASCADE,
  artwork_id varchar NOT NULL REFERENCES line_item_artwork(id) ON DELETE RESTRICT,
  actor_user_id varchar REFERENCES users(id) ON DELETE SET NULL, reason text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, artwork_id)
);
CREATE TABLE IF NOT EXISTS v2_poc_proof_deliveries (
  id varchar(96) PRIMARY KEY, organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  proof_version_id varchar NOT NULL REFERENCES line_item_proof_versions(id) ON DELETE CASCADE,
  status varchar(16) NOT NULL DEFAULT 'PENDING', attempts integer NOT NULL DEFAULT 0, last_error text,
  created_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz, UNIQUE (organization_id, proof_version_id)
);
CREATE TABLE IF NOT EXISTS v2_poc_proof_artwork_assignments (
  id varchar(96) PRIMARY KEY, organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  proof_version_id varchar NOT NULL REFERENCES line_item_proof_versions(id) ON DELETE CASCADE,
  artwork_id varchar NOT NULL REFERENCES line_item_artwork(id) ON DELETE RESTRICT,
  file_record_id varchar NOT NULL REFERENCES file_records(id) ON DELETE RESTRICT,
  allocation_group_id varchar(128) NOT NULL, allocation_quantity integer NOT NULL,
  side line_item_artwork_side NOT NULL, UNIQUE (proof_version_id, artwork_id)
);
CREATE TABLE IF NOT EXISTS v2_poc_prepress_handoffs (
  id varchar(96) PRIMARY KEY, organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  order_id varchar NOT NULL REFERENCES orders(id) ON DELETE CASCADE, line_item_id varchar NOT NULL REFERENCES order_line_items(id) ON DELETE CASCADE,
  artwork_id varchar NOT NULL REFERENCES line_item_artwork(id) ON DELETE RESTRICT, file_record_id varchar NOT NULL REFERENCES file_records(id) ON DELETE RESTRICT,
  production_job_id varchar NOT NULL REFERENCES production_jobs(id) ON DELETE RESTRICT, status varchar(16) NOT NULL DEFAULT 'READY',
  snapshot_json jsonb NOT NULL, assignments_json jsonb NOT NULL DEFAULT '[]'::jsonb, created_at timestamptz NOT NULL DEFAULT now(), returned_at timestamptz, returned_by_user_id varchar REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE (organization_id, line_item_id, status)
);
ALTER TABLE v2_poc_prepress_handoffs ADD COLUMN IF NOT EXISTS assignments_json jsonb NOT NULL DEFAULT '[]'::jsonb;
