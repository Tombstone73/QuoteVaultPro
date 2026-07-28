CREATE TABLE IF NOT EXISTS ai_product_draft_bulk_updates (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(), org_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  plan_id varchar REFERENCES ai_execution_plans(id) ON DELETE SET NULL, conversation_id varchar REFERENCES ai_conversations(id) ON DELETE SET NULL, source_turn_id varchar REFERENCES ai_turns(id) ON DELETE SET NULL, actor_user_id varchar REFERENCES users(id) ON DELETE SET NULL, source_batch_id varchar REFERENCES ai_product_draft_batches(id) ON DELETE SET NULL,
  command_name varchar(120) NOT NULL, command_version varchar(64) NOT NULL, selection_description varchar(1000) NOT NULL,
  shared_patch jsonb NOT NULL, overrides jsonb NOT NULL DEFAULT '{}'::jsonb, provenance jsonb NOT NULL DEFAULT '{}'::jsonb, fingerprint varchar(128) NOT NULL,
  proposal_status varchar(32) NOT NULL DEFAULT 'proposed', confirmation_status varchar(32) NOT NULL DEFAULT 'pending', execution_status varchar(32) NOT NULL DEFAULT 'proposed',
  target_count integer NOT NULL, eligible_count integer NOT NULL, no_change_count integer NOT NULL DEFAULT 0, blocked_count integer NOT NULL DEFAULT 0,
  correlation_id varchar(128), idempotency_key varchar(160), confirmed_at timestamptz, started_at timestamptz, completed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS ai_product_draft_bulk_update_rows (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(), bulk_update_id varchar NOT NULL REFERENCES ai_product_draft_bulk_updates(id) ON DELETE CASCADE, org_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  source_order integer NOT NULL, product_id varchar NOT NULL REFERENCES products(id) ON DELETE RESTRICT, session_id varchar(128) NOT NULL, product_name varchar(255) NOT NULL, category varchar(100),
  before_snapshot jsonb NOT NULL, before_fingerprint varchar(128) NOT NULL, patch jsonb NOT NULL, patch_domain varchar(32) NOT NULL, provenance jsonb NOT NULL DEFAULT '{}'::jsonb, fingerprint varchar(128) NOT NULL, idempotency_key varchar(160) NOT NULL,
  eligibility_state varchar(32) NOT NULL, execution_state varchar(32) NOT NULL DEFAULT 'pending', attempt_count integer NOT NULL DEFAULT 0, warnings jsonb NOT NULL DEFAULT '[]'::jsonb, readiness_before jsonb, readiness_after jsonb, after_snapshot jsonb, last_error_code varchar(120), last_error_message varchar(1000), retryable boolean NOT NULL DEFAULT false, last_attempted_at timestamptz, completed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_product_draft_bulk_update_rows_bulk_source_uidx UNIQUE(bulk_update_id, source_order), CONSTRAINT ai_product_draft_bulk_update_rows_org_idempotency_uidx UNIQUE(org_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS ai_product_draft_bulk_updates_org_created_idx ON ai_product_draft_bulk_updates(org_id, created_at);
CREATE INDEX IF NOT EXISTS ai_product_draft_bulk_updates_org_status_created_idx ON ai_product_draft_bulk_updates(org_id, execution_status, created_at);
CREATE INDEX IF NOT EXISTS ai_product_draft_bulk_updates_org_conversation_created_idx ON ai_product_draft_bulk_updates(org_id, conversation_id, created_at);
CREATE INDEX IF NOT EXISTS ai_product_draft_bulk_update_rows_org_bulk_state_idx ON ai_product_draft_bulk_update_rows(org_id, bulk_update_id, execution_state);
