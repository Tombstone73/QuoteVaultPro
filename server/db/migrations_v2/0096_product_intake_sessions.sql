CREATE TABLE IF NOT EXISTS product_intake_sessions (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  source_type text NOT NULL,
  source_json jsonb,
  source_text text,
  source_fingerprint text,
  ai_brief_json jsonb NOT NULL,
  confidence_json jsonb,
  missing_decisions_json jsonb,
  status text NOT NULL DEFAULT 'analyzed',
  created_product_id varchar REFERENCES products(id) ON DELETE SET NULL,
  created_pbv2_tree_version_id varchar REFERENCES pbv2_tree_versions(id) ON DELETE SET NULL,
  created_by_user_id varchar REFERENCES users(id) ON DELETE SET NULL,
  updated_by_user_id varchar REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  abandoned_at timestamp with time zone,
  CONSTRAINT product_intake_sessions_source_type_check
    CHECK (source_type IN ('json_upload', 'json_paste', 'text_description')),
  CONSTRAINT product_intake_sessions_status_check
    CHECK (status IN ('analyzed', 'needs_answers', 'ready_for_draft', 'draft_created', 'abandoned'))
);

CREATE INDEX IF NOT EXISTS product_intake_sessions_org_status_idx
  ON product_intake_sessions (organization_id, status);

CREATE INDEX IF NOT EXISTS product_intake_sessions_org_created_idx
  ON product_intake_sessions (organization_id, created_at);

CREATE INDEX IF NOT EXISTS product_intake_sessions_source_fingerprint_idx
  ON product_intake_sessions (source_fingerprint);

CREATE INDEX IF NOT EXISTS product_intake_sessions_created_product_idx
  ON product_intake_sessions (created_product_id);

CREATE INDEX IF NOT EXISTS product_intake_sessions_created_pbv2_tree_idx
  ON product_intake_sessions (created_pbv2_tree_version_id);

CREATE TABLE IF NOT EXISTS product_intake_questions (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  session_id varchar NOT NULL REFERENCES product_intake_sessions(id) ON DELETE CASCADE,
  question_key text NOT NULL,
  question_type text NOT NULL,
  label text NOT NULL,
  help_text text,
  required boolean NOT NULL DEFAULT false,
  options_json jsonb,
  default_value_json jsonb,
  source_path text,
  confidence numeric(5, 2),
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT product_intake_questions_type_check
    CHECK (question_type IN ('select', 'multiselect', 'text', 'number', 'boolean'))
);

CREATE INDEX IF NOT EXISTS product_intake_questions_session_idx
  ON product_intake_questions (session_id);

CREATE INDEX IF NOT EXISTS product_intake_questions_org_session_idx
  ON product_intake_questions (organization_id, session_id);

CREATE UNIQUE INDEX IF NOT EXISTS product_intake_questions_session_key_uidx
  ON product_intake_questions (session_id, question_key);

CREATE TABLE IF NOT EXISTS product_intake_answers (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  session_id varchar NOT NULL REFERENCES product_intake_sessions(id) ON DELETE CASCADE,
  question_id varchar NOT NULL REFERENCES product_intake_questions(id) ON DELETE CASCADE,
  question_key text NOT NULL,
  answer_json jsonb,
  answered_by_user_id varchar REFERENCES users(id) ON DELETE SET NULL,
  answered_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS product_intake_answers_session_idx
  ON product_intake_answers (session_id);

CREATE INDEX IF NOT EXISTS product_intake_answers_question_idx
  ON product_intake_answers (question_id);

CREATE UNIQUE INDEX IF NOT EXISTS product_intake_answers_session_key_uidx
  ON product_intake_answers (session_id, question_key);
