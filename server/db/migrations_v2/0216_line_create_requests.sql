-- Receipt and canonical line are committed atomically. Expired keys are rejected.
CREATE TABLE line_create_requests (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  actor_user_id varchar NOT NULL,
  operation_type varchar(32) NOT NULL,
  document_type varchar(32) NOT NULL,
  document_id varchar NOT NULL,
  request_key varchar(160) NOT NULL,
  request_hash varchar(64) NOT NULL,
  result_line_id varchar NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX line_create_requests_scope_key_uidx ON line_create_requests
  (organization_id, actor_user_id, operation_type, document_type, document_id, request_key);
--> statement-breakpoint
CREATE INDEX line_create_requests_expiry_idx ON line_create_requests (expires_at);
