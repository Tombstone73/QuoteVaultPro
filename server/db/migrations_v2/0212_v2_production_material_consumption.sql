-- P7C: immutable Production facts. These are not inventory reservations or stock movements.
ALTER TABLE v2_order_line_material_requirements
  ADD CONSTRAINT v2_order_line_material_requirements_id_org_uidx UNIQUE (id, organization_id);

CREATE TABLE v2_production_material_consumptions (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  order_document_id varchar NOT NULL,
  order_line_id varchar NOT NULL,
  production_work_id varchar NOT NULL,
  production_attempt_id varchar NOT NULL,
  material_requirement_id varchar,
  material_id varchar NOT NULL REFERENCES materials(id) ON DELETE RESTRICT,
  material_name_snapshot varchar NOT NULL,
  material_sku_snapshot varchar,
  quantity numeric(18,6) NOT NULL CHECK(quantity>0),
  quantity_unit varchar NOT NULL CHECK(quantity_unit IN ('each','square_foot','linear_foot','sheet','roll')),
  consumption_kind varchar NOT NULL CHECK(consumption_kind IN ('consumed','waste','correction')),
  corrects_consumption_id varchar,
  operation_request_id varchar NOT NULL REFERENCES v2_operation_requests(id) ON DELETE RESTRICT,
  created_principal_kind varchar(32) NOT NULL,
  created_principal_subject varchar(255) NOT NULL,
  created_staff_actor_user_id varchar REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT v2_production_material_consumptions_id_org_uidx UNIQUE(id,organization_id),
  CONSTRAINT v2_production_material_consumptions_line_fk FOREIGN KEY(order_line_id,organization_id,order_document_id) REFERENCES v2_sales_document_lines(id,organization_id,document_id) ON DELETE RESTRICT,
  CONSTRAINT v2_production_material_consumptions_work_fk FOREIGN KEY(production_work_id,organization_id) REFERENCES v2_production_works(id,organization_id) ON DELETE RESTRICT,
  CONSTRAINT v2_production_material_consumptions_attempt_fk FOREIGN KEY(production_attempt_id,organization_id) REFERENCES v2_production_attempts(id,organization_id) ON DELETE RESTRICT,
  CONSTRAINT v2_production_material_consumptions_requirement_fk FOREIGN KEY(material_requirement_id,organization_id) REFERENCES v2_order_line_material_requirements(id,organization_id) ON DELETE RESTRICT,
  CONSTRAINT v2_production_material_consumptions_correction_fk FOREIGN KEY(corrects_consumption_id,organization_id) REFERENCES v2_production_material_consumptions(id,organization_id) ON DELETE RESTRICT,
  CONSTRAINT v2_production_material_consumptions_correction_shape_chk CHECK((consumption_kind='correction' AND corrects_consumption_id IS NOT NULL) OR (consumption_kind<>'correction' AND corrects_consumption_id IS NULL)),
  CONSTRAINT v2_production_material_consumptions_actor_chk CHECK(created_principal_kind IN ('staff','delegated_ai','portal','service') AND length(btrim(created_principal_subject))>0)
);
CREATE INDEX v2_production_material_consumptions_work_idx ON v2_production_material_consumptions(organization_id,production_work_id,created_at);
CREATE INDEX v2_production_material_consumptions_line_idx ON v2_production_material_consumptions(organization_id,order_line_id,created_at);

CREATE OR REPLACE FUNCTION v2_production_material_consumption_validate() RETURNS trigger AS $$
DECLARE work_row record; attempt_row record; requirement_row record; material_row record; original_row record; corrected numeric;
BEGIN
  IF TG_OP IN ('UPDATE','DELETE') THEN RAISE EXCEPTION 'Production material consumption is immutable; record a correction instead' USING ERRCODE='23514'; END IF;
  SELECT * INTO work_row FROM v2_production_works WHERE id=NEW.production_work_id AND organization_id=NEW.organization_id;
  SELECT * INTO attempt_row FROM v2_production_attempts WHERE id=NEW.production_attempt_id AND organization_id=NEW.organization_id;
  SELECT * INTO material_row FROM materials WHERE id=NEW.material_id AND organization_id=NEW.organization_id;
  IF NOT FOUND OR material_row IS NULL THEN RAISE EXCEPTION 'Production material must belong to the organization' USING ERRCODE='23514'; END IF;
  IF work_row IS NULL OR work_row.order_document_id<>NEW.order_document_id OR work_row.order_line_id<>NEW.order_line_id THEN RAISE EXCEPTION 'Material consumption must belong to its Production work OrderLine' USING ERRCODE='23514'; END IF;
  IF attempt_row IS NULL OR attempt_row.production_work_id<>NEW.production_work_id THEN RAISE EXCEPTION 'Material consumption attempt must belong to its Production work' USING ERRCODE='23514'; END IF;
  IF NEW.material_requirement_id IS NOT NULL THEN
    SELECT * INTO requirement_row FROM v2_order_line_material_requirements WHERE id=NEW.material_requirement_id AND organization_id=NEW.organization_id;
    IF requirement_row IS NULL OR requirement_row.order_document_id<>NEW.order_document_id OR requirement_row.order_line_id<>NEW.order_line_id OR requirement_row.material_id<>NEW.material_id OR requirement_row.quantity_unit<>NEW.quantity_unit THEN RAISE EXCEPTION 'Material requirement must match the same OrderLine, Material, and unit' USING ERRCODE='23514'; END IF;
  END IF;
  IF NEW.consumption_kind='correction' THEN
    SELECT * INTO original_row FROM v2_production_material_consumptions WHERE id=NEW.corrects_consumption_id AND organization_id=NEW.organization_id FOR UPDATE;
    IF original_row IS NULL OR original_row.consumption_kind='correction' OR original_row.production_work_id<>NEW.production_work_id OR original_row.material_id<>NEW.material_id OR original_row.quantity_unit<>NEW.quantity_unit OR original_row.material_requirement_id IS DISTINCT FROM NEW.material_requirement_id THEN RAISE EXCEPTION 'Material correction must reverse one matching original fact' USING ERRCODE='23514'; END IF;
    SELECT COALESCE(sum(quantity),0) INTO corrected FROM v2_production_material_consumptions WHERE organization_id=NEW.organization_id AND corrects_consumption_id=NEW.corrects_consumption_id;
    IF NEW.quantity + corrected > original_row.quantity THEN RAISE EXCEPTION 'Material correction exceeds the remaining original quantity' USING ERRCODE='23514'; END IF;
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER v2_production_material_consumption_validate_trigger BEFORE INSERT OR UPDATE OR DELETE ON v2_production_material_consumptions FOR EACH ROW EXECUTE FUNCTION v2_production_material_consumption_validate();
