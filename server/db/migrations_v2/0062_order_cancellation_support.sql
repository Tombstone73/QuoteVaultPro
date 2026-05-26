-- Migration 0062: Order cancellation support
-- Allows production jobs to enter an explicit terminal canceled state.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'production_jobs_status_chk'
  ) THEN
    ALTER TABLE production_jobs DROP CONSTRAINT production_jobs_status_chk;
  END IF;
END $$;

ALTER TABLE production_jobs
  ADD CONSTRAINT production_jobs_status_chk
  CHECK (status IN ('queued', 'in_progress', 'done', 'canceled', 'void', 'cancelled'));

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'pickup_tickets_status_chk'
  ) THEN
    ALTER TABLE pickup_tickets DROP CONSTRAINT pickup_tickets_status_chk;
  END IF;
END $$;

ALTER TABLE pickup_tickets
  ADD CONSTRAINT pickup_tickets_status_chk
  CHECK (status IN ('DRAFT', 'READY_FOR_PICKUP', 'PICKED_UP', 'VOIDED'));
