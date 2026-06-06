CREATE TABLE IF NOT EXISTS product_intake_ai_diagnostics (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  session_id varchar REFERENCES product_intake_sessions(id) ON DELETE CASCADE,
  source_type text NOT NULL,
  source_fingerprint text,
  provider text,
  model text,
  raw_ai_response text NOT NULL,
  validation_errors jsonb NOT NULL DEFAULT '[]'::jsonb,
  failed_schema_paths jsonb NOT NULL DEFAULT '[]'::jsonb,
  repair_actions jsonb NOT NULL DEFAULT '[]'::jsonb,
  prompt_version text,
  created_by_user_id varchar REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT product_intake_ai_diagnostics_source_type_check
    CHECK (source_type IN ('uploaded_json', 'pasted_json', 'text_description'))
);

CREATE INDEX IF NOT EXISTS product_intake_ai_diagnostics_org_created_idx
  ON product_intake_ai_diagnostics (organization_id, created_at);

CREATE INDEX IF NOT EXISTS product_intake_ai_diagnostics_org_source_idx
  ON product_intake_ai_diagnostics (organization_id, source_type);

CREATE INDEX IF NOT EXISTS product_intake_ai_diagnostics_session_idx
  ON product_intake_ai_diagnostics (session_id);

CREATE INDEX IF NOT EXISTS product_intake_ai_diagnostics_fingerprint_idx
  ON product_intake_ai_diagnostics (source_fingerprint);
