CREATE TABLE IF NOT EXISTS production_alert_presets (
  id varchar PRIMARY KEY DEFAULT (gen_random_uuid()::text),
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE cascade,
  name varchar(120) NOT NULL,
  title varchar(160) NOT NULL,
  message text,
  alert_type varchar(40) NOT NULL DEFAULT 'general_warning',
  severity varchar(20) NOT NULL DEFAULT 'warning',
  visible_stations jsonb NOT NULL DEFAULT '["all"]'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_by_user_id varchar REFERENCES users(id) ON DELETE set null,
  metadata_json jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT production_alert_presets_name_not_blank CHECK (length(trim(name)) > 0),
  CONSTRAINT production_alert_presets_title_not_blank CHECK (length(trim(title)) > 0),
  CONSTRAINT production_alert_presets_alert_type_chk CHECK (
    alert_type IN (
      'color_match',
      'pms_match',
      'customer_specific',
      'machine_setting',
      'finishing_instruction',
      'registration_instruction',
      'general_warning'
    )
  ),
  CONSTRAINT production_alert_presets_severity_chk CHECK (severity IN ('info', 'warning', 'critical')),
  CONSTRAINT production_alert_presets_visible_stations_array_chk CHECK (jsonb_typeof(visible_stations) = 'array')
);

CREATE UNIQUE INDEX IF NOT EXISTS production_alert_presets_org_name_uidx
  ON production_alert_presets (organization_id, name);

CREATE INDEX IF NOT EXISTS production_alert_presets_org_active_sort_idx
  ON production_alert_presets (organization_id, is_active, sort_order);
