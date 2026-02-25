-- Migration 0058: Real Stations table
-- Creates the stations table, seeds default stations for every existing org,
-- adds nullable station_id FK column to production_jobs, and backfills it
-- from the existing station_key column.
-- station_key is NOT dropped (non-breaking).

-- ============================================================
-- 1. Create stations table
-- ============================================================
CREATE TABLE IF NOT EXISTS stations (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  varchar     NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  key              varchar(50) NOT NULL,
  name             varchar(100) NOT NULL,
  sort             integer     NOT NULL DEFAULT 0,
  active           boolean     NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, key)
);

-- ============================================================
-- 2. Seed default stations for every existing organization
-- ============================================================
INSERT INTO stations (organization_id, key, name, sort, active)
SELECT o.id, s.key, s.name, s.sort, s.active
FROM organizations o
CROSS JOIN (
  VALUES
    ('prepress',    'Prepress',    10, true),
    ('roll',        'Roll',        20, true),
    ('flatbed',     'Flatbed',     30, true),
    ('finishing',   'Finishing',   40, false),
    ('fabrication', 'Fabrication', 50, false),
    ('design',      'Design',      60, false),
    ('lamination',  'Lamination',  70, false),
    ('cnc',         'CNC',         80, false)
) AS s(key, name, sort, active)
ON CONFLICT (organization_id, key) DO NOTHING;

-- ============================================================
-- 3. Add nullable station_id column to production_jobs
-- ============================================================
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'production_jobs'
      AND column_name  = 'station_id'
  ) THEN
    ALTER TABLE production_jobs ADD COLUMN station_id uuid;
  END IF;
END $$;

-- ============================================================
-- 4. Backfill station_id from station_key + organization_id
-- ============================================================
UPDATE production_jobs pj
SET    station_id = s.id
FROM   stations s
WHERE  s.organization_id = pj.organization_id
  AND  s.key             = pj.station_key
  AND  pj.station_id IS NULL;

-- ============================================================
-- 5. Foreign key: production_jobs.station_id → stations.id
-- ============================================================
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_schema = 'public'
      AND table_name        = 'production_jobs'
      AND constraint_name   = 'production_jobs_station_id_fkey'
  ) THEN
    ALTER TABLE production_jobs
      ADD CONSTRAINT production_jobs_station_id_fkey
      FOREIGN KEY (station_id) REFERENCES stations(id) ON DELETE RESTRICT;
  END IF;
END $$;

-- ============================================================
-- 6. Index on (organization_id, station_id) for query performance
-- ============================================================
CREATE INDEX IF NOT EXISTS production_jobs_org_station_id_idx
  ON production_jobs (organization_id, station_id);
