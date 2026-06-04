ALTER TABLE product_planning_ai_suggestions
  ADD COLUMN IF NOT EXISTS created_by_ai boolean NOT NULL DEFAULT true;

ALTER TABLE product_planning_ai_suggestions
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE product_planning_ai_suggestions
  ALTER COLUMN current_value TYPE text USING CASE
    WHEN current_value IS NULL THEN NULL
    ELSE current_value::text
  END;

ALTER TABLE product_planning_ai_suggestions
  ALTER COLUMN suggested_value TYPE text USING CASE
    WHEN suggested_value IS NULL THEN NULL
    ELSE suggested_value::text
  END;

CREATE INDEX IF NOT EXISTS product_planning_ai_suggestions_org_idx
  ON product_planning_ai_suggestions (organization_id);

CREATE INDEX IF NOT EXISTS product_planning_ai_suggestions_work_item_idx
  ON product_planning_ai_suggestions (work_item_id);

CREATE INDEX IF NOT EXISTS product_planning_ai_suggestions_type_idx
  ON product_planning_ai_suggestions (suggestion_type);

CREATE INDEX IF NOT EXISTS product_planning_ai_suggestions_status_idx
  ON product_planning_ai_suggestions (status);
