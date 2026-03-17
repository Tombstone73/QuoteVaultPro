-- Migration 0014: Line item workflow truth cleanup
-- Fix: restructured as UPDATE ... FROM (subquery) to avoid the PostgreSQL
-- restriction that prevents referencing the UPDATE target alias (oli)
-- inside a FROM-clause JOIN ON condition.
WITH active_jobs AS (
  SELECT DISTINCT ON (pj.organization_id, pj.line_item_id)
    pj.organization_id,
    pj.line_item_id,
    lower(coalesce(pj.station_key, '')) AS station_key,
    lower(coalesce(pj.step_key, '')) AS step_key
  FROM production_jobs pj
  WHERE lower(coalesce(pj.status, '')) NOT IN ('done', 'void', 'canceled', 'cancelled')
    AND pj.line_item_id IS NOT NULL
  ORDER BY pj.organization_id, pj.line_item_id, pj.updated_at DESC, pj.created_at DESC
)
UPDATE order_line_items
SET
  status        = updates.new_status,
  workflow_state = updates.new_workflow_state,
  updated_at    = now()
FROM (
  SELECT
    oli.id,
    CASE
      WHEN lower(coalesce(oli.status, '')) IN ('canceled', 'cancelled') THEN 'canceled'
      WHEN lower(coalesce(oli.status, '')) IN ('complete', 'completed', 'done') THEN 'complete'
      WHEN lower(coalesce(oli.status, '')) IN ('queued', 'pending_prepress') THEN 'new'
      WHEN lower(coalesce(oli.status, '')) IN ('in_prepress', 'prepress_complete', 'print_ready', 'printing', 'finishing') THEN 'in_production'
      WHEN lower(coalesce(oli.status, '')) IN ('new', 'in_production', 'complete', 'canceled') THEN lower(coalesce(oli.status, ''))
      ELSE CASE
        WHEN lower(coalesce(oli.workflow_state, '')) IN ('in_design', 'in_prepress', 'ready_for_production', 'in_production', 'on_hold') THEN 'in_production'
        WHEN lower(coalesce(oli.workflow_state, '')) = 'completed' THEN 'complete'
        WHEN lower(coalesce(oli.workflow_state, '')) = 'canceled' THEN 'canceled'
        ELSE 'new'
      END
    END AS new_status,
    CASE
      WHEN lower(coalesce(oli.status, '')) IN ('canceled', 'cancelled') THEN 'canceled'
      WHEN lower(coalesce(oli.status, '')) IN ('complete', 'completed', 'done') THEN 'completed'
      WHEN aj.station_key = 'design' OR aj.step_key = 'design' THEN 'in_design'
      WHEN aj.station_key = 'prepress' OR aj.step_key = 'prepress' THEN 'in_prepress'
      WHEN aj.line_item_id IS NOT NULL THEN 'in_production'
      WHEN lower(coalesce(oli.workflow_state, '')) IN (
        'new',
        'needs_design',
        'in_design',
        'ready_for_prepress',
        'in_prepress',
        'ready_for_production',
        'in_production',
        'completed',
        'on_hold',
        'canceled'
      ) THEN lower(oli.workflow_state)
      WHEN coalesce(oli.requires_design, false) = true THEN 'needs_design'
      WHEN coalesce(oli.requires_prepress, true) = true THEN 'ready_for_prepress'
      ELSE 'ready_for_production'
    END AS new_workflow_state
  FROM order_line_items oli
  JOIN orders o ON o.id = oli.order_id
  LEFT JOIN active_jobs aj
    ON aj.organization_id = o.organization_id
   AND aj.line_item_id = oli.id
  WHERE
    lower(coalesce(oli.status, '')) IN ('queued', 'pending_prepress', 'in_prepress', 'prepress_complete', 'print_ready', 'printing', 'finishing', 'done', 'completed', 'cancelled')
    OR coalesce(oli.workflow_state, '') = ''
    OR oli.workflow_state IS NULL
) updates
WHERE order_line_items.id = updates.id;
