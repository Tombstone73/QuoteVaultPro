-- An Order, unlike its accepted Quote source, owns a mutable current-artwork
-- selection.  Replacements append a successor rather than changing the
-- inherited assignment or its accepted-Quote provenance.

ALTER TABLE v2_artwork_assignments
  ADD COLUMN supersedes_artwork_assignment_id varchar;

ALTER TABLE v2_artwork_assignments
  ADD CONSTRAINT v2_artwork_assignments_supersedes_tenant_fk
    FOREIGN KEY (supersedes_artwork_assignment_id, organization_id)
    REFERENCES v2_artwork_assignments(id, organization_id) ON DELETE RESTRICT;

-- A replacement chain is linear.  This prevents two concurrent writers from
-- declaring different files current for the same historical assignment.
CREATE UNIQUE INDEX v2_artwork_assignments_one_successor_uidx
  ON v2_artwork_assignments(organization_id, supersedes_artwork_assignment_id)
  WHERE supersedes_artwork_assignment_id IS NOT NULL;
CREATE INDEX v2_artwork_assignments_org_successor_idx
  ON v2_artwork_assignments(organization_id, supersedes_artwork_assignment_id)
  WHERE supersedes_artwork_assignment_id IS NOT NULL;

CREATE OR REPLACE FUNCTION v2_artwork_assignment_replacement_validate() RETURNS trigger AS $$
DECLARE previous_assignment record;
BEGIN
  IF NEW.supersedes_artwork_assignment_id IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'Artwork replacement lineage is append-only' USING ERRCODE='23514';
  END IF;
  IF NEW.supersedes_artwork_assignment_id = NEW.id THEN
    RAISE EXCEPTION 'Artwork assignment cannot supersede itself' USING ERRCODE='23514';
  END IF;

  SELECT * INTO previous_assignment
  FROM v2_artwork_assignments
  WHERE organization_id=NEW.organization_id
    AND id=NEW.supersedes_artwork_assignment_id;

  IF NOT FOUND
    OR previous_assignment.order_document_id IS DISTINCT FROM NEW.order_document_id
    OR previous_assignment.order_line_id IS DISTINCT FROM NEW.order_line_id
    OR previous_assignment.purpose <> 'customer_supplied'
    OR NEW.purpose <> 'customer_supplied'
    OR previous_assignment.side IS DISTINCT FROM NEW.side
    OR previous_assignment.source_page_index IS DISTINCT FROM NEW.source_page_index
    OR previous_assignment.layer_key IS DISTINCT FROM NEW.layer_key
    OR previous_assignment.layer_order IS DISTINCT FROM NEW.layer_order
    OR NEW.source_quote_accepted_artwork_snapshot_id IS NOT NULL
  THEN
    RAISE EXCEPTION 'Artwork replacement must preserve one current customer-supplied Order-line slot' USING ERRCODE='23514';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM v2_sales_order_details
    WHERE organization_id=NEW.organization_id
      AND document_id=NEW.order_document_id
      AND commercial_state='open'
  ) THEN
    RAISE EXCEPTION 'Artwork replacement requires an open Order' USING ERRCODE='23514';
  END IF;

  -- Historical workflow evidence is pinned to its original assignment.  A
  -- later replacement remains a new current choice; it cannot rewrite or
  -- retroactively alter a proof, Prepress unit, or Production work.
  IF EXISTS (SELECT 1 FROM v2_proof_version_artwork WHERE organization_id=NEW.organization_id AND artwork_assignment_id=previous_assignment.id)
    OR EXISTS (SELECT 1 FROM v2_prepress_units WHERE organization_id=NEW.organization_id AND artwork_assignment_id=previous_assignment.id)
    OR EXISTS (SELECT 1 FROM v2_production_works WHERE organization_id=NEW.organization_id AND artwork_assignment_id=previous_assignment.id)
  THEN
    RAISE EXCEPTION 'Artwork with downstream workflow evidence cannot be replaced' USING ERRCODE='23514';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER v2_artwork_assignment_replacement_validate_trigger
  BEFORE INSERT OR UPDATE OF supersedes_artwork_assignment_id
  ON v2_artwork_assignments
  FOR EACH ROW EXECUTE FUNCTION v2_artwork_assignment_replacement_validate();
