-- M2.2.1 hardening: a configured zero-unit product is valid, but a raw writer
-- must not be able to claim a nonzero frozen set while omitting child rows.
ALTER TABLE v2_sales_document_lines
  ADD COLUMN production_requirement_count integer NOT NULL DEFAULT 0;
ALTER TABLE v2_sales_document_lines
  ADD CONSTRAINT v2_sales_document_lines_production_requirement_count_chk CHECK (
    (production_requirement_state='unconfigured' AND production_requirement_count=0)
    OR (production_requirement_state='configured' AND production_requirement_count>=0)
  );

CREATE OR REPLACE FUNCTION v2_sales_production_requirement_count_validate() RETURNS trigger AS $$
DECLARE affected_line varchar; affected_org varchar; expected_count integer; actual_count integer; state varchar;
BEGIN
  IF TG_TABLE_NAME='v2_sales_document_lines' THEN
    affected_line:=COALESCE(NEW.id,OLD.id); affected_org:=COALESCE(NEW.organization_id,OLD.organization_id);
  ELSE
    affected_line:=COALESCE(NEW.order_line_id,OLD.order_line_id); affected_org:=COALESCE(NEW.organization_id,OLD.organization_id);
  END IF;
  SELECT production_requirement_state,production_requirement_count INTO state,expected_count FROM v2_sales_document_lines WHERE organization_id=affected_org AND id=affected_line;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT count(*) INTO actual_count FROM v2_sales_line_production_requirements WHERE organization_id=affected_org AND order_line_id=affected_line;
  IF (state='unconfigured' AND actual_count<>0) OR (state='configured' AND actual_count<>expected_count) THEN
    RAISE EXCEPTION 'Frozen production requirement count does not match requirement rows' USING ERRCODE='23514';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
CREATE CONSTRAINT TRIGGER v2_sales_production_requirement_count_line_validate
  AFTER INSERT OR UPDATE OR DELETE ON v2_sales_document_lines DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION v2_sales_production_requirement_count_validate();
CREATE CONSTRAINT TRIGGER v2_sales_production_requirement_count_rows_validate
  AFTER INSERT OR UPDATE OR DELETE ON v2_sales_line_production_requirements DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION v2_sales_production_requirement_count_validate();
