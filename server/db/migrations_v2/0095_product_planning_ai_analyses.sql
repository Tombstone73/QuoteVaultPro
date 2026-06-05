CREATE TABLE IF NOT EXISTS product_planning_ai_analyses (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  analysis_type text NOT NULL,
  source text NOT NULL,
  fallback_reason text,
  results jsonb NOT NULL DEFAULT '{}'::jsonb,
  generated_by_user_id varchar REFERENCES users(id) ON DELETE SET NULL,
  generated_at timestamp with time zone NOT NULL DEFAULT now(),
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS product_planning_ai_analyses_org_type_generated_idx
  ON product_planning_ai_analyses (organization_id, analysis_type, generated_at);

CREATE INDEX IF NOT EXISTS product_planning_ai_analyses_org_source_idx
  ON product_planning_ai_analyses (organization_id, source);
