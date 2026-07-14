CREATE TABLE IF NOT EXISTS printer_profiles (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  display_name varchar(160) NOT NULL,
  printer_type varchar(40) NOT NULL,
  intended_use varchar(80) NOT NULL DEFAULT 'production_ticket',
  station_route varchar(120),
  scope varchar(40) NOT NULL DEFAULT 'organization',
  is_active boolean NOT NULL DEFAULT true,
  is_default boolean NOT NULL DEFAULT false,
  last_used_at timestamptz,
  created_by_user_id varchar REFERENCES users(id) ON DELETE SET NULL,
  updated_by_user_id varchar REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

--> statement-breakpoint

CREATE INDEX IF NOT EXISTS printer_profiles_org_idx
  ON printer_profiles(organization_id);

--> statement-breakpoint

CREATE INDEX IF NOT EXISTS printer_profiles_org_active_idx
  ON printer_profiles(organization_id, is_active);

--> statement-breakpoint

CREATE INDEX IF NOT EXISTS printer_profiles_org_type_idx
  ON printer_profiles(organization_id, printer_type);

--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS printer_profiles_org_default_use_uidx
  ON printer_profiles(organization_id, intended_use)
  WHERE is_default = true AND is_active = true;
