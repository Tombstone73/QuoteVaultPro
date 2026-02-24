--> statement-breakpoint
WITH ranked AS (
  SELECT id,
    ROW_NUMBER() OVER (
      PARTITION BY organization_id, line_item_id, station_id
      ORDER BY created_at ASC, id ASC
    ) AS rn
  FROM production_jobs
  WHERE station_id IS NOT NULL
)
DELETE FROM production_jobs
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

--> statement-breakpoint
DROP INDEX IF EXISTS production_jobs_org_line_item_uidx;

--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS production_jobs_org_line_item_station_unique
  ON production_jobs (organization_id, line_item_id, station_id)
  WHERE station_id IS NOT NULL;
