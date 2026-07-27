CREATE TABLE IF NOT EXISTS ai_product_draft_batches (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(), org_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  plan_id varchar REFERENCES ai_execution_plans(id) ON DELETE SET NULL, conversation_id varchar REFERENCES ai_conversations(id) ON DELETE SET NULL,
  source_turn_id varchar REFERENCES ai_turns(id) ON DELETE SET NULL, actor_user_id varchar REFERENCES users(id) ON DELETE SET NULL,
  command_name varchar(120) NOT NULL, command_version varchar(64) NOT NULL, label varchar(255) NOT NULL, source_format varchar(32) NOT NULL,
  shared_defaults jsonb NOT NULL DEFAULT '{}'::jsonb, source_metadata jsonb NOT NULL DEFAULT '{}'::jsonb, fingerprint varchar(128) NOT NULL,
  proposal_status varchar(32) NOT NULL DEFAULT 'proposed', execution_status varchar(32) NOT NULL DEFAULT 'proposed',
  submitted_count integer NOT NULL, included_count integer NOT NULL, excluded_count integer NOT NULL DEFAULT 0, correlation_id varchar(128), idempotency_key varchar(160),
  confirmed_at timestamptz, started_at timestamptz, completed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS ai_product_draft_batch_rows (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(), batch_id varchar NOT NULL REFERENCES ai_product_draft_batches(id) ON DELETE CASCADE, org_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  source_row_number integer NOT NULL, source_row_label varchar(255), product_name varchar(255) NOT NULL, resolved_payload jsonb NOT NULL DEFAULT '{}'::jsonb, provenance jsonb NOT NULL DEFAULT '{}'::jsonb,
  fingerprint varchar(128) NOT NULL, idempotency_key varchar(160) NOT NULL, execution_state varchar(32) NOT NULL DEFAULT 'pending', product_id varchar REFERENCES products(id) ON DELETE SET NULL,
  readiness_result jsonb, attempt_count integer NOT NULL DEFAULT 0, last_error_code varchar(120), last_error_message varchar(1000), retryable boolean NOT NULL DEFAULT false,
  started_at timestamptz, completed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_product_draft_batch_rows_batch_source_row_uidx UNIQUE(batch_id, source_row_number), CONSTRAINT ai_product_draft_batch_rows_org_idempotency_uidx UNIQUE(org_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS ai_product_draft_batches_org_created_idx ON ai_product_draft_batches(org_id, created_at);
CREATE INDEX IF NOT EXISTS ai_product_draft_batches_org_conversation_created_idx ON ai_product_draft_batches(org_id, conversation_id, created_at);
CREATE INDEX IF NOT EXISTS ai_product_draft_batches_org_status_created_idx ON ai_product_draft_batches(org_id, execution_status, created_at);
CREATE INDEX IF NOT EXISTS ai_product_draft_batch_rows_org_batch_state_idx ON ai_product_draft_batch_rows(org_id, batch_id, execution_state);
