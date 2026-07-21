-- Migration 0124: internal assistant workspace persistence foundation
--
-- Stage 1 only persists tenant-scoped conversations, sanitized UI context,
-- and correlation/audit records. It does not register business tools, write
-- actions, external research, provider secrets, or document binaries.

CREATE TABLE IF NOT EXISTS ai_conversations (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id varchar NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title varchar(240) NOT NULL DEFAULT 'New conversation',
  status text NOT NULL DEFAULT 'active',
  last_message_preview varchar(240),
  last_activity_at timestamp with time zone NOT NULL DEFAULT now(),
  archived_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT ai_conversations_status_check CHECK (status IN ('active', 'archived'))
);

CREATE INDEX IF NOT EXISTS ai_conversations_org_user_activity_idx
  ON ai_conversations (org_id, user_id, last_activity_at DESC);
CREATE INDEX IF NOT EXISTS ai_conversations_org_status_activity_idx
  ON ai_conversations (org_id, status, last_activity_at DESC);

CREATE TABLE IF NOT EXISTS ai_turns (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  conversation_id varchar NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
  user_id varchar REFERENCES users(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'pending',
  client_request_id varchar(128),
  correlation_id varchar(128) NOT NULL,
  provider varchar(80),
  model varchar(160),
  mode varchar(64),
  prompt_version varchar(64),
  error_code varchar(120),
  error_message varchar(500),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  started_at timestamp with time zone,
  completed_at timestamp with time zone,
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT ai_turns_status_check CHECK (status IN ('pending', 'processing', 'responded', 'failed', 'cancelled'))
);

CREATE INDEX IF NOT EXISTS ai_turns_org_conversation_created_idx
  ON ai_turns (org_id, conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ai_turns_org_status_created_idx
  ON ai_turns (org_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS ai_turns_correlation_id_idx
  ON ai_turns (correlation_id);

CREATE TABLE IF NOT EXISTS ai_messages (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  conversation_id varchar NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
  turn_id varchar REFERENCES ai_turns(id) ON DELETE CASCADE,
  actor_user_id varchar REFERENCES users(id) ON DELETE SET NULL,
  role text NOT NULL,
  sequence integer NOT NULL,
  content text NOT NULL,
  content_format varchar(32) NOT NULL DEFAULT 'plain_text',
  structured_cards jsonb NOT NULL DEFAULT '[]'::jsonb,
  provider varchar(80),
  model varchar(160),
  correlation_id varchar(128),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT ai_messages_role_check CHECK (role IN ('user', 'assistant', 'system')),
  CONSTRAINT ai_messages_content_format_check CHECK (content_format = 'plain_text'),
  CONSTRAINT ai_messages_conversation_sequence_unique UNIQUE (conversation_id, sequence)
);

CREATE INDEX IF NOT EXISTS ai_messages_org_conversation_created_idx
  ON ai_messages (org_id, conversation_id, created_at ASC);
CREATE INDEX IF NOT EXISTS ai_messages_turn_id_idx
  ON ai_messages (turn_id);

CREATE TABLE IF NOT EXISTS ai_context_snapshots (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  conversation_id varchar NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
  turn_id varchar NOT NULL REFERENCES ai_turns(id) ON DELETE CASCADE,
  user_id varchar REFERENCES users(id) ON DELETE SET NULL,
  context_version varchar(32) NOT NULL,
  sanitized_context jsonb NOT NULL,
  context_hash varchar(128) NOT NULL,
  captured_at timestamp with time zone NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ai_context_snapshots_org_conversation_created_idx
  ON ai_context_snapshots (org_id, conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ai_context_snapshots_turn_id_idx
  ON ai_context_snapshots (turn_id);

CREATE TABLE IF NOT EXISTS ai_tool_executions (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  conversation_id varchar NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
  turn_id varchar NOT NULL REFERENCES ai_turns(id) ON DELETE CASCADE,
  tool_name varchar(120) NOT NULL,
  tool_version varchar(64) NOT NULL,
  status text NOT NULL DEFAULT 'not_run',
  redacted_arguments jsonb NOT NULL DEFAULT '{}'::jsonb,
  redacted_result jsonb,
  source_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  correlation_id varchar(128) NOT NULL,
  error_code varchar(120),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  completed_at timestamp with time zone,
  CONSTRAINT ai_tool_executions_status_check CHECK (status IN ('not_run', 'succeeded', 'failed', 'disabled'))
);

CREATE INDEX IF NOT EXISTS ai_tool_executions_org_turn_created_idx
  ON ai_tool_executions (org_id, turn_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ai_tool_executions_org_status_created_idx
  ON ai_tool_executions (org_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS ai_tool_executions_correlation_id_idx
  ON ai_tool_executions (correlation_id);

CREATE TABLE IF NOT EXISTS ai_audit_events (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  conversation_id varchar REFERENCES ai_conversations(id) ON DELETE SET NULL,
  turn_id varchar REFERENCES ai_turns(id) ON DELETE SET NULL,
  tool_execution_id varchar REFERENCES ai_tool_executions(id) ON DELETE SET NULL,
  actor_user_id varchar REFERENCES users(id) ON DELETE SET NULL,
  source_audit_log_id varchar REFERENCES audit_logs(id) ON DELETE SET NULL,
  event_type varchar(120) NOT NULL,
  status varchar(64) NOT NULL,
  input_hash varchar(128),
  correlation_id varchar(128) NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ai_audit_events_org_created_idx
  ON ai_audit_events (org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ai_audit_events_org_conversation_created_idx
  ON ai_audit_events (org_id, conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ai_audit_events_turn_id_idx
  ON ai_audit_events (turn_id);
CREATE INDEX IF NOT EXISTS ai_audit_events_correlation_id_idx
  ON ai_audit_events (correlation_id);

COMMENT ON TABLE ai_conversations IS
  'Internal assistant conversations, owned by one authenticated organization user.';
COMMENT ON TABLE ai_context_snapshots IS
  'Sanitized, versioned presentation context only; unsaved values and business payloads are excluded.';
COMMENT ON TABLE ai_tool_executions IS
  'Future tool execution telemetry. Stage 1 leaves tools disabled and records no domain action.';
COMMENT ON TABLE ai_audit_events IS
  'Assistant correlation/audit events linked to canonical audit_logs when available.';
