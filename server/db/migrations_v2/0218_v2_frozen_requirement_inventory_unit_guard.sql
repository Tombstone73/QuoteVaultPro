-- P7E: a PBV2 area demand can deterministically freeze as a physical sheet
-- requirement.  Production may record that requirement's explicit inventory
-- basis even when legacy Material consumption_unit is square_foot.
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
  IF material_row.consumption_unit IS NOT NULL AND material_row.consumption_unit<>NEW.quantity_unit
    AND NOT (requirement_row IS NOT NULL AND material_row.inventory_unit=NEW.quantity_unit) THEN
    RAISE EXCEPTION 'Production material consumption unit must match its configured Material unit or frozen requirement inventory basis' USING ERRCODE='23514';
  END IF;
  IF NEW.consumption_kind='correction' THEN
    SELECT * INTO original_row FROM v2_production_material_consumptions WHERE id=NEW.corrects_consumption_id AND organization_id=NEW.organization_id FOR UPDATE;
    IF original_row IS NULL OR original_row.consumption_kind='correction' OR original_row.production_work_id<>NEW.production_work_id OR original_row.material_id<>NEW.material_id OR original_row.quantity_unit<>NEW.quantity_unit OR original_row.material_requirement_id IS DISTINCT FROM NEW.material_requirement_id THEN RAISE EXCEPTION 'Material correction must reverse one matching original fact' USING ERRCODE='23514'; END IF;
    SELECT COALESCE(sum(quantity),0) INTO corrected FROM v2_production_material_consumptions WHERE organization_id=NEW.organization_id AND corrects_consumption_id=NEW.corrects_consumption_id;
    IF NEW.quantity + corrected > original_row.quantity THEN RAISE EXCEPTION 'Material correction exceeds the remaining original quantity' USING ERRCODE='23514'; END IF;
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
