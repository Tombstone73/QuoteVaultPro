-- Migration 0053: Inbound orders review queue foundation
--
-- Adds the tenant-scoped foundation tables for TitanOS inbound order review.
-- This migration intentionally adds schema only: no intake automation,
-- workflow behavior, preview generation, or quote/order mutation.

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'inbound_order_source_type') THEN
    CREATE TYPE inbound_order_source_type AS ENUM (
      'email',
      'customer_api',
      'webhook',
      'csv_import',
      'portal',
      'manual',
      'n8n',
      'zapier',
      'edi'
    );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'inbound_order_source_status') THEN
    CREATE TYPE inbound_order_source_status AS ENUM (
      'active',
      'paused',
      'disabled'
    );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'inbound_order_source_trust_level') THEN
    CREATE TYPE inbound_order_source_trust_level AS ENUM (
      'manual_internal',
      'trusted_customer_api',
      'trusted_portal',
      'semi_trusted_email',
      'untrusted_public'
    );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'inbound_order_record_status') THEN
    CREATE TYPE inbound_order_record_status AS ENUM (
      'received',
      'processing',
      'needs_review',
      'waiting_on_customer',
      'ready',
      'approved',
      'submitted',
      'failed',
      'terminal'
    );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'inbound_order_line_item_status') THEN
    CREATE TYPE inbound_order_line_item_status AS ENUM (
      'extracted',
      'needs_review',
      'validated',
      'excluded'
    );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'inbound_order_file_role') THEN
    CREATE TYPE inbound_order_file_role AS ENUM (
      'artwork',
      'po',
      'reference',
      'email_attachment',
      'csv',
      'source_payload',
      'other'
    );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'inbound_order_file_status') THEN
    CREATE TYPE inbound_order_file_status AS ENUM (
      'uploaded',
      'scanning',
      'available',
      'quarantined',
      'rejected',
      'linked'
    );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'inbound_order_warning_severity') THEN
    CREATE TYPE inbound_order_warning_severity AS ENUM (
      'info',
      'warning',
      'blocking'
    );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'inbound_order_review_item_status') THEN
    CREATE TYPE inbound_order_review_item_status AS ENUM (
      'open',
      'resolved',
      'ignored'
    );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'inbound_order_decision_flag_status') THEN
    CREATE TYPE inbound_order_decision_flag_status AS ENUM (
      'open',
      'accepted',
      'overridden',
      'dismissed'
    );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'inbound_order_event_actor_type') THEN
    CREATE TYPE inbound_order_event_actor_type AS ENUM (
      'user',
      'system',
      'source',
      'automation'
    );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'inbound_order_review_snapshot_type') THEN
    CREATE TYPE inbound_order_review_snapshot_type AS ENUM (
      'approval',
      'submission',
      'rejection',
      'customer_reply'
    );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS inbound_order_sources (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  source_type inbound_order_source_type NOT NULL DEFAULT 'manual',
  name varchar(255) NOT NULL,
  status inbound_order_source_status NOT NULL DEFAULT 'active',
  source_trust_level inbound_order_source_trust_level NOT NULL DEFAULT 'manual_internal',
  auth_mode varchar(50) NOT NULL DEFAULT 'system',
  external_account_id varchar(255),
  settings_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by_user_id varchar REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS inbound_order_sources_org_type_idx
  ON inbound_order_sources (organization_id, source_type);

CREATE INDEX IF NOT EXISTS inbound_order_sources_org_status_idx
  ON inbound_order_sources (organization_id, status);

CREATE INDEX IF NOT EXISTS inbound_order_sources_org_trust_idx
  ON inbound_order_sources (organization_id, source_trust_level);

CREATE UNIQUE INDEX IF NOT EXISTS inbound_order_sources_org_type_name_uidx
  ON inbound_order_sources (organization_id, source_type, name);

CREATE TABLE IF NOT EXISTS inbound_order_records (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  source_id varchar REFERENCES inbound_order_sources(id) ON DELETE SET NULL,
  source_type inbound_order_source_type NOT NULL DEFAULT 'manual',
  source_label varchar(255),
  source_trust_level inbound_order_source_trust_level NOT NULL DEFAULT 'manual_internal',
  source_record_id varchar(255),
  source_message_id varchar(255),
  status inbound_order_record_status NOT NULL DEFAULT 'received',
  review_outcome varchar(50),
  requires_human_decision boolean NOT NULL DEFAULT false,
  review_required_reason text,
  external_reference varchar(255),
  idempotency_key varchar(255),
  payload_hash varchar(128),
  raw_payload_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  normalized_payload_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  extracted_customer_json jsonb DEFAULT '{}'::jsonb,
  extracted_order_json jsonb DEFAULT '{}'::jsonb,
  extracted_shipping_json jsonb DEFAULT '{}'::jsonb,
  confidence_score decimal(5, 4),
  duplicate_score decimal(5, 4),
  matched_customer_id varchar REFERENCES customers(id) ON DELETE SET NULL,
  matched_contact_id varchar REFERENCES customer_contacts(id) ON DELETE SET NULL,
  matched_quote_id varchar REFERENCES quotes(id) ON DELETE SET NULL,
  matched_order_id varchar REFERENCES orders(id) ON DELETE SET NULL,
  created_quote_id varchar REFERENCES quotes(id) ON DELETE SET NULL,
  created_order_id varchar REFERENCES orders(id) ON DELETE SET NULL,
  assigned_to_user_id varchar REFERENCES users(id) ON DELETE SET NULL,
  submitted_by_user_id varchar REFERENCES users(id) ON DELETE SET NULL,
  rejected_by_user_id varchar REFERENCES users(id) ON DELETE SET NULL,
  rejection_reason text,
  received_at timestamp with time zone NOT NULL DEFAULT now(),
  parsed_at timestamp with time zone,
  review_started_at timestamp with time zone,
  approved_at timestamp with time zone,
  submitted_at timestamp with time zone,
  rejected_at timestamp with time zone,
  archived_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS inbound_order_records_org_status_received_idx
  ON inbound_order_records (organization_id, status, received_at);

CREATE INDEX IF NOT EXISTS inbound_order_records_org_source_type_received_idx
  ON inbound_order_records (organization_id, source_type, received_at);

CREATE INDEX IF NOT EXISTS inbound_order_records_org_assigned_status_idx
  ON inbound_order_records (organization_id, assigned_to_user_id, status);

CREATE INDEX IF NOT EXISTS inbound_order_records_org_source_idx
  ON inbound_order_records (organization_id, source_id);

CREATE INDEX IF NOT EXISTS inbound_order_records_org_matched_customer_idx
  ON inbound_order_records (organization_id, matched_customer_id);

CREATE INDEX IF NOT EXISTS inbound_order_records_org_created_quote_idx
  ON inbound_order_records (organization_id, created_quote_id);

CREATE INDEX IF NOT EXISTS inbound_order_records_org_created_order_idx
  ON inbound_order_records (organization_id, created_order_id);

CREATE INDEX IF NOT EXISTS inbound_order_records_org_payload_hash_idx
  ON inbound_order_records (organization_id, payload_hash);

CREATE INDEX IF NOT EXISTS inbound_order_records_org_external_ref_idx
  ON inbound_order_records (organization_id, external_reference);

CREATE UNIQUE INDEX IF NOT EXISTS inbound_order_records_org_source_idempotency_uidx
  ON inbound_order_records (organization_id, source_id, idempotency_key);

CREATE TABLE IF NOT EXISTS inbound_order_line_items (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  inbound_record_id varchar NOT NULL REFERENCES inbound_order_records(id) ON DELETE CASCADE,
  sort_order integer NOT NULL DEFAULT 0,
  status inbound_order_line_item_status NOT NULL DEFAULT 'extracted',
  raw_line_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  normalized_line_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  product_id varchar REFERENCES products(id) ON DELETE SET NULL,
  variant_id varchar REFERENCES product_variants(id) ON DELETE SET NULL,
  product_name_raw text,
  description text,
  width decimal(10, 2),
  height decimal(10, 2),
  quantity integer,
  option_selections_json jsonb DEFAULT '{}'::jsonb,
  pbv2_tree_version_id varchar REFERENCES pbv2_tree_versions(id) ON DELETE SET NULL,
  pricing_preview_json jsonb DEFAULT '{}'::jsonb,
  confidence_score decimal(5, 4),
  warnings_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  reviewed_by_user_id varchar REFERENCES users(id) ON DELETE SET NULL,
  created_quote_line_item_id varchar REFERENCES quote_line_items(id) ON DELETE SET NULL,
  created_order_line_item_id varchar REFERENCES order_line_items(id) ON DELETE SET NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS inbound_order_line_items_org_record_sort_idx
  ON inbound_order_line_items (organization_id, inbound_record_id, sort_order);

CREATE INDEX IF NOT EXISTS inbound_order_line_items_org_product_idx
  ON inbound_order_line_items (organization_id, product_id);

CREATE INDEX IF NOT EXISTS inbound_order_line_items_org_status_idx
  ON inbound_order_line_items (organization_id, status);

CREATE TABLE IF NOT EXISTS inbound_order_files (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  inbound_record_id varchar NOT NULL REFERENCES inbound_order_records(id) ON DELETE CASCADE,
  inbound_line_item_id varchar REFERENCES inbound_order_line_items(id) ON DELETE SET NULL,
  file_record_id varchar REFERENCES file_records(id) ON DELETE SET NULL,
  source_filename varchar(512),
  role inbound_order_file_role NOT NULL DEFAULT 'other',
  mime_type varchar(255),
  size_bytes integer,
  checksum varchar(128),
  status inbound_order_file_status NOT NULL DEFAULT 'uploaded',
  review_notes text,
  created_quote_attachment_id varchar REFERENCES quote_attachments(id) ON DELETE SET NULL,
  created_order_attachment_id varchar REFERENCES order_attachments(id) ON DELETE SET NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS inbound_order_files_org_record_idx
  ON inbound_order_files (organization_id, inbound_record_id);

CREATE INDEX IF NOT EXISTS inbound_order_files_org_line_item_idx
  ON inbound_order_files (organization_id, inbound_line_item_id);

CREATE INDEX IF NOT EXISTS inbound_order_files_org_file_record_idx
  ON inbound_order_files (organization_id, file_record_id);

CREATE INDEX IF NOT EXISTS inbound_order_files_org_status_idx
  ON inbound_order_files (organization_id, status);

CREATE INDEX IF NOT EXISTS inbound_order_files_org_checksum_idx
  ON inbound_order_files (organization_id, checksum);

CREATE TABLE IF NOT EXISTS inbound_order_warnings (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  inbound_record_id varchar NOT NULL REFERENCES inbound_order_records(id) ON DELETE CASCADE,
  inbound_line_item_id varchar REFERENCES inbound_order_line_items(id) ON DELETE SET NULL,
  severity inbound_order_warning_severity NOT NULL DEFAULT 'warning',
  code varchar(100) NOT NULL,
  message text NOT NULL,
  field_path text,
  status inbound_order_review_item_status NOT NULL DEFAULT 'open',
  resolution_note text,
  resolved_by_user_id varchar REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  resolved_at timestamp with time zone
);

CREATE INDEX IF NOT EXISTS inbound_order_warnings_org_record_status_idx
  ON inbound_order_warnings (organization_id, inbound_record_id, status);

CREATE INDEX IF NOT EXISTS inbound_order_warnings_org_severity_status_idx
  ON inbound_order_warnings (organization_id, severity, status);

CREATE INDEX IF NOT EXISTS inbound_order_warnings_org_code_idx
  ON inbound_order_warnings (organization_id, code);

CREATE INDEX IF NOT EXISTS inbound_order_warnings_org_line_item_idx
  ON inbound_order_warnings (organization_id, inbound_line_item_id);

CREATE TABLE IF NOT EXISTS inbound_order_decision_flags (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  inbound_record_id varchar NOT NULL REFERENCES inbound_order_records(id) ON DELETE CASCADE,
  inbound_line_item_id varchar REFERENCES inbound_order_line_items(id) ON DELETE SET NULL,
  flag_type varchar(100) NOT NULL,
  field_path text,
  summary text NOT NULL,
  suggested_value_json jsonb DEFAULT '{}'::jsonb,
  candidate_values_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  confidence_score decimal(5, 4),
  status inbound_order_decision_flag_status NOT NULL DEFAULT 'open',
  decision_value_json jsonb DEFAULT '{}'::jsonb,
  decision_note text,
  decided_by_user_id varchar REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  decided_at timestamp with time zone
);

CREATE INDEX IF NOT EXISTS inbound_order_decision_flags_org_record_status_idx
  ON inbound_order_decision_flags (organization_id, inbound_record_id, status);

CREATE INDEX IF NOT EXISTS inbound_order_decision_flags_org_type_status_idx
  ON inbound_order_decision_flags (organization_id, flag_type, status);

CREATE INDEX IF NOT EXISTS inbound_order_decision_flags_org_confidence_idx
  ON inbound_order_decision_flags (organization_id, confidence_score);

CREATE INDEX IF NOT EXISTS inbound_order_decision_flags_org_line_item_idx
  ON inbound_order_decision_flags (organization_id, inbound_line_item_id);

CREATE TABLE IF NOT EXISTS inbound_order_events (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  inbound_record_id varchar NOT NULL REFERENCES inbound_order_records(id) ON DELETE CASCADE,
  actor_user_id varchar REFERENCES users(id) ON DELETE SET NULL,
  actor_type inbound_order_event_actor_type NOT NULL DEFAULT 'system',
  event_type varchar(100) NOT NULL,
  from_status inbound_order_record_status,
  to_status inbound_order_record_status,
  message text,
  metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS inbound_order_events_org_record_created_idx
  ON inbound_order_events (organization_id, inbound_record_id, created_at);

CREATE INDEX IF NOT EXISTS inbound_order_events_org_type_created_idx
  ON inbound_order_events (organization_id, event_type, created_at);

CREATE TABLE IF NOT EXISTS inbound_order_review_snapshots (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  inbound_record_id varchar NOT NULL REFERENCES inbound_order_records(id) ON DELETE CASCADE,
  snapshot_type inbound_order_review_snapshot_type NOT NULL,
  snapshot_version integer NOT NULL DEFAULT 1,
  payload_json jsonb NOT NULL,
  created_by_user_id varchar REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS inbound_order_review_snapshots_org_record_created_idx
  ON inbound_order_review_snapshots (organization_id, inbound_record_id, created_at);

CREATE INDEX IF NOT EXISTS inbound_order_review_snapshots_org_type_created_idx
  ON inbound_order_review_snapshots (organization_id, snapshot_type, created_at);
