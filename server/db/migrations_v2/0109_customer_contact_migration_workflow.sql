ALTER TABLE customer_contact_links
  ADD COLUMN IF NOT EXISTS is_proof boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS role varchar(100),
  ADD COLUMN IF NOT EXISTS source_system varchar(50),
  ADD COLUMN IF NOT EXISTS source_record_id varchar(255),
  ADD COLUMN IF NOT EXISTS start_date timestamp,
  ADD COLUMN IF NOT EXISTS end_date timestamp,
  ADD COLUMN IF NOT EXISTS notes text;

CREATE TABLE IF NOT EXISTS external_identity_mappings (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  entity_type varchar(50) NOT NULL,
  entity_id varchar(255) NOT NULL,
  source_system varchar(50) NOT NULL,
  source_entity_type varchar(50) NOT NULL,
  source_record_id varchar(255) NOT NULL,
  source_display_name varchar(255),
  metadata_json jsonb,
  first_seen_at timestamp NOT NULL DEFAULT now(),
  last_seen_at timestamp NOT NULL DEFAULT now(),
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS external_identity_mappings_org_entity_idx
  ON external_identity_mappings (organization_id, entity_type, entity_id);

CREATE INDEX IF NOT EXISTS external_identity_mappings_org_source_idx
  ON external_identity_mappings (organization_id, source_system, source_entity_type);

CREATE UNIQUE INDEX IF NOT EXISTS external_identity_mappings_source_uidx
  ON external_identity_mappings (organization_id, source_system, source_entity_type, source_record_id);

CREATE TABLE IF NOT EXISTS customer_contact_import_batches (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  status varchar(40) NOT NULL DEFAULT 'uploaded',
  source_label varchar(255),
  qb_source_label varchar(255),
  infoflo_company_filename varchar(255),
  infoflo_company_checksum varchar(128),
  infoflo_contacts_filename varchar(255),
  infoflo_contacts_checksum varchar(128),
  created_by_user_id varchar REFERENCES users(id) ON DELETE SET NULL,
  finalized_by_user_id varchar REFERENCES users(id) ON DELETE SET NULL,
  finalized_at timestamp,
  locked_at timestamp,
  lock_token varchar(100),
  failing_stage varchar(100),
  failing_record_id varchar(255),
  error_message text,
  summary_json jsonb,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS customer_contact_import_batches_org_idx
  ON customer_contact_import_batches (organization_id);

CREATE INDEX IF NOT EXISTS customer_contact_import_batches_status_idx
  ON customer_contact_import_batches (status);

CREATE INDEX IF NOT EXISTS customer_contact_import_batches_created_idx
  ON customer_contact_import_batches (created_at);

CREATE TABLE IF NOT EXISTS customer_contact_import_company_records (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  batch_id varchar NOT NULL REFERENCES customer_contact_import_batches(id) ON DELETE CASCADE,
  row_number integer NOT NULL,
  status varchar(40) NOT NULL DEFAULT 'pending',
  source_system varchar(50) NOT NULL DEFAULT 'infoflo',
  source_record_id varchar(255),
  quickbooks_customer_id varchar(64),
  selected_customer_id varchar REFERENCES customers(id) ON DELETE SET NULL,
  raw_json jsonb,
  normalized_json jsonb,
  match_candidates_json jsonb,
  proposed_changes_json jsonb,
  review_decision_json jsonb,
  warnings_json jsonb,
  error_message text,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS cc_import_company_batch_idx
  ON customer_contact_import_company_records (batch_id);

CREATE INDEX IF NOT EXISTS cc_import_company_org_status_idx
  ON customer_contact_import_company_records (organization_id, status);

CREATE INDEX IF NOT EXISTS cc_import_company_source_idx
  ON customer_contact_import_company_records (organization_id, source_system, source_record_id);

CREATE TABLE IF NOT EXISTS customer_contact_import_contact_records (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  batch_id varchar NOT NULL REFERENCES customer_contact_import_batches(id) ON DELETE CASCADE,
  row_number integer NOT NULL,
  status varchar(40) NOT NULL DEFAULT 'pending',
  source_system varchar(50) NOT NULL DEFAULT 'infoflo',
  source_record_id varchar(255),
  selected_contact_id varchar REFERENCES customer_contacts(id) ON DELETE SET NULL,
  selected_customer_id varchar REFERENCES customers(id) ON DELETE SET NULL,
  raw_json jsonb,
  normalized_json jsonb,
  match_candidates_json jsonb,
  proposed_changes_json jsonb,
  review_decision_json jsonb,
  warnings_json jsonb,
  error_message text,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS cc_import_contact_batch_idx
  ON customer_contact_import_contact_records (batch_id);

CREATE INDEX IF NOT EXISTS cc_import_contact_org_status_idx
  ON customer_contact_import_contact_records (organization_id, status);

CREATE INDEX IF NOT EXISTS cc_import_contact_source_idx
  ON customer_contact_import_contact_records (organization_id, source_system, source_record_id);

CREATE TABLE IF NOT EXISTS customer_contact_import_relationship_records (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  batch_id varchar NOT NULL REFERENCES customer_contact_import_batches(id) ON DELETE CASCADE,
  company_record_id varchar REFERENCES customer_contact_import_company_records(id) ON DELETE SET NULL,
  contact_record_id varchar REFERENCES customer_contact_import_contact_records(id) ON DELETE SET NULL,
  status varchar(40) NOT NULL DEFAULT 'pending',
  selected_customer_id varchar REFERENCES customers(id) ON DELETE SET NULL,
  selected_contact_id varchar REFERENCES customer_contacts(id) ON DELETE SET NULL,
  selected_link_id varchar REFERENCES customer_contact_links(id) ON DELETE SET NULL,
  is_primary boolean NOT NULL DEFAULT false,
  is_billing boolean NOT NULL DEFAULT false,
  is_proof boolean NOT NULL DEFAULT false,
  relationship_status varchar(30) DEFAULT 'active',
  role varchar(100),
  source_system varchar(50) DEFAULT 'infoflo',
  source_record_id varchar(255),
  proposed_changes_json jsonb,
  review_decision_json jsonb,
  warnings_json jsonb,
  error_message text,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS cc_import_relationship_batch_idx
  ON customer_contact_import_relationship_records (batch_id);

CREATE INDEX IF NOT EXISTS cc_import_relationship_org_status_idx
  ON customer_contact_import_relationship_records (organization_id, status);

CREATE INDEX IF NOT EXISTS cc_import_relationship_company_idx
  ON customer_contact_import_relationship_records (company_record_id);

CREATE INDEX IF NOT EXISTS cc_import_relationship_contact_idx
  ON customer_contact_import_relationship_records (contact_record_id);
