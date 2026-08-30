-- Follow-up to 0244: keep regular adoption idempotent while requiring a
-- distinct customer-supplied file to explicitly supersede the current
-- Order-line slot. This makes the append-only replacement chain the sole
-- current-artwork authority without changing accepted Quote evidence.

CREATE OR REPLACE FUNCTION v2_artwork_assignment_replacement_validate() RETURNS trigger AS $$
DECLARE previous_assignment record;
BEGIN
  IF NEW.supersedes_artwork_assignment_id IS NULL THEN
    IF NEW.purpose = 'customer_supplied' AND EXISTS (
      SELECT 1
      FROM v2_artwork_assignments current_assignment
      WHERE current_assignment.organization_id = NEW.organization_id
        AND current_assignment.order_document_id IS NOT DISTINCT FROM NEW.order_document_id
        AND current_assignment.order_line_id IS NOT DISTINCT FROM NEW.order_line_id
        AND current_assignment.purpose = NEW.purpose
        AND current_assignment.side IS NOT DISTINCT FROM NEW.side
        AND current_assignment.source_page_index IS NOT DISTINCT FROM NEW.source_page_index
        AND current_assignment.layer_key IS NOT DISTINCT FROM NEW.layer_key
        AND current_assignment.layer_order IS NOT DISTINCT FROM NEW.layer_order
        AND current_assignment.artwork_file_id IS DISTINCT FROM NEW.artwork_file_id
        AND NOT EXISTS (
          SELECT 1 FROM v2_artwork_assignments successor_assignment
          WHERE successor_assignment.organization_id = current_assignment.organization_id
            AND successor_assignment.supersedes_artwork_assignment_id = current_assignment.id
        )
    ) THEN
      RAISE EXCEPTION 'Artwork replacement must explicitly supersede the current customer-supplied Order-line slot' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  END IF;
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

  IF EXISTS (SELECT 1 FROM v2_proof_version_artwork WHERE organization_id=NEW.organization_id AND artwork_assignment_id=previous_assignment.id)
    OR EXISTS (SELECT 1 FROM v2_prepress_units WHERE organization_id=NEW.organization_id AND artwork_assignment_id=previous_assignment.id)
    OR EXISTS (SELECT 1 FROM v2_production_works WHERE organization_id=NEW.organization_id AND artwork_assignment_id=previous_assignment.id)
  THEN
    RAISE EXCEPTION 'Artwork with downstream workflow evidence cannot be replaced' USING ERRCODE='23514';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
