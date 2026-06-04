ALTER TABLE product_planning_work_items
  ADD COLUMN IF NOT EXISTS user_impact integer,
  ADD COLUMN IF NOT EXISTS revenue_impact integer,
  ADD COLUMN IF NOT EXISTS operational_impact integer,
  ADD COLUMN IF NOT EXISTS risk_reduction integer,
  ADD COLUMN IF NOT EXISTS confidence integer,
  ADD COLUMN IF NOT EXISTS priority_score integer,
  ADD COLUMN IF NOT EXISTS priority_score_explanation jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS release_id varchar;

CREATE TABLE IF NOT EXISTS product_planning_releases (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  target_date date,
  status text NOT NULL DEFAULT 'planned',
  created_by_user_id varchar REFERENCES users(id) ON DELETE SET NULL,
  updated_by_user_id varchar REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'product_planning_work_items_release_id_fkey'
  ) THEN
    ALTER TABLE product_planning_work_items
      ADD CONSTRAINT product_planning_work_items_release_id_fkey
      FOREIGN KEY (release_id) REFERENCES product_planning_releases(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS product_planning_releases_org_status_idx
  ON product_planning_releases (organization_id, status);

CREATE INDEX IF NOT EXISTS product_planning_releases_org_target_date_idx
  ON product_planning_releases (organization_id, target_date);

CREATE UNIQUE INDEX IF NOT EXISTS product_planning_releases_org_name_uidx
  ON product_planning_releases (organization_id, lower(name))
  WHERE archived_at IS NULL;

CREATE INDEX IF NOT EXISTS product_planning_work_items_org_release_idx
  ON product_planning_work_items (organization_id, release_id);

CREATE INDEX IF NOT EXISTS product_planning_work_items_org_priority_score_idx
  ON product_planning_work_items (organization_id, priority_score);

CREATE TABLE IF NOT EXISTS product_planning_dependencies (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  work_item_id varchar NOT NULL REFERENCES product_planning_work_items(id) ON DELETE CASCADE,
  depends_on_work_item_id varchar NOT NULL REFERENCES product_planning_work_items(id) ON DELETE CASCADE,
  dependency_type text NOT NULL DEFAULT 'requires',
  created_by_user_id varchar REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT product_planning_dependencies_no_self_check
    CHECK (work_item_id <> depends_on_work_item_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS product_planning_dependencies_unique_idx
  ON product_planning_dependencies (organization_id, work_item_id, depends_on_work_item_id, dependency_type);

CREATE INDEX IF NOT EXISTS product_planning_dependencies_org_work_item_idx
  ON product_planning_dependencies (organization_id, work_item_id);

CREATE INDEX IF NOT EXISTS product_planning_dependencies_org_depends_on_idx
  ON product_planning_dependencies (organization_id, depends_on_work_item_id);
