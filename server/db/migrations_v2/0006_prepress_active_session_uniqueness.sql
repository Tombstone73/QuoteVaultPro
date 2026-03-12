-- Migration 0006: Prepress active session uniqueness
-- Ensures at most one ACTIVE prepress session exists per line item per organization.
-- Historical completed sessions remain allowed.

-- 1. Backfill: close duplicate active sessions before adding the unique partial index.
--    Keep the most recently started/updated session active.
DO $$
DECLARE
  _closed_count integer := 0;
BEGIN
  WITH ranked_active_sessions AS (
    SELECT
      id,
      row_number() OVER (
        PARTITION BY organization_id, line_item_id
        ORDER BY started_at DESC NULLS LAST, updated_at DESC NULLS LAST, id DESC
      ) AS rn
    FROM prepress_sessions
    WHERE status = 'active'
  ), sessions_to_close AS (
    SELECT id
    FROM ranked_active_sessions
    WHERE rn > 1
  )
  UPDATE prepress_sessions
  SET
    status = 'complete',
    completed_at = COALESCE(prepress_sessions.completed_at, prepress_sessions.updated_at, prepress_sessions.started_at, NOW()),
    updated_at = NOW()
  WHERE prepress_sessions.id IN (SELECT id FROM sessions_to_close);

  GET DIAGNOSTICS _closed_count = ROW_COUNT;

  IF _closed_count > 0 THEN
    RAISE NOTICE '[0006] Closed % duplicate active prepress sessions before adding uniqueness constraint', _closed_count;
  END IF;
END $$;

-- 2. Enforce one active session per line item per organization.
CREATE UNIQUE INDEX IF NOT EXISTS uq_prepress_active_session_per_line_item
  ON prepress_sessions (organization_id, line_item_id)
  WHERE status = 'active';
