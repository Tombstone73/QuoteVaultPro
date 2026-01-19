-- Production line-item intake + station routing (minimal evolution of 0028)
-- Goal: allow production work to be created per order_line_item and routed to stations.
-- Multi-tenant: all rows scoped by organization_id.

-- 1) Add line-item linkage + routing snapshot columns
ALTER TABLE production_jobs
  ADD COLUMN IF NOT EXISTS line_item_id varchar REFERENCES order_line_items(id) ON DELETE CASCADE;

ALTER TABLE production_jobs
  ADD COLUMN IF NOT EXISTS station_key varchar(40),
  ADD COLUMN IF NOT EXISTS step_key varchar(40);

-- 2) Backfill existing (order-level) jobs so station filtering works
UPDATE production_jobs
SET station_key = COALESCE(station_key, 'flatbed'),
    step_key = COALESCE(step_key, 'prepress')
WHERE station_key IS NULL OR step_key IS NULL;

-- 2b) Enforce NOT NULL + defaults (required for station boards)
ALTER TABLE production_jobs
  ALTER COLUMN station_key SET DEFAULT 'flatbed',
  ALTER COLUMN station_key SET NOT NULL,
  ALTER COLUMN step_key SET DEFAULT 'prepress',
  ALTER COLUMN step_key SET NOT NULL;

-- 3) Back-compat: keep one order-level job per (org, order)
-- NOTE: the original 0028 index was unconditional; we must make it partial so a single order can have multiple line-item jobs.
DROP INDEX IF EXISTS production_jobs_org_order_uidx;
CREATE UNIQUE INDEX IF NOT EXISTS production_jobs_org_order_uidx
  ON production_jobs (organization_id, order_id)
  WHERE line_item_id IS NULL;

-- 4) Enforce one production job per (org, line item) for line-item intake
CREATE UNIQUE INDEX IF NOT EXISTS production_jobs_org_line_item_uidx
  ON production_jobs (organization_id, line_item_id)
  WHERE line_item_id IS NOT NULL;

-- 5) Useful indexes for station boards
CREATE INDEX IF NOT EXISTS production_jobs_org_station_status_idx
  ON production_jobs (organization_id, station_key, status);

CREATE INDEX IF NOT EXISTS production_jobs_line_item_id_idx
  ON production_jobs (line_item_id);
