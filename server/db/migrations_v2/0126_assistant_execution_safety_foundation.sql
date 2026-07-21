-- Migration 0126: assistant controlled action-planning safety foundation
-- No business mutation is enabled by this migration. These rows only create
-- durable, tenant-bound plans, confirmations, steps, and idempotency locks.

CREATE TABLE IF NOT EXISTS ai_execution_plans (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id varchar NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  conversation_id varchar NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
  turn_id varchar REFERENCES ai_turns(id) ON DELETE SET NULL,
  context_snapshot_id varchar REFERENCES ai_context_snapshots(id) ON DELETE SET NULL,
  action varchar(120) NOT NULL,
  command_version varchar(64) NOT NULL,
  sanitized_arguments jsonb NOT NULL DEFAULT '{}'::jsonb,
  plan_hash varchar(128) NOT NULL,
  context_hash varchar(128) NOT NULL,
  permission_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  policy_version varchar(64) NOT NULL,
  risk_level varchar(32) NOT NULL,
  affected_entities jsonb NOT NULL DEFAULT '[]'::jsonb,
  expected_fingerprints jsonb NOT NULL DEFAULT '[]'::jsonb,
  preview jsonb NOT NULL DEFAULT '{}'::jsonb,
  side_effects jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','resolving','awaiting_input','preview_ready','awaiting_confirmation','confirmed','revalidating','executing','succeeded','partially_failed','failed','cancelled','expired','invalidated')),
  plan_version integer NOT NULL DEFAULT 1,
  environment varchar(64) NOT NULL,
  failure_summary varchar(1000),
  partial_failure jsonb,
  undo_metadata jsonb,
  correlation_id varchar(128) NOT NULL,
  expires_at timestamptz NOT NULL,
  confirmed_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  failed_at timestamptz,
  cancelled_at timestamptz,
  expired_at timestamptz,
  invalidated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_execution_plans_org_user_created_idx ON ai_execution_plans(org_id, user_id, created_at);
CREATE INDEX IF NOT EXISTS ai_execution_plans_org_conversation_created_idx ON ai_execution_plans(org_id, conversation_id, created_at);
CREATE INDEX IF NOT EXISTS ai_execution_plans_org_status_expires_idx ON ai_execution_plans(org_id, status, expires_at);
CREATE INDEX IF NOT EXISTS ai_execution_plans_correlation_id_idx ON ai_execution_plans(correlation_id);

CREATE TABLE IF NOT EXISTS ai_confirmations (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id varchar NOT NULL REFERENCES ai_execution_plans(id) ON DELETE CASCADE,
  org_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id varchar NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash varchar(128) NOT NULL UNIQUE,
  status varchar(32) NOT NULL DEFAULT 'issued' CHECK (status IN ('issued','confirmed','used','revoked','expired','invalidated')),
  confirmation_method varchar(64) NOT NULL DEFAULT 'dedicated_api',
  request_correlation_id varchar(128),
  expires_at timestamptz NOT NULL,
  confirmed_at timestamptz,
  used_at timestamptz,
  revoked_at timestamptz,
  invalidated_at timestamptz,
  invalidated_reason varchar(500),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_confirmations_org_user_plan_idx ON ai_confirmations(org_id, user_id, plan_id);
CREATE INDEX IF NOT EXISTS ai_confirmations_plan_expires_idx ON ai_confirmations(plan_id, expires_at);

CREATE TABLE IF NOT EXISTS ai_execution_steps (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id varchar NOT NULL REFERENCES ai_execution_plans(id) ON DELETE CASCADE,
  org_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  sequence integer NOT NULL,
  command_name varchar(120) NOT NULL,
  command_version varchar(64) NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','succeeded','failed','skipped','blocked')),
  sanitized_input jsonb NOT NULL DEFAULT '{}'::jsonb,
  result_summary jsonb,
  error_code varchar(120),
  domain_audit_references jsonb NOT NULL DEFAULT '[]'::jsonb,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(plan_id, sequence)
);
CREATE INDEX IF NOT EXISTS ai_execution_steps_org_plan_status_idx ON ai_execution_steps(org_id, plan_id, status);

CREATE TABLE IF NOT EXISTS ai_idempotency_records (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  actor_user_id varchar NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  command_name varchar(120) NOT NULL,
  command_version varchar(64) NOT NULL,
  idempotency_key varchar(160) NOT NULL,
  plan_id varchar NOT NULL REFERENCES ai_execution_plans(id) ON DELETE CASCADE,
  request_hash varchar(128) NOT NULL,
  status text NOT NULL DEFAULT 'locked' CHECK (status IN ('locked','completed','failed','unknown','expired')),
  result_reference varchar(128),
  result_summary jsonb,
  error_reference varchar(128),
  locked_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(org_id, actor_user_id, command_name, command_version, idempotency_key)
);
CREATE INDEX IF NOT EXISTS ai_idempotency_records_org_plan_idx ON ai_idempotency_records(org_id, plan_id);
CREATE INDEX IF NOT EXISTS ai_idempotency_records_status_expiry_idx ON ai_idempotency_records(status, expires_at);

COMMENT ON TABLE ai_execution_plans IS 'Server-authoritative assistant write plans. Stage 3 registers no production commands.';
COMMENT ON COLUMN ai_confirmations.token_hash IS 'SHA-256 hash only; raw confirmation tokens are never persisted.';
