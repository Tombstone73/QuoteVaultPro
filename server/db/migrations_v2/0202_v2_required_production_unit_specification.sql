-- M2.2.1: Product/PBV2 resolves requirements; Sales freezes them with its
-- commercial line snapshot. Artwork and Prepress only consume this truth.

ALTER TABLE v2_sales_document_lines
  ADD COLUMN production_requirement_state varchar(24) NOT NULL DEFAULT 'unconfigured',
  ADD COLUMN production_requirement_fingerprint varchar(128);
ALTER TABLE v2_sales_document_lines
  ADD CONSTRAINT v2_sales_document_lines_production_requirement_state_chk CHECK (production_requirement_state IN ('configured','unconfigured')),
  ADD CONSTRAINT v2_sales_document_lines_production_requirement_tuple_chk CHECK (
    (production_requirement_state='configured' AND production_requirement_fingerprint ~ '^sha256:[A-Fa-f0-9]{64}$')
    OR (production_requirement_state='unconfigured' AND production_requirement_fingerprint IS NULL)
  );

CREATE TABLE v2_sales_line_production_requirements (
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  document_id varchar NOT NULL,
  order_line_id varchar NOT NULL,
  requirement_key varchar(120) NOT NULL,
  side varchar(16),
  source_page_index integer,
  layer_key varchar(160),
  layer_order integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT v2_sales_line_production_requirements_key_chk CHECK (requirement_key ~ '^[a-z][a-z0-9_.:-]{0,119}$'),
  CONSTRAINT v2_sales_line_production_requirements_side_chk CHECK (side IS NULL OR side IN ('front','back')),
  CONSTRAINT v2_sales_line_production_requirements_page_chk CHECK (source_page_index IS NULL OR source_page_index >= 0),
  CONSTRAINT v2_sales_line_production_requirements_layer_chk CHECK ((layer_key IS NULL AND layer_order IS NULL) OR (layer_key IS NOT NULL AND length(btrim(layer_key))>0 AND layer_order IS NOT NULL AND layer_order>=0)),
  CONSTRAINT v2_sales_line_production_requirements_identity_uidx UNIQUE (organization_id,order_line_id,requirement_key),
  CONSTRAINT v2_sales_line_production_requirements_line_tenant_fk FOREIGN KEY (order_line_id,organization_id,document_id) REFERENCES v2_sales_document_lines(id,organization_id,document_id) ON DELETE RESTRICT
);
CREATE INDEX v2_sales_line_production_requirements_org_line_idx ON v2_sales_line_production_requirements(organization_id,order_line_id,requirement_key);

-- Requirement replacement is allowed only before the line has gained an
-- operational dependency. This avoids rewriting completed Prepress or frozen
-- Routing history when a Draft Order configuration changes.
CREATE OR REPLACE FUNCTION v2_sales_production_requirement_history_validate() RETURNS trigger AS $$
DECLARE affected_line varchar; affected_org varchar;
BEGIN
  affected_line:=COALESCE(NEW.order_line_id,OLD.order_line_id); affected_org:=COALESCE(NEW.organization_id,OLD.organization_id);
  IF EXISTS (SELECT 1 FROM v2_artwork_assignments WHERE organization_id=affected_org AND order_line_id=affected_line)
     OR EXISTS (SELECT 1 FROM v2_prepress_units WHERE organization_id=affected_org AND order_line_id=affected_line)
     OR EXISTS (SELECT 1 FROM v2_route_instances WHERE organization_id=affected_org AND order_line_id=affected_line) THEN
    RAISE EXCEPTION 'Production requirements cannot change after operational history exists' USING ERRCODE='23514';
  END IF;
  RETURN COALESCE(NEW,OLD);
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER v2_sales_production_requirement_history_validate_trigger BEFORE UPDATE OR DELETE ON v2_sales_line_production_requirements FOR EACH ROW EXECUTE FUNCTION v2_sales_production_requirement_history_validate();
