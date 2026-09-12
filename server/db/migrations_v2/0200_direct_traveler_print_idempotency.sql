-- A retry of one browser action must resolve to its original Traveler job.
-- Existing rows predate request keys, so their immutable job ids are safe
-- backfill values before making the key mandatory.
ALTER TABLE direct_print_jobs
  ADD COLUMN IF NOT EXISTS request_key varchar(160);

UPDATE direct_print_jobs
SET request_key = id
WHERE request_key IS NULL;

ALTER TABLE direct_print_jobs
  ALTER COLUMN request_key SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS direct_print_jobs_org_request_key_uidx
  ON direct_print_jobs (organization_id, request_key);
