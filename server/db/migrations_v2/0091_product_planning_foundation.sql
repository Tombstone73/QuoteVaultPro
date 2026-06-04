-- Migration 0091: Product Planning foundation
--
-- Adds the org-scoped internal planning backlog used by developers/admins to
-- organize bug reports, feature ideas, imported backlog rows, and planning notes.
-- Existing bug reports remain the raw submission inbox.

CREATE TABLE IF NOT EXISTS product_planning_import_batches (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  filename text,
  row_count integer NOT NULL DEFAULT 0,
  imported_count integer NOT NULL DEFAULT 0,
  skipped_count integer NOT NULL DEFAULT 0,
  error_count integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending',
  created_by_user_id varchar REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS product_planning_import_batches_org_created_idx
  ON product_planning_import_batches (organization_id, created_at);

CREATE INDEX IF NOT EXISTS product_planning_import_batches_org_status_idx
  ON product_planning_import_batches (organization_id, status);

CREATE TABLE IF NOT EXISTS product_planning_work_items (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  reference text NOT NULL,
  title text NOT NULL,
  description text,
  work_item_type text NOT NULL DEFAULT 'feature',
  planning_status text NOT NULL DEFAULT 'backlog',
  priority text NOT NULL DEFAULT 'medium',
  business_value text,
  complexity text,
  phase text,
  module text,
  submodule text,
  tags text[] NOT NULL DEFAULT '{}'::text[],
  sort_order integer,
  roadmap_order integer,
  parent_id varchar REFERENCES product_planning_work_items(id) ON DELETE SET NULL,
  source_type text,
  source_bug_report_id varchar REFERENCES bug_reports(id) ON DELETE RESTRICT,
  source_reference text,
  imported_batch_id varchar REFERENCES product_planning_import_batches(id) ON DELETE SET NULL,
  requested_by text,
  owner_user_id varchar REFERENCES users(id) ON DELETE SET NULL,
  due_date date,
  release_target text,
  notes text,
  created_by_user_id varchar REFERENCES users(id) ON DELETE SET NULL,
  updated_by_user_id varchar REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  archived_at timestamp with time zone
);

CREATE UNIQUE INDEX IF NOT EXISTS product_planning_work_items_org_reference_uidx
  ON product_planning_work_items (organization_id, reference);

CREATE UNIQUE INDEX IF NOT EXISTS product_planning_work_items_org_source_bug_uidx
  ON product_planning_work_items (organization_id, source_bug_report_id)
  WHERE source_bug_report_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS product_planning_work_items_org_status_idx
  ON product_planning_work_items (organization_id, planning_status);

CREATE INDEX IF NOT EXISTS product_planning_work_items_org_priority_idx
  ON product_planning_work_items (organization_id, priority);

CREATE INDEX IF NOT EXISTS product_planning_work_items_org_type_idx
  ON product_planning_work_items (organization_id, work_item_type);

CREATE INDEX IF NOT EXISTS product_planning_work_items_org_phase_idx
  ON product_planning_work_items (organization_id, phase);

CREATE INDEX IF NOT EXISTS product_planning_work_items_source_bug_idx
  ON product_planning_work_items (source_bug_report_id);

CREATE TABLE IF NOT EXISTS product_planning_events (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  work_item_id varchar NOT NULL REFERENCES product_planning_work_items(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  message text,
  metadata jsonb,
  created_by_user_id varchar REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS product_planning_events_org_work_item_idx
  ON product_planning_events (organization_id, work_item_id, created_at);

CREATE INDEX IF NOT EXISTS product_planning_events_org_type_created_idx
  ON product_planning_events (organization_id, event_type, created_at);

COMMENT ON TABLE product_planning_work_items IS
  'Dev/admin-only Product Planning backlog. Bug Reports remain the raw submission inbox.';

COMMENT ON COLUMN product_planning_work_items.reference IS
  'Tenant-scoped Product Planning reference, generated as PP-0001, PP-0002, etc.';

COMMENT ON COLUMN product_planning_work_items.source_bug_report_id IS
  'Optional traceable link back to the original bug_reports record. Bug reports are not deleted or mutated by push.';
