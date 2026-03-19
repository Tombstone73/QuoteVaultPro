CREATE TABLE IF NOT EXISTS production_station_steps (
  id varchar(36) PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  station_key varchar(50) NOT NULL,
  key varchar(80) NOT NULL,
  label varchar(200) NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  triggers jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT production_station_steps_org_station_key_unique UNIQUE (organization_id, station_key, key)
);

CREATE INDEX IF NOT EXISTS production_station_steps_org_station_sort_idx
  ON production_station_steps (organization_id, station_key, sort_order);

WITH raw_steps AS (
  SELECT
    o.id AS organization_id,
    trim(station_entry.key) AS station_key,
    step_entry.value AS step_value,
    step_entry.ordinality AS step_index
  FROM organizations o
  CROSS JOIN LATERAL jsonb_each(COALESCE(o.settings->'preferences'->'production'->'stationSteps', '{}'::jsonb)) AS station_entry(key, value)
  CROSS JOIN LATERAL jsonb_array_elements(station_entry.value) WITH ORDINALITY AS step_entry(value, ordinality)
), normalized_steps AS (
  SELECT
    organization_id,
    station_key,
    lower(regexp_replace(regexp_replace(trim(COALESCE(step_value->>'key', step_value->>'label', '')), '\s+', '-', 'g'), '[^a-z0-9_-]', '', 'g')) AS normalized_key,
    trim(COALESCE(step_value->>'label', step_value->>'key', '')) AS normalized_label,
    CASE
      WHEN jsonb_typeof(step_value->'active') = 'boolean' THEN (step_value->>'active')::boolean
      ELSE true
    END AS active,
    GREATEST(0, (step_index - 1) * 10) AS sort_order,
    ROW_NUMBER() OVER (
      PARTITION BY organization_id, station_key,
      lower(regexp_replace(regexp_replace(trim(COALESCE(step_value->>'key', step_value->>'label', '')), '\s+', '-', 'g'), '[^a-z0-9_-]', '', 'g'))
      ORDER BY step_index
    ) AS dedupe_rank
  FROM raw_steps
), inserted_steps AS (
  INSERT INTO production_station_steps (
    organization_id,
    station_key,
    key,
    label,
    sort_order,
    active,
    triggers
  )
  SELECT
    organization_id,
    station_key,
    normalized_key,
    normalized_label,
    sort_order,
    active,
    '[]'::jsonb
  FROM normalized_steps
  WHERE station_key <> ''
    AND normalized_key <> ''
    AND normalized_label <> ''
    AND dedupe_rank = 1
  ON CONFLICT (organization_id, station_key, key) DO NOTHING
  RETURNING 1
)
SELECT COUNT(*) FROM inserted_steps;

INSERT INTO production_station_steps (
  organization_id,
  station_key,
  key,
  label,
  sort_order,
  active,
  triggers
)
SELECT
  s.organization_id,
  s.key,
  'queued',
  'Queued',
  10,
  true,
  '[]'::jsonb
FROM stations s
LEFT JOIN production_station_steps p
  ON p.organization_id = s.organization_id
 AND p.station_key = s.key
WHERE s.active = true
  AND p.id IS NULL
ON CONFLICT (organization_id, station_key, key) DO NOTHING;

UPDATE organizations
SET settings = jsonb_set(
  settings,
  '{preferences,production}',
  COALESCE(settings->'preferences'->'production', '{}'::jsonb) - 'stationSteps',
  true
)
WHERE COALESCE(settings->'preferences'->'production', '{}'::jsonb) ? 'stationSteps';
