-- Ordinary adoption is additive, including files with the same purpose/side.
-- Supersession exists only when the caller explicitly names a predecessor.
-- Keep the 0259 explicit-replacement rules and all identity/tenant/one-successor
-- constraints intact. No rows or historical lineage are rewritten.
CREATE OR REPLACE FUNCTION v2_artwork_assignment_replacement_validate() RETURNS trigger AS $$
DECLARE previous_assignment record;
BEGIN
  IF NEW.supersedes_artwork_assignment_id IS NULL THEN RETURN NEW; END IF;
  IF TG_OP='UPDATE' THEN RAISE EXCEPTION 'Artwork replacement lineage is append-only' USING ERRCODE='23514'; END IF;
  IF NEW.supersedes_artwork_assignment_id=NEW.id THEN RAISE EXCEPTION 'Artwork assignment cannot supersede itself' USING ERRCODE='23514'; END IF;
  SELECT * INTO previous_assignment FROM v2_artwork_assignments WHERE organization_id=NEW.organization_id AND id=NEW.supersedes_artwork_assignment_id;
  IF NOT FOUND
    OR previous_assignment.order_document_id IS DISTINCT FROM NEW.order_document_id
    OR previous_assignment.order_line_id IS DISTINCT FROM NEW.order_line_id
    OR previous_assignment.purpose<>'customer_supplied' OR NEW.purpose<>'customer_supplied'
    OR previous_assignment.side IS DISTINCT FROM NEW.side
    OR previous_assignment.source_page_index IS DISTINCT FROM NEW.source_page_index
    OR previous_assignment.layer_key IS DISTINCT FROM NEW.layer_key
    OR previous_assignment.layer_order IS DISTINCT FROM NEW.layer_order
    OR NEW.source_quote_accepted_artwork_snapshot_id IS NOT NULL
  THEN RAISE EXCEPTION 'Artwork replacement must preserve one current customer-supplied Order-line slot' USING ERRCODE='23514'; END IF;
  IF NOT EXISTS (SELECT 1 FROM v2_sales_order_details WHERE organization_id=NEW.organization_id AND document_id=NEW.order_document_id AND commercial_state='open')
  THEN RAISE EXCEPTION 'Artwork replacement requires an open Order' USING ERRCODE='23514'; END IF;
  IF EXISTS (SELECT 1 FROM v2_proof_version_artwork WHERE organization_id=NEW.organization_id AND artwork_assignment_id=previous_assignment.id)
    AND NOT EXISTS (
      SELECT 1 FROM v2_proof_version_artwork proof_art
      JOIN v2_proof_versions proof_version ON proof_version.organization_id=proof_art.organization_id AND proof_version.id=proof_art.proof_version_id
      JOIN v2_proof_responses proof_response ON proof_response.organization_id=proof_version.organization_id AND proof_response.proof_version_id=proof_version.id AND proof_response.outcome='revision_requested'
      JOIN v2_proof_works proof_work ON proof_work.organization_id=proof_version.organization_id AND proof_work.id=proof_version.proof_work_id
      WHERE proof_art.organization_id=NEW.organization_id AND proof_art.artwork_assignment_id=previous_assignment.id
        AND proof_version.id=(SELECT latest.id FROM v2_proof_versions latest WHERE latest.organization_id=proof_version.organization_id AND latest.proof_work_id=proof_work.id ORDER BY latest.sequence DESC LIMIT 1)
    )
  THEN RAISE EXCEPTION 'Proof-bound artwork can be replaced only after the current Proof requests changes' USING ERRCODE='23514'; END IF;
  IF EXISTS (SELECT 1 FROM v2_prepress_units WHERE organization_id=NEW.organization_id AND artwork_assignment_id=previous_assignment.id)
    OR EXISTS (SELECT 1 FROM v2_production_works WHERE organization_id=NEW.organization_id AND artwork_assignment_id=previous_assignment.id)
  THEN RAISE EXCEPTION 'Artwork with downstream workflow evidence cannot be replaced' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
