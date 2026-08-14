-- V2 M0 foundation persistence. These additive tables are intentionally
-- independent of legacy business rows while V1 remains the sole writer.

CREATE TABLE v2_operation_requests (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  operation varchar(128) NOT NULL,
  business_request_id varchar(160) NOT NULL,
  payload_fingerprint varchar(128) NOT NULL,
  status varchar(24) NOT NULL DEFAULT 'in_progress',
  result_resource_type varchar(80),
  result_resource_id varchar,
  result_json jsonb,
  initiated_principal_kind varchar(32) NOT NULL,
  initiated_principal_subject varchar(160) NOT NULL,
  staff_actor_user_id varchar REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CONSTRAINT v2_operation_requests_status_chk
    CHECK (status IN ('in_progress', 'succeeded', 'retryable_failure', 'permanent_failure')),
  CONSTRAINT v2_operation_requests_principal_kind_chk
    CHECK (initiated_principal_kind IN ('staff', 'delegated_ai', 'portal', 'service')),
  CONSTRAINT v2_operation_requests_completion_chk
    CHECK (
      (status = 'succeeded' AND completed_at IS NOT NULL)
      OR (status <> 'succeeded')
    ),
  CONSTRAINT v2_operation_requests_id_organization_uidx
    UNIQUE (id, organization_id),
  CONSTRAINT v2_operation_requests_business_request_uidx
    UNIQUE (organization_id, operation, business_request_id)
);

CREATE INDEX v2_operation_requests_org_status_available_idx
  ON v2_operation_requests (organization_id, status, updated_at DESC);

CREATE TABLE v2_principal_attributions (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  operation_request_id varchar,
  operation varchar(128) NOT NULL,
  resource_type varchar(80) NOT NULL,
  resource_id varchar NOT NULL,
  principal_kind varchar(32) NOT NULL,
  principal_subject varchar(160) NOT NULL,
  staff_actor_user_id varchar REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT v2_principal_attributions_principal_kind_chk
    CHECK (principal_kind IN ('staff', 'delegated_ai', 'portal', 'service')),
  -- A request attribution can never point at a request in another tenant.
  CONSTRAINT v2_principal_attributions_request_tenant_fk
    FOREIGN KEY (operation_request_id, organization_id)
    REFERENCES v2_operation_requests (id, organization_id)
    ON DELETE RESTRICT
);

CREATE INDEX v2_principal_attributions_org_resource_idx
  ON v2_principal_attributions (organization_id, resource_type, resource_id, created_at DESC);
CREATE INDEX v2_principal_attributions_operation_request_idx
  ON v2_principal_attributions (operation_request_id)
  WHERE operation_request_id IS NOT NULL;

CREATE TABLE v2_outbox_messages (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  event_type varchar(128) NOT NULL,
  aggregate_type varchar(80) NOT NULL,
  aggregate_id varchar NOT NULL,
  idempotency_key varchar(160) NOT NULL,
  payload jsonb NOT NULL,
  status varchar(24) NOT NULL DEFAULT 'pending',
  attempt_count integer NOT NULL DEFAULT 0,
  available_at timestamptz NOT NULL DEFAULT now(),
  claimed_by varchar(160),
  lease_expires_at timestamptz,
  last_error varchar(1000),
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CONSTRAINT v2_outbox_messages_status_chk
    CHECK (status IN ('pending', 'processing', 'completed', 'dead_letter')),
  CONSTRAINT v2_outbox_messages_attempt_count_chk CHECK (attempt_count >= 0),
  CONSTRAINT v2_outbox_messages_lease_chk
    CHECK ((status = 'processing') = (claimed_by IS NOT NULL AND lease_expires_at IS NOT NULL)),
  CONSTRAINT v2_outbox_messages_completion_chk
    CHECK (
      (status = 'completed' AND completed_at IS NOT NULL)
      OR (status <> 'completed' AND completed_at IS NULL)
    ),
  CONSTRAINT v2_outbox_messages_identity_uidx
    UNIQUE (organization_id, event_type, aggregate_type, aggregate_id, idempotency_key)
);

CREATE INDEX v2_outbox_messages_claim_idx
  ON v2_outbox_messages (available_at, created_at)
  WHERE status = 'pending';
CREATE INDEX v2_outbox_messages_lease_idx
  ON v2_outbox_messages (lease_expires_at)
  WHERE status = 'processing';
