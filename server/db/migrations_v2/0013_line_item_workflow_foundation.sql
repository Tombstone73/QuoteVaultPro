ALTER TABLE order_line_items
  ADD COLUMN IF NOT EXISTS workflow_state VARCHAR(50) NOT NULL DEFAULT 'new';

ALTER TABLE order_line_items
  ADD COLUMN IF NOT EXISTS requires_design BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS order_line_items_workflow_state_idx
  ON order_line_items(workflow_state);

CREATE INDEX IF NOT EXISTS order_line_items_requires_design_idx
  ON order_line_items(requires_design);

WITH latest_active_job AS (
  SELECT DISTINCT ON (pj.line_item_id)
    pj.line_item_id,
    lower(coalesce(pj.station_key, '')) AS station_key,
    lower(coalesce(pj.step_key, '')) AS step_key,
    lower(coalesce(pj.status, '')) AS job_status
  FROM production_jobs pj
  WHERE pj.line_item_id IS NOT NULL
    AND lower(coalesce(pj.status, '')) NOT IN ('done', 'void', 'canceled', 'cancelled')
  ORDER BY pj.line_item_id, pj.updated_at DESC, pj.created_at DESC
),
completed_prepress AS (
  SELECT DISTINCT ps.line_item_id
  FROM prepress_sessions ps
  WHERE lower(coalesce(ps.status, '')) = 'complete'
),
workflow_backfill AS (
  SELECT
    oli.id,
    CASE
      WHEN lower(coalesce(oli.status, '')) IN ('canceled', 'cancelled') THEN 'canceled'
      WHEN lower(coalesce(oli.status, '')) IN ('complete', 'completed', 'done') THEN 'completed'
      WHEN laj.line_item_id IS NOT NULL
        AND (laj.station_key = 'design' OR laj.step_key = 'design') THEN 'in_design'
      WHEN laj.line_item_id IS NOT NULL
        AND (laj.station_key = 'prepress' OR laj.step_key = 'prepress') THEN 'in_prepress'
      WHEN laj.line_item_id IS NOT NULL THEN 'in_production'
      WHEN lower(coalesce(oli.status, '')) = 'in_prepress' THEN 'in_prepress'
      WHEN lower(coalesce(oli.status, '')) IN ('prepress_complete', 'print_ready') THEN 'ready_for_production'
      WHEN lower(coalesce(oli.status, '')) IN ('printing', 'finishing', 'in_production') THEN 'in_production'
      WHEN cp.line_item_id IS NOT NULL THEN 'ready_for_production'
      WHEN coalesce(oli.requires_design, false) = true THEN 'needs_design'
      WHEN coalesce(oli.requires_prepress, true) = true THEN 'ready_for_prepress'
      ELSE 'ready_for_production'
    END AS workflow_state,
    CASE
      WHEN lower(coalesce(oli.status, '')) IN ('canceled', 'cancelled') THEN 'canceled'
      WHEN lower(coalesce(oli.status, '')) IN ('complete', 'completed', 'done') THEN 'complete'
      WHEN laj.line_item_id IS NOT NULL THEN 'in_production'
      WHEN lower(coalesce(oli.status, '')) IN ('in_prepress', 'prepress_complete', 'print_ready', 'printing', 'finishing') THEN 'in_production'
      ELSE 'new'
    END AS lifecycle_status
  FROM order_line_items oli
  LEFT JOIN latest_active_job laj ON laj.line_item_id = oli.id
  LEFT JOIN completed_prepress cp ON cp.line_item_id = oli.id
)
UPDATE order_line_items oli
SET
  workflow_state = wb.workflow_state,
  status = wb.lifecycle_status,
  updated_at = now()
FROM workflow_backfill wb
WHERE wb.id = oli.id;

COMMENT ON COLUMN order_line_items.workflow_state IS 'Authoritative operational workflow stage. Valid values: new, needs_design, in_design, ready_for_prepress, in_prepress, ready_for_production, in_production, completed, on_hold, canceled';
COMMENT ON COLUMN order_line_items.requires_design IS 'Snapshot routing flag that determines whether a line item must enter Design before Prepress/Production';