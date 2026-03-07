-- Migration 0003: Active job uniqueness constraint
-- Ensures at most one non-terminal production_job per line_item per organization.
-- Terminal statuses (done, void, canceled, cancelled) are excluded so historical
-- audit rows never block new job creation.

-- 1. Partial unique index: only one active (non-terminal) job per line item
CREATE UNIQUE INDEX IF NOT EXISTS uq_active_job_per_line_item
  ON production_jobs (organization_id, line_item_id)
  WHERE status NOT IN ('done', 'void', 'canceled', 'cancelled');

-- 2. Backfill: close any duplicate active jobs that violate the constraint.
--    Keep the most recently updated row active; mark older duplicates as 'done'.
--    This is idempotent — safe to run multiple times.
DO $$
DECLARE
  _dup RECORD;
  _closed INT := 0;
BEGIN
  FOR _dup IN
    SELECT id
    FROM (
      SELECT id,
             ROW_NUMBER() OVER (
               PARTITION BY organization_id, line_item_id
               ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST
             ) AS rn
      FROM production_jobs
      WHERE status NOT IN ('done', 'void', 'canceled', 'cancelled')
        AND line_item_id IS NOT NULL
    ) sub
    WHERE sub.rn > 1
  LOOP
    UPDATE production_jobs
       SET status = 'done',
           updated_at = NOW()
     WHERE id = _dup.id;
    _closed := _closed + 1;
  END LOOP;
  IF _closed > 0 THEN
    RAISE NOTICE '[0003] Closed % duplicate active production jobs', _closed;
  END IF;
END $$;
