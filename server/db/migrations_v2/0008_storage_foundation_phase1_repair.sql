-- Migration 0008: Storage foundation phase 1 repair
-- Repairs environments where storage foundation ledger entries exist but the
-- underlying storage tables were never created.

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'organization_storage_mode') THEN
    CREATE TYPE organization_storage_mode AS ENUM ('titan_managed', 'byos_cloud', 'byos_local', 'hybrid', 'disabled');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'organization_storage_profile_status') THEN
    CREATE TYPE organization_storage_profile_status AS ENUM ('unconfigured', 'active', 'invalid', 'disabled');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'storage_provider_type') THEN
    CREATE TYPE storage_provider_type AS ENUM ('titan_managed', 'supabase', 'local_filesystem', 'gcs', 's3', 'azure_blob');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'storage_provider_role') THEN
    CREATE TYPE storage_provider_role AS ENUM ('intake', 'canonical', 'archive');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'storage_provider_config_status') THEN
    CREATE TYPE storage_provider_config_status AS ENUM ('missing', 'configured', 'validated', 'invalid', 'disabled');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'file_storage_class') THEN
    CREATE TYPE file_storage_class AS ENUM ('hot', 'warm', 'cold', 'archive');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'file_lifecycle_state') THEN
    CREATE TYPE file_lifecycle_state AS ENUM ('upload_pending', 'stored_hot', 'stored_warm', 'stored_cold', 'archived', 'restore_pending', 'deleted');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'storage_placement_role') THEN
    CREATE TYPE storage_placement_role AS ENUM ('intake', 'canonical', 'archive', 'restore_source');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'storage_placement_state') THEN
    CREATE TYPE storage_placement_state AS ENUM ('active', 'superseded', 'restore_source', 'missing', 'deleted');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'file_derivative_type') THEN
    CREATE TYPE file_derivative_type AS ENUM ('thumbnail', 'preview', 'proof', 'print_ready', 'other');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'file_derivative_state') THEN
    CREATE TYPE file_derivative_state AS ENUM ('pending', 'ready', 'failed', 'replaced', 'deleted');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'customer_production_folder_type') THEN
    CREATE TYPE customer_production_folder_type AS ENUM ('production_destination');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'customer_production_folder_status') THEN
    CREATE TYPE customer_production_folder_status AS ENUM ('missing', 'configured', 'validated', 'invalid', 'disabled');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'storage_job_type') THEN
    CREATE TYPE storage_job_type AS ENUM ('finalize_upload', 'verify_object', 'validate_provider', 'generate_derivative', 'migrate_placement');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'storage_job_state') THEN
    CREATE TYPE storage_job_state AS ENUM ('queued', 'running', 'succeeded', 'retryable_failed', 'failed', 'cancelled');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS customer_production_folder_references (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  customer_id varchar REFERENCES customers(id) ON DELETE SET NULL,
  label varchar(255) NOT NULL,
  folder_type customer_production_folder_type NOT NULL DEFAULT 'production_destination',
  path_or_uri text NOT NULL,
  status customer_production_folder_status NOT NULL DEFAULT 'configured',
  validation_error text,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS customer_prod_folder_refs_org_customer_idx
  ON customer_production_folder_references (organization_id, customer_id);

CREATE INDEX IF NOT EXISTS customer_prod_folder_refs_org_status_idx
  ON customer_production_folder_references (organization_id, status);

CREATE UNIQUE INDEX IF NOT EXISTS customer_prod_folder_refs_customer_folder_uidx
  ON customer_production_folder_references (organization_id, customer_id, folder_type)
  WHERE customer_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS storage_provider_configs (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  provider_type storage_provider_type NOT NULL,
  role storage_provider_role NOT NULL,
  status storage_provider_config_status NOT NULL DEFAULT 'configured',
  display_name varchar(255) NOT NULL,
  config_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  validation_error text,
  last_validated_at timestamptz,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS storage_provider_configs_org_idx
  ON storage_provider_configs (organization_id);

CREATE INDEX IF NOT EXISTS storage_provider_configs_org_role_idx
  ON storage_provider_configs (organization_id, role);

CREATE INDEX IF NOT EXISTS storage_provider_configs_org_status_idx
  ON storage_provider_configs (organization_id, status);

CREATE TABLE IF NOT EXISTS organization_storage_profiles (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  mode organization_storage_mode NOT NULL DEFAULT 'titan_managed',
  status organization_storage_profile_status NOT NULL DEFAULT 'unconfigured',
  primary_provider_config_id varchar REFERENCES storage_provider_configs(id) ON DELETE SET NULL,
  intake_provider_config_id varchar REFERENCES storage_provider_configs(id) ON DELETE SET NULL,
  archive_provider_config_id varchar REFERENCES storage_provider_configs(id) ON DELETE SET NULL,
  production_folder_reference_id varchar REFERENCES customer_production_folder_references(id) ON DELETE SET NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS organization_storage_profiles_org_uidx
  ON organization_storage_profiles (organization_id);

CREATE INDEX IF NOT EXISTS organization_storage_profiles_status_idx
  ON organization_storage_profiles (status);

CREATE TABLE IF NOT EXISTS file_records (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  storage_class file_storage_class NOT NULL DEFAULT 'hot',
  lifecycle_state file_lifecycle_state NOT NULL DEFAULT 'upload_pending',
  original_filename varchar(512) NOT NULL,
  mime_type varchar(255) NOT NULL,
  size_bytes integer NOT NULL,
  checksum varchar(128),
  created_by_user_id varchar REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS file_records_org_created_idx
  ON file_records (organization_id, created_at);

CREATE INDEX IF NOT EXISTS file_records_org_state_idx
  ON file_records (organization_id, lifecycle_state);

CREATE TABLE IF NOT EXISTS storage_placements (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid()::text,
  file_record_id varchar NOT NULL REFERENCES file_records(id) ON DELETE CASCADE,
  provider_config_id varchar NOT NULL REFERENCES storage_provider_configs(id) ON DELETE RESTRICT,
  placement_role storage_placement_role NOT NULL DEFAULT 'canonical',
  placement_state storage_placement_state NOT NULL DEFAULT 'active',
  bucket varchar(255),
  object_key text,
  local_path_ref text,
  checksum varchar(128),
  size_bytes integer,
  last_verified_at timestamptz,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS storage_placements_file_idx
  ON storage_placements (file_record_id);

CREATE INDEX IF NOT EXISTS storage_placements_provider_idx
  ON storage_placements (provider_config_id);

CREATE INDEX IF NOT EXISTS storage_placements_state_idx
  ON storage_placements (placement_state);

CREATE TABLE IF NOT EXISTS file_derivatives (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid()::text,
  file_record_id varchar NOT NULL REFERENCES file_records(id) ON DELETE CASCADE,
  derivative_type file_derivative_type NOT NULL DEFAULT 'preview',
  state file_derivative_state NOT NULL DEFAULT 'pending',
  source_placement_id varchar REFERENCES storage_placements(id) ON DELETE SET NULL,
  bucket varchar(255),
  object_key text,
  mime_type varchar(255),
  size_bytes integer,
  error_text text,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS file_derivatives_file_idx
  ON file_derivatives (file_record_id);

CREATE INDEX IF NOT EXISTS file_derivatives_state_idx
  ON file_derivatives (state);

CREATE TABLE IF NOT EXISTS storage_jobs (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  job_type storage_job_type NOT NULL,
  state storage_job_state NOT NULL DEFAULT 'queued',
  file_record_id varchar REFERENCES file_records(id) ON DELETE SET NULL,
  source_placement_id varchar REFERENCES storage_placements(id) ON DELETE SET NULL,
  target_provider_config_id varchar REFERENCES storage_provider_configs(id) ON DELETE SET NULL,
  payload_json jsonb,
  error_text text,
  attempts integer NOT NULL DEFAULT 0,
  scheduled_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS storage_jobs_org_state_idx
  ON storage_jobs (organization_id, state);

CREATE INDEX IF NOT EXISTS storage_jobs_org_created_idx
  ON storage_jobs (organization_id, created_at);

CREATE INDEX IF NOT EXISTS storage_jobs_file_idx
  ON storage_jobs (file_record_id);