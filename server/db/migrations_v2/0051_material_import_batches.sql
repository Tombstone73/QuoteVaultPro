-- Migration 0051: Add material_import_batches and material_import_rows tables
--
-- These staging tables support the CSV import workflow:
--   upload → parse → validate → review_ready → committed
--
-- Permanent materials are only modified during the explicit commit step.
-- All enums stored as varchar to avoid PostgreSQL enum type management.

CREATE TABLE material_import_batches (
  id              varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  -- status: uploaded | parsed | validated | review_ready | committed | failed | cancelled
  status          varchar(30) NOT NULL DEFAULT 'uploaded',
  source_filename varchar(255),
  created_by_user_id varchar REFERENCES users(id) ON DELETE SET NULL,
  total_rows      integer NOT NULL DEFAULT 0,
  valid_rows      integer NOT NULL DEFAULT 0,
  invalid_rows    integer NOT NULL DEFAULT 0,
  conflict_rows   integer NOT NULL DEFAULT 0,
  skipped_rows    integer NOT NULL DEFAULT 0,
  error_message   text,
  summary_json    jsonb,
  created_at      timestamp NOT NULL DEFAULT now(),
  updated_at      timestamp NOT NULL DEFAULT now()
);

CREATE INDEX material_import_batches_org_idx    ON material_import_batches(organization_id);
CREATE INDEX material_import_batches_status_idx ON material_import_batches(status);
CREATE INDEX material_import_batches_created_idx ON material_import_batches(created_at DESC);

CREATE TABLE material_import_rows (
  id              varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  batch_id        varchar NOT NULL REFERENCES material_import_batches(id) ON DELETE CASCADE,
  row_number      integer NOT NULL,
  -- status: pending | valid | invalid | conflict | ready_to_apply | applied | skipped
  status          varchar(30) NOT NULL DEFAULT 'pending',
  -- action: create | update | skip | null
  action          varchar(20),
  -- existing_material_id: set when action='update', the material that will be updated
  existing_material_id varchar REFERENCES materials(id) ON DELETE SET NULL,
  raw_json        jsonb,
  normalized_json jsonb,
  -- validation_errors: array of error strings
  validation_errors jsonb,
  -- matched_by: how the existing material was identified (or how this row is classified)
  -- values: material_id | sku | vendor_lookup | name | new | conflict
  matched_by      varchar(30),
  created_at      timestamp NOT NULL DEFAULT now()
);

CREATE INDEX material_import_rows_batch_idx  ON material_import_rows(batch_id);
CREATE INDEX material_import_rows_org_idx    ON material_import_rows(organization_id);
CREATE INDEX material_import_rows_status_idx ON material_import_rows(status);
