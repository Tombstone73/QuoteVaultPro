-- M7.6A: durable V2 assistant evidence only.  Business entities remain owned
-- by their canonical application services; the assistant never receives SQL.
CREATE TABLE IF NOT EXISTS v2_ai_conversations (
  id uuid PRIMARY KEY,
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  user_id varchar NOT NULL,
  title varchar(160),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS v2_ai_conversations_owner_idx ON v2_ai_conversations (organization_id, user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS v2_ai_conversation_messages (
  id uuid PRIMARY KEY,
  conversation_id uuid NOT NULL REFERENCES v2_ai_conversations(id) ON DELETE RESTRICT,
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  user_id varchar NOT NULL,
  role varchar(16) NOT NULL CHECK (role IN ('user', 'assistant', 'tool', 'system')),
  content text NOT NULL CHECK (char_length(content) <= 16000),
  tool_name varchar(160),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS v2_ai_conversation_messages_owner_idx ON v2_ai_conversation_messages (organization_id, user_id, conversation_id, created_at);

CREATE TABLE IF NOT EXISTS v2_ai_pending_commands (
  id uuid PRIMARY KEY,
  conversation_id uuid NOT NULL REFERENCES v2_ai_conversations(id) ON DELETE RESTRICT,
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  user_id varchar NOT NULL,
  command_name varchar(160) NOT NULL,
  capability varchar(160) NOT NULL,
  normalized_input jsonb NOT NULL,
  proposal text NOT NULL CHECK (char_length(proposal) <= 16000),
  proposal_fingerprint varchar(80) NOT NULL,
  business_request_id varchar(256) NOT NULL,
  state varchar(32) NOT NULL CHECK (state IN ('pending_confirmation', 'confirmed', 'executing', 'succeeded', 'failed', 'expired', 'cancelled')),
  expires_at timestamptz NOT NULL,
  result jsonb,
  failure_code varchar(128),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, business_request_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS v2_ai_pending_commands_one_active_idx
  ON v2_ai_pending_commands (organization_id, user_id, conversation_id)
  WHERE state IN ('pending_confirmation', 'confirmed', 'executing');
CREATE INDEX IF NOT EXISTS v2_ai_pending_commands_lookup_idx
  ON v2_ai_pending_commands (organization_id, user_id, conversation_id, created_at DESC);

CREATE TABLE IF NOT EXISTS v2_ai_tool_audit (
  id uuid PRIMARY KEY,
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  user_id varchar NOT NULL,
  conversation_id uuid NOT NULL REFERENCES v2_ai_conversations(id) ON DELETE RESTRICT,
  pending_command_id uuid REFERENCES v2_ai_pending_commands(id) ON DELETE RESTRICT,
  event_type varchar(80) NOT NULL,
  tool_name varchar(160),
  capability varchar(160),
  result varchar(16) NOT NULL CHECK (result IN ('succeeded', 'failed', 'denied')),
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS v2_ai_tool_audit_owner_idx ON v2_ai_tool_audit (organization_id, user_id, conversation_id, created_at DESC);

CREATE OR REPLACE FUNCTION v2_ai_history_immutable_validate()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'V2 AI audit history is immutable';
END;
$$;
DROP TRIGGER IF EXISTS v2_ai_tool_audit_immutable ON v2_ai_tool_audit;
CREATE TRIGGER v2_ai_tool_audit_immutable BEFORE UPDATE OR DELETE ON v2_ai_tool_audit
FOR EACH ROW EXECUTE FUNCTION v2_ai_history_immutable_validate();
