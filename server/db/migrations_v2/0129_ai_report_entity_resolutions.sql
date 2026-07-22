-- Stage 8.2: server-authoritative pause state for ambiguous analytical
-- customer resolution. Candidate rows are opaque to the browser and contain
-- no executable query text or provider payloads.
CREATE TABLE IF NOT EXISTS ai_report_entity_resolutions (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id varchar NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  conversation_id varchar NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
  source_turn_id varchar NOT NULL REFERENCES ai_turns(id) ON DELETE CASCADE,
  source_message_id varchar REFERENCES ai_messages(id) ON DELETE SET NULL,
  context_snapshot_id varchar REFERENCES ai_context_snapshots(id) ON DELETE SET NULL,
  resolver_version varchar(64) NOT NULL,
  analytical_plan_version varchar(64) NOT NULL,
  original_user_request text NOT NULL,
  unresolved_customer_reference text NOT NULL,
  validated_plan_json jsonb NOT NULL,
  original_context_json jsonb NOT NULL,
  candidate_set_json jsonb NOT NULL,
  selected_candidate_id varchar(128),
  selected_company_id varchar,
  status text NOT NULL DEFAULT 'awaiting_entity_resolution'
    CHECK (status IN ('awaiting_entity_resolution','resolved','resuming','resumed','expired','cancelled','failed')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resumed_at timestamptz,
  cancelled_at timestamptz,
  failed_at timestamptz,
  failure_code varchar(120),
  continuation_result_reference varchar(128),
  continuation_result_json jsonb,
  CHECK ((selected_candidate_id IS NULL) = (selected_company_id IS NULL))
);

CREATE INDEX IF NOT EXISTS ai_report_entity_resolutions_expiry_idx
  ON ai_report_entity_resolutions(expires_at);
CREATE INDEX IF NOT EXISTS ai_report_entity_resolutions_active_lookup_idx
  ON ai_report_entity_resolutions(organization_id, user_id, conversation_id, expires_at)
  WHERE status = 'awaiting_entity_resolution';
CREATE INDEX IF NOT EXISTS ai_report_entity_resolutions_source_turn_idx
  ON ai_report_entity_resolutions(source_turn_id);

COMMENT ON TABLE ai_report_entity_resolutions IS
  'Stage 8.2 immutable analytical customer candidates and persisted continuation state; no raw provider payloads or executable plans.';
COMMENT ON COLUMN ai_report_entity_resolutions.candidate_set_json IS
  'Immutable server-only candidate set. Browser receives opaque candidate identifiers only.';
