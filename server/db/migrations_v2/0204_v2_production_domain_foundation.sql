-- M2.3: Production owns execution attempts for frozen, independently
-- required production units. It owns neither files, Routing, nor Fulfillment.

CREATE TABLE v2_production_works (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  order_document_id varchar NOT NULL,
  order_line_id varchar NOT NULL,
  requirement_key varchar(120) NOT NULL,
  artwork_assignment_id varchar NOT NULL,
  artwork_file_id varchar NOT NULL,
  prepress_unit_id varchar,
  side varchar(16), source_page_index integer, layer_key varchar(160), layer_order integer,
  ordered_quantity integer NOT NULL,
  created_principal_kind varchar(32) NOT NULL, created_principal_subject varchar(255) NOT NULL,
  created_staff_actor_user_id varchar REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT v2_production_works_id_org_uidx UNIQUE(id,organization_id),
  CONSTRAINT v2_production_works_assignment_uidx UNIQUE(organization_id,artwork_assignment_id),
  CONSTRAINT v2_production_works_requirement_uidx UNIQUE(organization_id,order_line_id,requirement_key,artwork_assignment_id),
  CONSTRAINT v2_production_works_order_tenant_fk FOREIGN KEY(order_document_id,organization_id) REFERENCES v2_sales_order_details(document_id,organization_id) ON DELETE RESTRICT,
  CONSTRAINT v2_production_works_line_tenant_fk FOREIGN KEY(order_line_id,organization_id,order_document_id) REFERENCES v2_sales_document_lines(id,organization_id,document_id) ON DELETE RESTRICT,
  CONSTRAINT v2_production_works_requirement_tenant_fk FOREIGN KEY(organization_id,order_line_id,requirement_key) REFERENCES v2_sales_line_production_requirements(organization_id,order_line_id,requirement_key) ON DELETE RESTRICT,
  CONSTRAINT v2_production_works_assignment_file_tenant_fk FOREIGN KEY(artwork_assignment_id,organization_id,artwork_file_id) REFERENCES v2_artwork_assignments(id,organization_id,artwork_file_id) ON DELETE RESTRICT,
  CONSTRAINT v2_production_works_prepress_tenant_fk FOREIGN KEY(prepress_unit_id,organization_id) REFERENCES v2_prepress_units(id,organization_id) ON DELETE RESTRICT,
  CONSTRAINT v2_production_works_side_chk CHECK(side IS NULL OR side IN ('front','back')),
  CONSTRAINT v2_production_works_page_chk CHECK(source_page_index IS NULL OR source_page_index>=0),
  CONSTRAINT v2_production_works_layer_chk CHECK((layer_key IS NULL AND layer_order IS NULL) OR (layer_key IS NOT NULL AND length(btrim(layer_key))>0 AND layer_order IS NOT NULL AND layer_order>=0)),
  CONSTRAINT v2_production_works_quantity_chk CHECK(ordered_quantity>0),
  CONSTRAINT v2_production_works_actor_chk CHECK(created_principal_kind IN ('staff','delegated_ai','portal','service') AND length(btrim(created_principal_subject))>0)
);

CREATE TABLE v2_production_attempts (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  production_work_id varchar NOT NULL,
  sequence integer NOT NULL,
  attempt_kind varchar(24) NOT NULL,
  station_key varchar(32) NOT NULL,
  good_quantity integer NOT NULL DEFAULT 0,
  waste_quantity integer NOT NULL DEFAULT 0,
  started_at timestamptz NOT NULL DEFAULT now(),
  started_principal_kind varchar(32) NOT NULL, started_principal_subject varchar(255) NOT NULL,
  started_staff_actor_user_id varchar REFERENCES users(id) ON DELETE RESTRICT,
  completed_at timestamptz,
  completed_principal_kind varchar(32), completed_principal_subject varchar(255),
  completed_staff_actor_user_id varchar REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT v2_production_attempts_id_org_uidx UNIQUE(id,organization_id),
  CONSTRAINT v2_production_attempts_sequence_uidx UNIQUE(organization_id,production_work_id,sequence),
  CONSTRAINT v2_production_attempts_work_tenant_fk FOREIGN KEY(production_work_id,organization_id) REFERENCES v2_production_works(id,organization_id) ON DELETE RESTRICT,
  CONSTRAINT v2_production_attempts_sequence_chk CHECK(sequence>0),
  CONSTRAINT v2_production_attempts_kind_chk CHECK(attempt_kind IN ('initial','reprint','correction')),
  CONSTRAINT v2_production_attempts_station_chk CHECK(station_key IN ('flatbed','roll')),
  CONSTRAINT v2_production_attempts_quantity_chk CHECK(good_quantity>=0 AND waste_quantity>=0),
  CONSTRAINT v2_production_attempts_started_actor_chk CHECK(started_principal_kind IN ('staff','delegated_ai','portal','service') AND length(btrim(started_principal_subject))>0),
  CONSTRAINT v2_production_attempts_completed_actor_chk CHECK((completed_at IS NULL AND completed_principal_kind IS NULL AND completed_principal_subject IS NULL AND completed_staff_actor_user_id IS NULL) OR (completed_at IS NOT NULL AND completed_principal_kind IN ('staff','delegated_ai','portal','service') AND length(btrim(completed_principal_subject))>0))
);
CREATE UNIQUE INDEX v2_production_attempts_one_active_uidx ON v2_production_attempts(organization_id,production_work_id) WHERE completed_at IS NULL;
CREATE INDEX v2_production_works_org_line_idx ON v2_production_works(organization_id,order_line_id,created_at);
CREATE INDEX v2_production_attempts_org_work_idx ON v2_production_attempts(organization_id,production_work_id,sequence);

-- Exact evidence is physically checked so raw SQL cannot point a work at a
-- different line, requirement, or non-production Artwork. Completed attempts
-- are durable history and cannot be rewritten or deleted.
CREATE OR REPLACE FUNCTION v2_production_validate() RETURNS trigger AS $$
DECLARE a record; req record; pu record;
BEGIN
  IF TG_TABLE_NAME='v2_production_works' THEN
    IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Production work is operational history and cannot be deleted' USING ERRCODE='23514'; END IF;
    SELECT * INTO a FROM v2_artwork_assignments WHERE organization_id=NEW.organization_id AND id=NEW.artwork_assignment_id;
    SELECT * INTO req FROM v2_sales_line_production_requirements WHERE organization_id=NEW.organization_id AND order_line_id=NEW.order_line_id AND requirement_key=NEW.requirement_key;
    IF NOT FOUND OR a.purpose<>'production' OR a.order_document_id<>NEW.order_document_id OR a.order_line_id<>NEW.order_line_id OR a.artwork_file_id<>NEW.artwork_file_id OR a.side IS DISTINCT FROM NEW.side OR a.source_page_index IS DISTINCT FROM NEW.source_page_index OR a.layer_key IS DISTINCT FROM NEW.layer_key OR a.layer_order IS DISTINCT FROM NEW.layer_order OR req.side IS DISTINCT FROM NEW.side OR req.source_page_index IS DISTINCT FROM NEW.source_page_index OR req.layer_key IS DISTINCT FROM NEW.layer_key OR req.layer_order IS DISTINCT FROM NEW.layer_order THEN RAISE EXCEPTION 'Production work must snapshot exact required production Artwork evidence' USING ERRCODE='23514'; END IF;
    IF NEW.prepress_unit_id IS NOT NULL THEN SELECT * INTO pu FROM v2_prepress_units WHERE organization_id=NEW.organization_id AND id=NEW.prepress_unit_id; IF NOT FOUND OR pu.artwork_assignment_id<>NEW.artwork_assignment_id OR pu.completed_at IS NULL THEN RAISE EXCEPTION 'Production work Prepress evidence must be completed for the same Artwork assignment' USING ERRCODE='23514'; END IF; END IF;
    IF TG_OP='UPDATE' THEN RAISE EXCEPTION 'Production work evidence is immutable' USING ERRCODE='23514'; END IF;
  ELSE
    IF TG_OP='DELETE' AND OLD.completed_at IS NOT NULL THEN RAISE EXCEPTION 'Completed Production attempt is immutable' USING ERRCODE='23514'; END IF;
    IF TG_OP='UPDATE' AND OLD.completed_at IS NOT NULL THEN RAISE EXCEPTION 'Completed Production attempt is immutable' USING ERRCODE='23514'; END IF;
    IF TG_OP='UPDATE' AND (NEW.organization_id IS DISTINCT FROM OLD.organization_id OR NEW.production_work_id IS DISTINCT FROM OLD.production_work_id OR NEW.sequence IS DISTINCT FROM OLD.sequence OR NEW.attempt_kind IS DISTINCT FROM OLD.attempt_kind OR NEW.station_key IS DISTINCT FROM OLD.station_key OR NEW.started_at IS DISTINCT FROM OLD.started_at OR NEW.started_principal_kind IS DISTINCT FROM OLD.started_principal_kind OR NEW.started_principal_subject IS DISTINCT FROM OLD.started_principal_subject OR NEW.started_staff_actor_user_id IS DISTINCT FROM OLD.started_staff_actor_user_id) THEN RAISE EXCEPTION 'Production attempt start evidence is immutable' USING ERRCODE='23514'; END IF;
  END IF;
  RETURN COALESCE(NEW,OLD);
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER v2_production_work_validate_trigger BEFORE INSERT OR UPDATE OR DELETE ON v2_production_works FOR EACH ROW EXECUTE FUNCTION v2_production_validate();
CREATE TRIGGER v2_production_attempt_validate_trigger BEFORE INSERT OR UPDATE OR DELETE ON v2_production_attempts FOR EACH ROW EXECUTE FUNCTION v2_production_validate();

INSERT INTO v2_permission_capabilities(id,module,label) VALUES
 ('production.view','production','View Production work and attempt history'),('production.work','production','Open work, start attempts, and record output'),('production.complete','production','Complete Production attempts') ON CONFLICT(id) DO NOTHING;
INSERT INTO v2_permission_set_template_capabilities(template_id,capability_id)
SELECT id,capability_id FROM v2_permission_set_templates CROSS JOIN (VALUES('production.view'),('production.work'),('production.complete')) v(capability_id) WHERE template_key IN ('owner','administrator') ON CONFLICT DO NOTHING;
