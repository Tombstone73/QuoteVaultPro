-- Reconciliation migration for databases that deployed the DEV AI stream
-- before MAIN's production-run file-strategy migration.  The original 0162
-- migration remains immutable; this idempotently supplies its schema change
-- after the combined journal's higher DEV migration timestamps.
ALTER TABLE "production_runs"
  ADD COLUMN IF NOT EXISTS "production_file_strategy" varchar(32) NOT NULL DEFAULT 'staff_prepared';
