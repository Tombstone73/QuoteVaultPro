-- Prepress Findings and Fix Logs
-- Enhances preflight with DPI detection, spot color logging, and fix audit trails
-- All records are TEMP during job execution, PERMANENT on completion

-- 1) Create enum for finding types
DO $$ BEGIN
  CREATE TYPE prepress_finding_type AS ENUM (
    'missing_dpi',
    'spot_color_detected',
    'font_not_embedded',
    'low_resolution_image',
    'rgb_colorspace',
    'transparency_detected',
    'other'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- 2) Create enum for fix types
DO $$ BEGIN
  CREATE TYPE prepress_fix_type AS ENUM (
    'rgb_to_cmyk',
    'normalize_dpi',
    'flatten_transparency',
    'embed_fonts',
    'remove_spot_color',
    'pdf_normalize',
    'other'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- 3) Create prepress_findings table
CREATE TABLE IF NOT EXISTS prepress_findings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Multi-tenant + job linkage
  organization_id varchar NOT NULL,
  prepress_job_id uuid NOT NULL REFERENCES prepress_jobs(id) ON DELETE CASCADE,
  
  -- Finding details
  finding_type prepress_finding_type NOT NULL,
  severity varchar(20) NOT NULL DEFAULT 'info', -- blocker, warning, info
  message text NOT NULL,
  
  -- Location context (optional)
  page_number integer,
  artboard_name varchar(255),
  object_reference varchar(255),
  
  -- Spot color specific fields (nullable for non-spot findings)
  spot_color_name varchar(255),
  color_model varchar(50),
  
  -- DPI specific fields (nullable for non-DPI findings)
  detected_dpi integer,
  required_dpi integer,
  
  -- Generic metadata
  metadata jsonb,
  
  -- Audit
  created_at timestamptz NOT NULL DEFAULT NOW()
);

-- 4) Create prepress_fix_logs table
CREATE TABLE IF NOT EXISTS prepress_fix_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Multi-tenant + job linkage
  organization_id varchar NOT NULL,
  prepress_job_id uuid NOT NULL REFERENCES prepress_jobs(id) ON DELETE CASCADE,
  
  -- Fix details
  fix_type prepress_fix_type NOT NULL,
  description text NOT NULL,
  
  -- Actor (nullable for automated fixes)
  fixed_by_user_id varchar,
  
  -- Before/after snapshots (optional)
  before_snapshot jsonb,
  after_snapshot jsonb,
  
  -- Audit
  created_at timestamptz NOT NULL DEFAULT NOW()
);

-- 5) Create indexes for efficient queries
CREATE INDEX IF NOT EXISTS prepress_findings_job_idx ON prepress_findings (prepress_job_id);
CREATE INDEX IF NOT EXISTS prepress_findings_org_idx ON prepress_findings (organization_id);
CREATE INDEX IF NOT EXISTS prepress_findings_type_idx ON prepress_findings (finding_type);

CREATE INDEX IF NOT EXISTS prepress_fix_logs_job_idx ON prepress_fix_logs (prepress_job_id);
CREATE INDEX IF NOT EXISTS prepress_fix_logs_org_idx ON prepress_fix_logs (organization_id);
CREATE INDEX IF NOT EXISTS prepress_fix_logs_user_idx ON prepress_fix_logs (fixed_by_user_id);

-- 6) Add comments for documentation
COMMENT ON TABLE prepress_findings IS 'Preflight findings (DPI, spot colors, issues) - TEMP during running, PERMANENT on completion';
COMMENT ON TABLE prepress_fix_logs IS 'Audit trail of fixes applied during preflight - immutable after job completion';
