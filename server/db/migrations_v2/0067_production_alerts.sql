CREATE TABLE IF NOT EXISTS production_alerts (
  id varchar PRIMARY KEY DEFAULT (gen_random_uuid()::text),
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE cascade,
  order_id varchar NOT NULL REFERENCES orders(id) ON DELETE cascade,
  order_line_item_id varchar REFERENCES order_line_items(id) ON DELETE set null,
  production_job_id varchar REFERENCES production_jobs(id) ON DELETE set null,
  title varchar(160) NOT NULL,
  message text,
  alert_type varchar(40) NOT NULL DEFAULT 'general_warning',
  severity varchar(20) NOT NULL DEFAULT 'warning',
  visible_stations jsonb NOT NULL DEFAULT '["all"]'::jsonb,
  status varchar(20) NOT NULL DEFAULT 'active',
  created_by_user_id varchar REFERENCES users(id) ON DELETE set null,
  acknowledged_by_user_id varchar REFERENCES users(id) ON DELETE set null,
  acknowledged_at timestamptz,
  resolved_by_user_id varchar REFERENCES users(id) ON DELETE set null,
  resolved_at timestamptz,
  metadata_json jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT production_alerts_title_not_blank CHECK (length(trim(title)) > 0),
  CONSTRAINT production_alerts_alert_type_chk CHECK (
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
  CONSTRAINT production_alerts_severity_chk CHECK (severity IN ('info', 'warning', 'critical')),
  CONSTRAINT production_alerts_status_chk CHECK (status IN ('active', 'acknowledged', 'resolved', 'cancelled', 'archived')),
  CONSTRAINT production_alerts_visible_stations_array_chk CHECK (jsonb_typeof(visible_stations) = 'array')
);

CREATE INDEX IF NOT EXISTS production_alerts_org_status_idx
  ON production_alerts (organization_id, status);

CREATE INDEX IF NOT EXISTS production_alerts_order_id_idx
  ON production_alerts (order_id);

CREATE INDEX IF NOT EXISTS production_alerts_order_line_item_id_idx
  ON production_alerts (order_line_item_id);

CREATE INDEX IF NOT EXISTS production_alerts_production_job_id_idx
  ON production_alerts (production_job_id);

CREATE INDEX IF NOT EXISTS production_alerts_org_severity_idx
  ON production_alerts (organization_id, severity);
