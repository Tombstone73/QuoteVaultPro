-- M2.1: Proofing owns an immutable review/version history for legitimate
-- OrderLine work. It references Artwork assignments; it owns neither files
-- nor Routing position.

ALTER TABLE v2_artwork_assignments
  ADD CONSTRAINT v2_artwork_assignments_id_org_file_uidx UNIQUE (id, organization_id, artwork_file_id);

CREATE TABLE v2_proof_works (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  order_document_id varchar NOT NULL,
  order_line_id varchar NOT NULL,
  created_principal_kind varchar(32) NOT NULL,
  created_principal_subject varchar(255) NOT NULL,
  created_staff_actor_user_id varchar REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT v2_proof_works_principal_kind_chk CHECK (created_principal_kind IN ('staff','delegated_ai','portal','service')),
  CONSTRAINT v2_proof_works_subject_chk CHECK (length(btrim(created_principal_subject)) > 0),
  CONSTRAINT v2_proof_works_id_organization_uidx UNIQUE (id, organization_id),
  -- Version history is the durable history: one work identity per OrderLine.
  CONSTRAINT v2_proof_works_order_line_uidx UNIQUE (organization_id, order_line_id),
  CONSTRAINT v2_proof_works_order_tenant_fk FOREIGN KEY (order_document_id, organization_id)
    REFERENCES v2_sales_order_details(document_id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT v2_proof_works_order_line_tenant_fk FOREIGN KEY (order_line_id, organization_id, order_document_id)
    REFERENCES v2_sales_document_lines(id, organization_id, document_id) ON DELETE RESTRICT
);

CREATE TABLE v2_proof_versions (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  proof_work_id varchar NOT NULL,
  sequence integer NOT NULL,
  created_principal_kind varchar(32) NOT NULL,
  created_principal_subject varchar(255) NOT NULL,
  created_staff_actor_user_id varchar REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  issued_at timestamptz,
  issued_principal_kind varchar(32),
  issued_principal_subject varchar(255),
  issued_staff_actor_user_id varchar REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT v2_proof_versions_sequence_chk CHECK (sequence > 0),
  CONSTRAINT v2_proof_versions_created_principal_kind_chk CHECK (created_principal_kind IN ('staff','delegated_ai','portal','service')),
  CONSTRAINT v2_proof_versions_created_subject_chk CHECK (length(btrim(created_principal_subject)) > 0),
  CONSTRAINT v2_proof_versions_issued_principal_kind_chk CHECK (issued_principal_kind IS NULL OR issued_principal_kind IN ('staff','delegated_ai','portal','service')),
  CONSTRAINT v2_proof_versions_issued_tuple_chk CHECK (
    (issued_at IS NULL AND issued_principal_kind IS NULL AND issued_principal_subject IS NULL AND issued_staff_actor_user_id IS NULL)
    OR (issued_at IS NOT NULL AND issued_principal_kind IS NOT NULL AND length(btrim(issued_principal_subject)) > 0)
  ),
  CONSTRAINT v2_proof_versions_id_organization_uidx UNIQUE (id, organization_id),
  CONSTRAINT v2_proof_versions_work_sequence_uidx UNIQUE (organization_id, proof_work_id, sequence),
  CONSTRAINT v2_proof_versions_work_tenant_fk FOREIGN KEY (proof_work_id, organization_id)
    REFERENCES v2_proof_works(id, organization_id) ON DELETE RESTRICT
);

CREATE TABLE v2_proof_version_artwork (
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  proof_version_id varchar NOT NULL,
  position integer NOT NULL,
  artwork_assignment_id varchar NOT NULL,
  artwork_file_id varchar NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT v2_proof_version_artwork_position_chk CHECK (position >= 0),
  CONSTRAINT v2_proof_version_artwork_id_uidx UNIQUE (organization_id, proof_version_id, position),
  CONSTRAINT v2_proof_version_artwork_version_tenant_fk FOREIGN KEY (proof_version_id, organization_id)
    REFERENCES v2_proof_versions(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT v2_proof_version_artwork_assignment_file_tenant_fk FOREIGN KEY (artwork_assignment_id, organization_id, artwork_file_id)
    REFERENCES v2_artwork_assignments(id, organization_id, artwork_file_id) ON DELETE RESTRICT
);

-- A cross-table comparison is needed to prove the presented assignment is for
-- the same OrderLine as the proof work; a normal composite FK cannot span
-- both parent relationships.
CREATE OR REPLACE FUNCTION v2_proof_version_artwork_validate() RETURNS trigger AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM v2_proof_versions v
    JOIN v2_proof_works w ON w.id=v.proof_work_id AND w.organization_id=v.organization_id
    JOIN v2_artwork_assignments a ON a.id=NEW.artwork_assignment_id AND a.organization_id=NEW.organization_id
    WHERE v.id=NEW.proof_version_id AND v.organization_id=NEW.organization_id
      AND (a.order_document_id <> w.order_document_id OR a.order_line_id <> w.order_line_id)
  ) THEN RAISE EXCEPTION 'Proof Artwork must belong to the Proof Work OrderLine' USING ERRCODE='23514'; END IF;
  IF TG_OP <> 'INSERT' AND EXISTS (SELECT 1 FROM v2_proof_versions WHERE id=OLD.proof_version_id AND organization_id=OLD.organization_id AND issued_at IS NOT NULL) THEN
    RAISE EXCEPTION 'Issued Proof Version Artwork is immutable' USING ERRCODE='23514';
  END IF;
  IF TG_OP = 'INSERT' AND EXISTS (SELECT 1 FROM v2_proof_versions WHERE id=NEW.proof_version_id AND organization_id=NEW.organization_id AND issued_at IS NOT NULL) THEN
    RAISE EXCEPTION 'Issued Proof Version Artwork is immutable' USING ERRCODE='23514';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER v2_proof_version_artwork_validate_trigger
  BEFORE INSERT OR UPDATE OR DELETE ON v2_proof_version_artwork
  FOR EACH ROW EXECUTE FUNCTION v2_proof_version_artwork_validate();

CREATE TABLE v2_proof_responses (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  proof_version_id varchar NOT NULL,
  outcome varchar(32) NOT NULL,
  comment text,
  response_origin varchar(32) NOT NULL,
  recorded_customer_id varchar,
  responder_principal_kind varchar(32) NOT NULL,
  responder_principal_subject varchar(255) NOT NULL,
  responder_staff_actor_user_id varchar REFERENCES users(id) ON DELETE RESTRICT,
  responded_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT v2_proof_responses_outcome_chk CHECK (outcome IN ('approved','revision_requested')),
  CONSTRAINT v2_proof_responses_comment_chk CHECK (comment IS NULL OR length(btrim(comment)) > 0),
  CONSTRAINT v2_proof_responses_origin_chk CHECK (response_origin IN ('direct','staff_recorded_customer')),
  CONSTRAINT v2_proof_responses_origin_customer_chk CHECK (
    (response_origin='direct' AND recorded_customer_id IS NULL)
    OR (response_origin='staff_recorded_customer' AND recorded_customer_id IS NOT NULL)
  ),
  CONSTRAINT v2_proof_responses_principal_kind_chk CHECK (responder_principal_kind IN ('staff','delegated_ai','portal','service')),
  CONSTRAINT v2_proof_responses_subject_chk CHECK (length(btrim(responder_principal_subject)) > 0),
  CONSTRAINT v2_proof_responses_version_uidx UNIQUE (organization_id, proof_version_id),
  CONSTRAINT v2_proof_responses_version_tenant_fk FOREIGN KEY (proof_version_id, organization_id)
    REFERENCES v2_proof_versions(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT v2_proof_responses_recorded_customer_tenant_fk FOREIGN KEY (recorded_customer_id, organization_id)
    REFERENCES customers(id, organization_id) ON DELETE RESTRICT
);

-- Issuance is one-way and responses are historical facts. This protects future
-- writers that do not go through the application service.
CREATE OR REPLACE FUNCTION v2_proof_version_immutable_validate() RETURNS trigger AS $$
BEGIN
  IF OLD.issued_at IS NOT NULL AND (NEW.issued_at IS DISTINCT FROM OLD.issued_at OR NEW.issued_principal_kind IS DISTINCT FROM OLD.issued_principal_kind OR NEW.issued_principal_subject IS DISTINCT FROM OLD.issued_principal_subject OR NEW.issued_staff_actor_user_id IS DISTINCT FROM OLD.issued_staff_actor_user_id) THEN
    RAISE EXCEPTION 'Proof issuance is immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER v2_proof_version_immutable_validate_trigger BEFORE UPDATE ON v2_proof_versions FOR EACH ROW EXECUTE FUNCTION v2_proof_version_immutable_validate();
CREATE OR REPLACE FUNCTION v2_proof_response_immutable_validate() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'Proof responses are immutable' USING ERRCODE='23514'; END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER v2_proof_response_immutable_validate_trigger BEFORE UPDATE OR DELETE ON v2_proof_responses FOR EACH ROW EXECUTE FUNCTION v2_proof_response_immutable_validate();

CREATE INDEX v2_proof_works_org_order_line_idx ON v2_proof_works(organization_id, order_line_id);
CREATE INDEX v2_proof_versions_org_work_sequence_idx ON v2_proof_versions(organization_id, proof_work_id, sequence DESC);
CREATE INDEX v2_proof_responses_org_version_idx ON v2_proof_responses(organization_id, proof_version_id);

INSERT INTO v2_permission_capabilities(id,module,label) VALUES
  ('proof.view','proofing','View proof work and proof history'),
  ('proof.prepare','proofing','Start proof work and create proof versions'),
  ('proof.issue','proofing','Issue proof versions for response')
ON CONFLICT(id) DO NOTHING;
INSERT INTO v2_permission_set_template_capabilities(template_id,capability_id)
SELECT id, capability_id FROM v2_permission_set_templates
CROSS JOIN (VALUES ('proof.view'),('proof.prepare'),('proof.issue'),('proof.respond')) AS capability(capability_id)
WHERE template_key IN ('owner','administrator','sales') ON CONFLICT DO NOTHING;
