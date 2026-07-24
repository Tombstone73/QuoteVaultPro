-- Stage 9: durable, non-executable System Guide knowledge corpus.
-- Global documents have a NULL organization_id. Tenant supplemental documents
-- are always selected with an explicit organization predicate in the repository.

CREATE TABLE IF NOT EXISTS ai_knowledge_documents (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id varchar REFERENCES organizations(id) ON DELETE CASCADE,
  slug varchar(180) NOT NULL,
  title varchar(240) NOT NULL,
  category varchar(80) NOT NULL,
  summary text,
  source_type varchar(64) NOT NULL,
  source_path varchar(500),
  source_version varchar(80) NOT NULL,
  content_hash varchar(128) NOT NULL,
  content text NOT NULL,
  status varchar(32) NOT NULL DEFAULT 'active',
  audience varchar(32) NOT NULL DEFAULT 'staff',
  permission_tags jsonb NOT NULL DEFAULT '[]'::jsonb,
  route_patterns jsonb NOT NULL DEFAULT '[]'::jsonb,
  entity_types jsonb NOT NULL DEFAULT '[]'::jsonb,
  feature_tags jsonb NOT NULL DEFAULT '[]'::jsonb,
  effective_from timestamptz,
  deprecated_at timestamptz,
  replaced_by_document_id varchar REFERENCES ai_knowledge_documents(id) ON DELETE SET NULL,
  indexed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_knowledge_documents_status_check
    CHECK (status IN ('draft', 'active', 'deprecated', 'inactive')),
  CONSTRAINT ai_knowledge_documents_audience_check
    CHECK (audience IN ('staff', 'owner_admin', 'customer_safe')),
  CONSTRAINT ai_knowledge_documents_deprecated_state_check
    CHECK (deprecated_at IS NULL OR status = 'deprecated')
);

-- PostgreSQL considers NULL values distinct in ordinary unique constraints,
-- so coalesce the global scope explicitly to prevent duplicate global versions.
CREATE UNIQUE INDEX IF NOT EXISTS ai_knowledge_documents_scope_slug_version_uidx
  ON ai_knowledge_documents ((COALESCE(organization_id, '')), slug, source_version);
CREATE INDEX IF NOT EXISTS ai_knowledge_documents_scope_status_category_idx
  ON ai_knowledge_documents (organization_id, status, category, updated_at DESC);
CREATE INDEX IF NOT EXISTS ai_knowledge_documents_source_path_idx
  ON ai_knowledge_documents (source_type, source_path);

CREATE TABLE IF NOT EXISTS ai_knowledge_chunks (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id varchar NOT NULL REFERENCES ai_knowledge_documents(id) ON DELETE CASCADE,
  chunk_index integer NOT NULL,
  heading_path text,
  content text NOT NULL,
  content_hash varchar(128) NOT NULL,
  token_estimate integer NOT NULL DEFAULT 0,
  embedding_model varchar(160),
  embedding_version varchar(80),
  search_vector tsvector GENERATED ALWAYS AS (
    to_tsvector('english', coalesce(heading_path, '') || ' ' || content)
  ) STORED,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_knowledge_chunks_index_check CHECK (chunk_index >= 0),
  CONSTRAINT ai_knowledge_chunks_token_estimate_check CHECK (token_estimate >= 0),
  CONSTRAINT ai_knowledge_chunks_document_index_uidx UNIQUE (document_id, chunk_index)
);
CREATE INDEX IF NOT EXISTS ai_knowledge_chunks_search_idx
  ON ai_knowledge_chunks USING GIN (search_vector);
CREATE INDEX IF NOT EXISTS ai_knowledge_chunks_document_idx
  ON ai_knowledge_chunks (document_id, chunk_index);

CREATE TABLE IF NOT EXISTS ai_knowledge_sync_runs (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id varchar REFERENCES organizations(id) ON DELETE CASCADE,
  actor_user_id varchar REFERENCES users(id) ON DELETE SET NULL,
  source_type varchar(64) NOT NULL,
  status varchar(32) NOT NULL DEFAULT 'running',
  dry_run boolean NOT NULL DEFAULT false,
  source_version varchar(80),
  documents_discovered integer NOT NULL DEFAULT 0,
  documents_created integer NOT NULL DEFAULT 0,
  documents_updated integer NOT NULL DEFAULT 0,
  documents_deprecated integer NOT NULL DEFAULT 0,
  chunks_written integer NOT NULL DEFAULT 0,
  error_summary varchar(1000),
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_knowledge_sync_runs_status_check
    CHECK (status IN ('running', 'succeeded', 'failed', 'cancelled'))
);
CREATE INDEX IF NOT EXISTS ai_knowledge_sync_runs_scope_started_idx
  ON ai_knowledge_sync_runs (organization_id, started_at DESC);

CREATE TABLE IF NOT EXISTS ai_knowledge_feedback (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id varchar REFERENCES users(id) ON DELETE SET NULL,
  conversation_id varchar REFERENCES ai_conversations(id) ON DELETE SET NULL,
  document_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  question_category varchar(80),
  feedback_type varchar(32) NOT NULL,
  comment varchar(2000),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_knowledge_feedback_type_check
    CHECK (feedback_type IN ('helpful', 'not_helpful', 'outdated', 'incorrect'))
);
CREATE INDEX IF NOT EXISTS ai_knowledge_feedback_org_created_idx
  ON ai_knowledge_feedback (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ai_knowledge_feedback_org_type_created_idx
  ON ai_knowledge_feedback (organization_id, feedback_type, created_at DESC);

COMMENT ON TABLE ai_knowledge_documents IS
  'Versioned, non-executable System Guide content. NULL organization_id is globally curated PrintersHero knowledge.';
COMMENT ON TABLE ai_knowledge_chunks IS
  'Deterministically chunked lexical retrieval units. No raw customer records, source code, secrets, or executable content.';
