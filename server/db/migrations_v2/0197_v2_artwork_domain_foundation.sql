-- M2.0: Artwork owns one durable file identity. Customer supplied, proof, and
-- production are assignments/usages; they are intentionally not separate file tables.

CREATE TABLE v2_artwork_files (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  storage_provider varchar(80) NOT NULL,
  object_key varchar(1024) NOT NULL,
  object_version varchar(255) NOT NULL DEFAULT '',
  original_filename varchar(512) NOT NULL,
  display_filename varchar(512) NOT NULL,
  content_type varchar(255) NOT NULL,
  byte_size bigint NOT NULL,
  checksum_algorithm varchar(16),
  checksum_value varchar(128),
  source_kind varchar(32) NOT NULL,
  page_count integer,
  detected_width_microns integer,
  detected_height_microns integer,
  derived_from_artwork_file_id varchar,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT v2_artwork_files_storage_provider_chk CHECK (length(btrim(storage_provider)) > 0),
  CONSTRAINT v2_artwork_files_object_key_chk CHECK (length(btrim(object_key)) > 0),
  CONSTRAINT v2_artwork_files_filename_chk CHECK (length(btrim(original_filename)) > 0 AND length(btrim(display_filename)) > 0),
  CONSTRAINT v2_artwork_files_content_type_chk CHECK (length(btrim(content_type)) > 0),
  CONSTRAINT v2_artwork_files_byte_size_chk CHECK (byte_size >= 0),
  CONSTRAINT v2_artwork_files_checksum_chk CHECK (
    (checksum_algorithm IS NULL AND checksum_value IS NULL)
    OR (checksum_algorithm = 'sha256' AND checksum_value ~ '^[A-Fa-f0-9]{64}$')
  ),
  CONSTRAINT v2_artwork_files_source_kind_chk CHECK (source_kind IN ('customer_upload','prepress_derived','imported')),
  CONSTRAINT v2_artwork_files_page_count_chk CHECK (page_count IS NULL OR page_count > 0),
  CONSTRAINT v2_artwork_files_detected_width_chk CHECK (detected_width_microns IS NULL OR detected_width_microns > 0),
  CONSTRAINT v2_artwork_files_detected_height_chk CHECK (detected_height_microns IS NULL OR detected_height_microns > 0),
  CONSTRAINT v2_artwork_files_not_self_derived_chk CHECK (derived_from_artwork_file_id IS NULL OR derived_from_artwork_file_id <> id),
  CONSTRAINT v2_artwork_files_id_organization_uidx UNIQUE (id, organization_id),
  CONSTRAINT v2_artwork_files_storage_identity_uidx UNIQUE (organization_id, storage_provider, object_key, object_version),
  CONSTRAINT v2_artwork_files_derived_from_tenant_fk FOREIGN KEY (derived_from_artwork_file_id, organization_id)
    REFERENCES v2_artwork_files(id, organization_id) ON DELETE RESTRICT
);
CREATE INDEX v2_artwork_files_org_created_idx ON v2_artwork_files(organization_id, created_at DESC);

-- A recursive check is necessary because a simple FK/check cannot reject an
-- A->B->C->A cycle. It is physical protection for future writers as well.
CREATE OR REPLACE FUNCTION v2_artwork_file_lineage_validate() RETURNS trigger AS $$
BEGIN
  IF NEW.derived_from_artwork_file_id IS NULL THEN RETURN NEW; END IF;
  IF EXISTS (
    WITH RECURSIVE ancestors(id) AS (
      SELECT NEW.derived_from_artwork_file_id
      UNION
      SELECT f.derived_from_artwork_file_id
      FROM v2_artwork_files f JOIN ancestors a ON a.id=f.id
      WHERE f.organization_id=NEW.organization_id AND f.derived_from_artwork_file_id IS NOT NULL
    ) SELECT 1 FROM ancestors WHERE id=NEW.id
  ) THEN RAISE EXCEPTION 'Artwork lineage cycle is not permitted' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER v2_artwork_file_lineage_validate_trigger
  BEFORE INSERT OR UPDATE OF derived_from_artwork_file_id, organization_id ON v2_artwork_files
  FOR EACH ROW EXECUTE FUNCTION v2_artwork_file_lineage_validate();

CREATE TABLE v2_artwork_assignments (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  artwork_file_id varchar NOT NULL,
  order_document_id varchar NOT NULL,
  order_line_id varchar NOT NULL,
  purpose varchar(32) NOT NULL,
  side varchar(16),
  source_page_index integer,
  layer_key varchar(160),
  layer_order integer,
  identity_fingerprint varchar(128) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT v2_artwork_assignments_purpose_chk CHECK (purpose IN ('customer_supplied','production','proof','reference')),
  CONSTRAINT v2_artwork_assignments_side_chk CHECK (side IS NULL OR side IN ('front','back')),
  CONSTRAINT v2_artwork_assignments_page_chk CHECK (source_page_index IS NULL OR source_page_index >= 0),
  CONSTRAINT v2_artwork_assignments_layer_chk CHECK (
    (layer_key IS NULL AND layer_order IS NULL)
    OR (layer_key IS NOT NULL AND length(btrim(layer_key)) > 0 AND layer_order IS NOT NULL AND layer_order >= 0)
  ),
  CONSTRAINT v2_artwork_assignments_fingerprint_chk CHECK (identity_fingerprint ~ '^sha256:[A-Fa-f0-9]{64}$'),
  CONSTRAINT v2_artwork_assignments_id_organization_uidx UNIQUE (id, organization_id),
  CONSTRAINT v2_artwork_assignments_order_line_identity_uidx UNIQUE (organization_id, order_line_id, identity_fingerprint),
  CONSTRAINT v2_artwork_assignments_file_tenant_fk FOREIGN KEY (artwork_file_id, organization_id)
    REFERENCES v2_artwork_files(id, organization_id) ON DELETE RESTRICT,
  -- Sales retains ownership of order and line identities. Both FKs are needed:
  -- the order subtype prevents Quote-line attachment and the line tuple proves membership.
  CONSTRAINT v2_artwork_assignments_order_tenant_fk FOREIGN KEY (order_document_id, organization_id)
    REFERENCES v2_sales_order_details(document_id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT v2_artwork_assignments_order_line_tenant_fk FOREIGN KEY (order_line_id, organization_id, order_document_id)
    REFERENCES v2_sales_document_lines(id, organization_id, document_id) ON DELETE RESTRICT
);
CREATE INDEX v2_artwork_assignments_org_order_line_idx ON v2_artwork_assignments(organization_id, order_line_id, created_at);
CREATE INDEX v2_artwork_assignments_org_file_idx ON v2_artwork_assignments(organization_id, artwork_file_id, created_at);

-- Only future template-derived sets receive these grants; existing customized
-- organization sets are never silently widened by an Artwork migration.
INSERT INTO v2_permission_capabilities(id,module,label) VALUES
  ('artwork.view','artwork','View artwork metadata and usages'),
  ('artwork.adopt','artwork','Adopt stored artwork for OrderLine work'),
  ('artwork.assign','artwork','Assign existing artwork to OrderLine work')
ON CONFLICT(id) DO NOTHING;
INSERT INTO v2_permission_set_template_capabilities(template_id,capability_id)
SELECT id, capability_id
FROM v2_permission_set_templates
CROSS JOIN (VALUES ('artwork.view'),('artwork.adopt'),('artwork.assign')) AS capability(capability_id)
WHERE template_key IN ('owner','administrator','sales')
ON CONFLICT DO NOTHING;
