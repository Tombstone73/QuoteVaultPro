-- M2.2: Prepress owns independent execution of explicit production Artwork
-- assignments. It deliberately stores no Order/line-wide workflow status and
-- does not create a second Artwork or Routing universe.

CREATE TABLE v2_prepress_units (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  order_document_id varchar NOT NULL,
  order_line_id varchar NOT NULL,
  artwork_assignment_id varchar NOT NULL,
  artwork_file_id varchar NOT NULL,
  side varchar(16),
  source_page_index integer,
  layer_key varchar(160),
  layer_order integer,
  created_principal_kind varchar(32) NOT NULL,
  created_principal_subject varchar(255) NOT NULL,
  created_staff_actor_user_id varchar REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  started_principal_kind varchar(32),
  started_principal_subject varchar(255),
  started_staff_actor_user_id varchar REFERENCES users(id) ON DELETE RESTRICT,
  completed_at timestamptz,
  completed_principal_kind varchar(32),
  completed_principal_subject varchar(255),
  completed_staff_actor_user_id varchar REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT v2_prepress_units_id_organization_uidx UNIQUE (id, organization_id),
  CONSTRAINT v2_prepress_units_assignment_uidx UNIQUE (organization_id, artwork_assignment_id),
  CONSTRAINT v2_prepress_units_side_chk CHECK (side IS NULL OR side IN ('front','back')),
  CONSTRAINT v2_prepress_units_page_chk CHECK (source_page_index IS NULL OR source_page_index >= 0),
  CONSTRAINT v2_prepress_units_layer_chk CHECK ((layer_key IS NULL AND layer_order IS NULL) OR (layer_key IS NOT NULL AND length(btrim(layer_key)) > 0 AND layer_order IS NOT NULL AND layer_order >= 0)),
  CONSTRAINT v2_prepress_units_created_principal_chk CHECK (created_principal_kind IN ('staff','delegated_ai','portal','service') AND length(btrim(created_principal_subject)) > 0),
  CONSTRAINT v2_prepress_units_started_tuple_chk CHECK ((started_at IS NULL AND started_principal_kind IS NULL AND started_principal_subject IS NULL AND started_staff_actor_user_id IS NULL) OR (started_at IS NOT NULL AND started_principal_kind IN ('staff','delegated_ai','portal','service') AND length(btrim(started_principal_subject)) > 0)),
  CONSTRAINT v2_prepress_units_completed_tuple_chk CHECK ((completed_at IS NULL AND completed_principal_kind IS NULL AND completed_principal_subject IS NULL AND completed_staff_actor_user_id IS NULL) OR (completed_at IS NOT NULL AND completed_principal_kind IN ('staff','delegated_ai','portal','service') AND length(btrim(completed_principal_subject)) > 0 AND started_at IS NOT NULL)),
  CONSTRAINT v2_prepress_units_order_tenant_fk FOREIGN KEY (order_document_id, organization_id) REFERENCES v2_sales_order_details(document_id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT v2_prepress_units_order_line_tenant_fk FOREIGN KEY (order_line_id, organization_id, order_document_id) REFERENCES v2_sales_document_lines(id, organization_id, document_id) ON DELETE RESTRICT,
  CONSTRAINT v2_prepress_units_assignment_file_tenant_fk FOREIGN KEY (artwork_assignment_id, organization_id, artwork_file_id) REFERENCES v2_artwork_assignments(id, organization_id, artwork_file_id) ON DELETE RESTRICT
);

-- SQL is required here because an FK cannot verify that all three snapshots
-- belong together or that the referenced Artwork usage is production purpose.
CREATE OR REPLACE FUNCTION v2_prepress_unit_validate() RETURNS trigger AS $$
DECLARE a record;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.completed_at IS NOT NULL THEN RAISE EXCEPTION 'Completed Prepress evidence is immutable' USING ERRCODE='23514'; END IF;
    RETURN OLD;
  END IF;
  SELECT * INTO a FROM v2_artwork_assignments WHERE id=NEW.artwork_assignment_id AND organization_id=NEW.organization_id;
  IF NOT FOUND OR a.purpose <> 'production' OR a.order_document_id <> NEW.order_document_id OR a.order_line_id <> NEW.order_line_id OR a.artwork_file_id <> NEW.artwork_file_id OR a.side IS DISTINCT FROM NEW.side OR a.source_page_index IS DISTINCT FROM NEW.source_page_index OR a.layer_key IS DISTINCT FROM NEW.layer_key OR a.layer_order IS DISTINCT FROM NEW.layer_order THEN
    RAISE EXCEPTION 'Prepress Unit must snapshot one production Artwork assignment for its OrderLine' USING ERRCODE='23514';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.organization_id IS DISTINCT FROM OLD.organization_id OR NEW.order_document_id IS DISTINCT FROM OLD.order_document_id OR NEW.order_line_id IS DISTINCT FROM OLD.order_line_id OR NEW.artwork_assignment_id IS DISTINCT FROM OLD.artwork_assignment_id OR NEW.artwork_file_id IS DISTINCT FROM OLD.artwork_file_id OR NEW.side IS DISTINCT FROM OLD.side OR NEW.source_page_index IS DISTINCT FROM OLD.source_page_index OR NEW.layer_key IS DISTINCT FROM OLD.layer_key OR NEW.layer_order IS DISTINCT FROM OLD.layer_order THEN RAISE EXCEPTION 'Prepress evidence identity is immutable' USING ERRCODE='23514'; END IF;
    IF OLD.started_at IS NOT NULL AND (NEW.started_at IS DISTINCT FROM OLD.started_at OR NEW.started_principal_kind IS DISTINCT FROM OLD.started_principal_kind OR NEW.started_principal_subject IS DISTINCT FROM OLD.started_principal_subject OR NEW.started_staff_actor_user_id IS DISTINCT FROM OLD.started_staff_actor_user_id) THEN RAISE EXCEPTION 'Prepress start is immutable' USING ERRCODE='23514'; END IF;
    IF OLD.completed_at IS NOT NULL THEN RAISE EXCEPTION 'Completed Prepress evidence is immutable' USING ERRCODE='23514'; END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER v2_prepress_unit_validate_trigger BEFORE INSERT OR UPDATE OR DELETE ON v2_prepress_units FOR EACH ROW EXECUTE FUNCTION v2_prepress_unit_validate();

CREATE INDEX v2_prepress_units_org_line_idx ON v2_prepress_units(organization_id, order_line_id, created_at);
CREATE INDEX v2_prepress_units_org_completion_idx ON v2_prepress_units(organization_id, completed_at, created_at);

INSERT INTO v2_permission_capabilities(id,module,label) VALUES
  ('prepress.view','prepress','View Prepress units and completion evidence'),
  ('prepress.work','prepress','Open and start Prepress units'),
  ('prepress.complete','prepress','Complete Prepress units')
ON CONFLICT(id) DO NOTHING;
INSERT INTO v2_permission_set_template_capabilities(template_id,capability_id)
SELECT id, capability_id FROM v2_permission_set_templates
CROSS JOIN (VALUES ('prepress.view'),('prepress.work'),('prepress.complete')) AS capability(capability_id)
WHERE template_key IN ('owner','administrator') ON CONFLICT DO NOTHING;
