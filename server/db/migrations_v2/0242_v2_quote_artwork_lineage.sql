-- M6 Quote Artwork lineage. Artwork files remain the one tenant-private
-- binary authority; Quote and Order records are distinct business usages of
-- that same file identity.

CREATE TABLE v2_quote_artwork_assignments (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  quote_document_id varchar NOT NULL,
  quote_line_id varchar NOT NULL,
  artwork_file_id varchar NOT NULL,
  purpose varchar(32) NOT NULL,
  side varchar(16),
  source_page_index integer,
  layer_key varchar(160),
  layer_order integer,
  identity_fingerprint varchar(128) NOT NULL,
  created_principal_kind varchar(32) NOT NULL,
  created_principal_subject varchar(255) NOT NULL,
  created_staff_actor_user_id varchar REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT v2_quote_artwork_assignments_purpose_chk CHECK (purpose IN ('customer_supplied','production','proof','reference')),
  CONSTRAINT v2_quote_artwork_assignments_side_chk CHECK (side IS NULL OR side IN ('front','back')),
  CONSTRAINT v2_quote_artwork_assignments_page_chk CHECK (source_page_index IS NULL OR source_page_index >= 0),
  CONSTRAINT v2_quote_artwork_assignments_layer_chk CHECK (
    (layer_key IS NULL AND layer_order IS NULL)
    OR (layer_key IS NOT NULL AND length(btrim(layer_key)) > 0 AND layer_order IS NOT NULL AND layer_order >= 0)
  ),
  CONSTRAINT v2_quote_artwork_assignments_fingerprint_chk CHECK (identity_fingerprint ~ '^sha256:[A-Fa-f0-9]{64}$'),
  CONSTRAINT v2_quote_artwork_assignments_principal_kind_chk CHECK (created_principal_kind IN ('staff','delegated_ai','portal','service')),
  CONSTRAINT v2_quote_artwork_assignments_subject_chk CHECK (length(btrim(created_principal_subject)) > 0),
  CONSTRAINT v2_quote_artwork_assignments_id_organization_uidx UNIQUE (id, organization_id),
  CONSTRAINT v2_quote_artwork_assignments_source_tuple_uidx UNIQUE (id, organization_id, quote_document_id, quote_line_id, artwork_file_id),
  CONSTRAINT v2_quote_artwork_assignments_line_identity_uidx UNIQUE (organization_id, quote_line_id, identity_fingerprint),
  CONSTRAINT v2_quote_artwork_assignments_file_tenant_fk FOREIGN KEY (artwork_file_id, organization_id)
    REFERENCES v2_artwork_files(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT v2_quote_artwork_assignments_quote_tenant_fk FOREIGN KEY (quote_document_id, organization_id)
    REFERENCES v2_sales_quote_details(document_id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT v2_quote_artwork_assignments_quote_line_tenant_fk FOREIGN KEY (quote_line_id, organization_id, quote_document_id)
    REFERENCES v2_sales_document_lines(id, organization_id, document_id) ON DELETE RESTRICT
);
CREATE INDEX v2_quote_artwork_assignments_org_quote_line_idx
  ON v2_quote_artwork_assignments(organization_id, quote_document_id, quote_line_id, created_at);
CREATE INDEX v2_quote_artwork_assignments_org_file_idx
  ON v2_quote_artwork_assignments(organization_id, artwork_file_id, created_at);

-- Quote artwork rows are append-only identity evidence. Before acceptance a
-- replacement is represented by removing an unreferenced row and adding a new
-- one; after acceptance the snapshot FK makes deletion impossible as well.
CREATE OR REPLACE FUNCTION v2_reject_quote_artwork_assignment_update() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'quote artwork assignments are immutable' USING ERRCODE='23514';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER v2_quote_artwork_assignment_immutable
  BEFORE UPDATE ON v2_quote_artwork_assignments
  FOR EACH ROW EXECUTE FUNCTION v2_reject_quote_artwork_assignment_update();

CREATE TABLE v2_quote_accepted_artwork_snapshots (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  quote_document_id varchar NOT NULL,
  acceptance_checkpoint_id varchar NOT NULL,
  quote_line_id varchar NOT NULL,
  quote_artwork_assignment_id varchar NOT NULL,
  artwork_file_id varchar NOT NULL,
  purpose varchar(32) NOT NULL,
  side varchar(16),
  source_page_index integer,
  layer_key varchar(160),
  layer_order integer,
  evidence_fingerprint varchar(128) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT v2_quote_accepted_artwork_snapshots_purpose_chk CHECK (purpose IN ('customer_supplied','production','proof','reference')),
  CONSTRAINT v2_quote_accepted_artwork_snapshots_side_chk CHECK (side IS NULL OR side IN ('front','back')),
  CONSTRAINT v2_quote_accepted_artwork_snapshots_page_chk CHECK (source_page_index IS NULL OR source_page_index >= 0),
  CONSTRAINT v2_quote_accepted_artwork_snapshots_layer_chk CHECK (
    (layer_key IS NULL AND layer_order IS NULL)
    OR (layer_key IS NOT NULL AND length(btrim(layer_key)) > 0 AND layer_order IS NOT NULL AND layer_order >= 0)
  ),
  CONSTRAINT v2_quote_accepted_artwork_snapshots_fingerprint_chk CHECK (evidence_fingerprint ~ '^sha256:[A-Fa-f0-9]{64}$'),
  CONSTRAINT v2_quote_accepted_artwork_snapshots_id_organization_uidx UNIQUE (id, organization_id),
  CONSTRAINT v2_quote_accepted_artwork_snapshots_checkpoint_assignment_uidx UNIQUE (organization_id, acceptance_checkpoint_id, quote_artwork_assignment_id),
  CONSTRAINT v2_quote_accepted_artwork_snapshot_line_evidence_uidx UNIQUE (organization_id, acceptance_checkpoint_id, quote_line_id, evidence_fingerprint),
  CONSTRAINT v2_quote_accepted_artwork_snapshots_quote_tenant_fk FOREIGN KEY (quote_document_id, organization_id)
    REFERENCES v2_sales_quote_details(document_id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT v2_quote_accepted_artwork_snapshots_checkpoint_tenant_fk FOREIGN KEY (acceptance_checkpoint_id, organization_id, quote_document_id)
    REFERENCES v2_sales_quote_checkpoints(id, organization_id, quote_document_id) ON DELETE RESTRICT,
  CONSTRAINT v2_quote_accepted_artwork_snapshots_source_assignment_tenant_fk FOREIGN KEY (quote_artwork_assignment_id, organization_id, quote_document_id, quote_line_id, artwork_file_id)
    REFERENCES v2_quote_artwork_assignments(id, organization_id, quote_document_id, quote_line_id, artwork_file_id) ON DELETE RESTRICT
);
CREATE INDEX v2_quote_accepted_artwork_snapshots_org_quote_idx
  ON v2_quote_accepted_artwork_snapshots(organization_id, quote_document_id, quote_line_id, created_at);
CREATE INDEX v2_quote_accepted_artwork_snapshots_org_file_idx
  ON v2_quote_accepted_artwork_snapshots(organization_id, artwork_file_id, created_at);

-- A snapshot is only legitimate acceptance evidence when every frozen fact
-- agrees with its exact immutable Quote artwork association and checkpoint.
CREATE OR REPLACE FUNCTION v2_quote_accepted_artwork_snapshot_validate() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM v2_sales_quote_checkpoints c
    JOIN v2_quote_artwork_assignments a
      ON a.id=NEW.quote_artwork_assignment_id
      AND a.organization_id=NEW.organization_id
      AND a.quote_document_id=NEW.quote_document_id
      AND a.quote_line_id=NEW.quote_line_id
      AND a.artwork_file_id=NEW.artwork_file_id
    WHERE c.id=NEW.acceptance_checkpoint_id
      AND c.organization_id=NEW.organization_id
      AND c.quote_document_id=NEW.quote_document_id
      AND c.checkpoint_kind='quote_accepted'
      AND a.purpose=NEW.purpose
      AND a.side IS NOT DISTINCT FROM NEW.side
      AND a.source_page_index IS NOT DISTINCT FROM NEW.source_page_index
      AND a.layer_key IS NOT DISTINCT FROM NEW.layer_key
      AND a.layer_order IS NOT DISTINCT FROM NEW.layer_order
  ) THEN
    RAISE EXCEPTION 'accepted Quote artwork snapshot must match a Quote artwork association and quote_accepted checkpoint' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER v2_quote_accepted_artwork_snapshot_validate_trigger
  BEFORE INSERT ON v2_quote_accepted_artwork_snapshots
  FOR EACH ROW EXECUTE FUNCTION v2_quote_accepted_artwork_snapshot_validate();
CREATE OR REPLACE FUNCTION v2_reject_quote_accepted_artwork_snapshot_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'accepted Quote artwork snapshots are immutable' USING ERRCODE='23514';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER v2_quote_accepted_artwork_snapshot_immutable
  BEFORE UPDATE OR DELETE ON v2_quote_accepted_artwork_snapshots
  FOR EACH ROW EXECUTE FUNCTION v2_reject_quote_accepted_artwork_snapshot_mutation();

-- An Order assignment may carry one accepted Quote-artwork provenance. The
-- uniqueness index makes a conversion replay recover one logical assignment,
-- never create another usage or duplicate a binary object.
ALTER TABLE v2_artwork_assignments
  ADD COLUMN source_quote_accepted_artwork_snapshot_id varchar;
ALTER TABLE v2_artwork_assignments
  ADD CONSTRAINT v2_artwork_assignments_quote_snapshot_tenant_fk
    FOREIGN KEY (source_quote_accepted_artwork_snapshot_id, organization_id)
    REFERENCES v2_quote_accepted_artwork_snapshots(id, organization_id) ON DELETE RESTRICT;
CREATE UNIQUE INDEX v2_artwork_assignments_source_quote_snapshot_uidx
  ON v2_artwork_assignments(organization_id, source_quote_accepted_artwork_snapshot_id)
  WHERE source_quote_accepted_artwork_snapshot_id IS NOT NULL;

-- A provenance-bearing Order assignment is valid only if the order is the
-- canonical conversion target of the exact accepted Quote checkpoint. It is
-- deferred because conversion creates Order, assignments, and lineage in one
-- transaction whose statements may occur in either safe order.
CREATE OR REPLACE FUNCTION v2_artwork_assignment_quote_snapshot_validate() RETURNS trigger AS $$
BEGIN
  IF NEW.source_quote_accepted_artwork_snapshot_id IS NULL THEN RETURN NEW; END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM v2_quote_accepted_artwork_snapshots s
    JOIN v2_sales_quote_conversions c
      ON c.organization_id=s.organization_id
      AND c.quote_document_id=s.quote_document_id
      AND c.source_checkpoint_id=s.acceptance_checkpoint_id
    WHERE s.id=NEW.source_quote_accepted_artwork_snapshot_id
      AND s.organization_id=NEW.organization_id
      AND c.order_document_id=NEW.order_document_id
      -- Conversion starts as customer-supplied Order artwork. Production
      -- promotion remains an explicit downstream operation.
      AND NEW.purpose='customer_supplied'
      AND NEW.artwork_file_id=s.artwork_file_id
      AND NEW.side IS NOT DISTINCT FROM s.side
      AND NEW.source_page_index IS NOT DISTINCT FROM s.source_page_index
      AND NEW.layer_key IS NOT DISTINCT FROM s.layer_key
      AND NEW.layer_order IS NOT DISTINCT FROM s.layer_order
  ) THEN
    RAISE EXCEPTION 'Order artwork provenance must target the exact accepted Quote conversion' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE CONSTRAINT TRIGGER v2_artwork_assignment_quote_snapshot_validate_trigger
  AFTER INSERT OR UPDATE ON v2_artwork_assignments
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
  EXECUTE FUNCTION v2_artwork_assignment_quote_snapshot_validate();
