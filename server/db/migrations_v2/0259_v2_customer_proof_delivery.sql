-- M6: customer proof delivery is an extension of canonical V2 Proofing.
-- The exact issued Proof Version remains the review identity; delivery state
-- is operational evidence and never substitutes for a customer decision.
CREATE TABLE v2_proof_delivery_jobs (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  proof_version_id varchar NOT NULL,
  recipient_contact_id varchar NOT NULL,
  recipient_email varchar(320) NOT NULL,
  recipient_name varchar(255),
  portal_access_id varchar NOT NULL,
  state varchar(20) NOT NULL DEFAULT 'queued'
    CHECK (state IN ('queued','processing','retry_wait','sent','failed','ambiguous')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  available_at timestamptz NOT NULL DEFAULT now(),
  claimed_by varchar,
  lease_expires_at timestamptz,
  provider_attempted_at timestamptz,
  provider_message_id varchar,
  last_error text,
  delivered_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT v2_proof_delivery_version_tenant_fk
    FOREIGN KEY (proof_version_id, organization_id)
    REFERENCES v2_proof_versions(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT v2_proof_delivery_contact_tenant_fk
    FOREIGN KEY (recipient_contact_id, organization_id)
    REFERENCES customer_contacts(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT v2_proof_delivery_portal_access_tenant_fk
    FOREIGN KEY (portal_access_id, organization_id)
    REFERENCES customer_portal_access(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT v2_proof_delivery_version_uidx UNIQUE (organization_id, proof_version_id)
);

CREATE INDEX v2_proof_delivery_claim_idx
  ON v2_proof_delivery_jobs(state, available_at, created_at);
CREATE INDEX v2_proof_delivery_org_state_idx
  ON v2_proof_delivery_jobs(organization_id, state, created_at DESC);

-- A prior Proof Version is immutable evidence, not a reason to freeze the
-- current Order artwork slot forever. A replacement remains append-only and
-- is still forbidden after Prepress or Production has consumed that slot.
CREATE OR REPLACE FUNCTION v2_artwork_assignment_replacement_validate() RETURNS trigger AS $$
DECLARE previous_assignment record;
BEGIN
  IF NEW.supersedes_artwork_assignment_id IS NULL THEN
    IF NEW.purpose='customer_supplied' AND EXISTS (
      SELECT 1 FROM v2_artwork_assignments current_assignment
      WHERE current_assignment.organization_id=NEW.organization_id
        AND current_assignment.order_document_id IS NOT DISTINCT FROM NEW.order_document_id
        AND current_assignment.order_line_id IS NOT DISTINCT FROM NEW.order_line_id
        AND current_assignment.purpose=NEW.purpose
        AND current_assignment.side IS NOT DISTINCT FROM NEW.side
        AND current_assignment.source_page_index IS NOT DISTINCT FROM NEW.source_page_index
        AND current_assignment.layer_key IS NOT DISTINCT FROM NEW.layer_key
        AND current_assignment.layer_order IS NOT DISTINCT FROM NEW.layer_order
        AND current_assignment.artwork_file_id IS DISTINCT FROM NEW.artwork_file_id
        AND NOT EXISTS (SELECT 1 FROM v2_artwork_assignments successor WHERE successor.organization_id=current_assignment.organization_id AND successor.supersedes_artwork_assignment_id=current_assignment.id)
    ) THEN RAISE EXCEPTION 'Artwork replacement must explicitly supersede the current customer-supplied Order-line slot' USING ERRCODE='23514'; END IF;
    RETURN NEW;
  END IF;
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

-- Authenticated portal customers need a distinct read capability in addition
-- to the existing proof.respond mutation capability.
INSERT INTO v2_permission_set_template_capabilities(template_id, capability_id)
SELECT t.id, 'proof.view' FROM v2_permission_set_templates t
WHERE t.template_key='customer_full_portal'
ON CONFLICT DO NOTHING;

INSERT INTO v2_permission_set_capabilities(organization_id, permission_set_id, capability_id)
SELECT ps.organization_id, ps.id, 'proof.view'
FROM v2_permission_sets ps
WHERE ps.source_template_key='customer_full_portal'
ON CONFLICT DO NOTHING;

INSERT INTO v2_organization_portal_capability_defaults(organization_id, capability_id)
SELECT id, 'proof.view' FROM organizations
ON CONFLICT DO NOTHING;

UPDATE v2_permission_organization_state
SET authority_revision=authority_revision+1, updated_at=now();
