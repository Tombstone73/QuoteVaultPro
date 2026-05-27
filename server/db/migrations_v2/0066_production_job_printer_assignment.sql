-- Migration 0066: Production job printer / machine assignment
--
-- Records the actual machine selected by the production operator. This is
-- intentionally on production_jobs so completed jobs retain machine history.

ALTER TABLE production_jobs
  ADD COLUMN IF NOT EXISTS assigned_printer_id varchar(120),
  ADD COLUMN IF NOT EXISTS assigned_printer_name varchar(120),
  ADD COLUMN IF NOT EXISTS assigned_printer_by_user_id varchar,
  ADD COLUMN IF NOT EXISTS assigned_printer_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'production_jobs_assigned_printer_by_user_id_users_id_fk'
  ) THEN
    ALTER TABLE production_jobs
      ADD CONSTRAINT production_jobs_assigned_printer_by_user_id_users_id_fk
      FOREIGN KEY (assigned_printer_by_user_id) REFERENCES users(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS production_jobs_assigned_printer_idx
  ON production_jobs (organization_id, assigned_printer_name);
