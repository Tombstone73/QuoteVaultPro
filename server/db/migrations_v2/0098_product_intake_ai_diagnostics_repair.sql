ALTER TABLE product_intake_ai_diagnostics
  ADD COLUMN IF NOT EXISTS session_id varchar REFERENCES product_intake_sessions(id) ON DELETE CASCADE;

ALTER TABLE product_intake_ai_diagnostics
  ADD COLUMN IF NOT EXISTS source_fingerprint text;

ALTER TABLE product_intake_ai_diagnostics
  ADD COLUMN IF NOT EXISTS repair_actions jsonb NOT NULL DEFAULT '[]'::jsonb;

CREATE INDEX IF NOT EXISTS product_intake_ai_diagnostics_session_idx
  ON product_intake_ai_diagnostics (session_id);

CREATE INDEX IF NOT EXISTS product_intake_ai_diagnostics_fingerprint_idx
  ON product_intake_ai_diagnostics (source_fingerprint);
