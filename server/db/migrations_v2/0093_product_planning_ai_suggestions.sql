CREATE TABLE IF NOT EXISTS product_planning_ai_suggestions (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  work_item_id varchar REFERENCES product_planning_work_items(id) ON DELETE CASCADE,
  suggestion_type text NOT NULL,
  current_value jsonb,
  suggested_value jsonb,
  confidence integer,
  reasoning text,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  reviewed_by_user_id varchar REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS product_planning_ai_suggestions_org_work_item_idx
  ON product_planning_ai_suggestions (organization_id, work_item_id, status, created_at);

CREATE INDEX IF NOT EXISTS product_planning_ai_suggestions_org_type_status_idx
  ON product_planning_ai_suggestions (organization_id, suggestion_type, status, created_at);

