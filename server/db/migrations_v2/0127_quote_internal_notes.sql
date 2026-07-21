-- Canonical internal-only quote note ledger. No portal, email, PDF, export,
-- or generic quote response is wired to this table by this migration.
CREATE TABLE IF NOT EXISTS quote_internal_notes (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  quote_id varchar NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  note_text text NOT NULL,
  source varchar(32) NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'assistant')),
  created_by_user_id varchar REFERENCES users(id) ON DELETE SET NULL,
  assistant_conversation_id varchar REFERENCES ai_conversations(id) ON DELETE SET NULL,
  assistant_plan_id varchar REFERENCES ai_execution_plans(id) ON DELETE SET NULL,
  assistant_execution_id varchar,
  domain_audit_id varchar REFERENCES audit_logs(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS quote_internal_notes_org_quote_created_idx
  ON quote_internal_notes(organization_id, quote_id, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS quote_internal_notes_assistant_plan_unique
  ON quote_internal_notes(assistant_plan_id) WHERE assistant_plan_id IS NOT NULL;
