-- P7D repair: reservation identity is append-only.  Its remaining quantity is
-- derived solely from immutable v2_inventory_movements.
CREATE OR REPLACE FUNCTION v2_inventory_reservation_validate() RETURNS trigger AS $$
DECLARE req record; work_row record; material_row record;
BEGIN
  IF TG_OP IN ('UPDATE','DELETE') THEN RAISE EXCEPTION 'Inventory reservations are immutable; record release or consumption movements instead' USING ERRCODE='23514'; END IF;
  SELECT * INTO req FROM v2_order_line_material_requirements WHERE id=NEW.material_requirement_id AND organization_id=NEW.organization_id;
  SELECT * INTO work_row FROM v2_production_works WHERE id=NEW.production_work_id AND organization_id=NEW.organization_id;
  SELECT * INTO material_row FROM materials WHERE id=NEW.material_id AND organization_id=NEW.organization_id;
  IF req IS NULL OR work_row IS NULL OR material_row IS NULL OR req.order_document_id<>NEW.order_document_id OR req.order_line_id<>NEW.order_line_id OR work_row.order_document_id<>NEW.order_document_id OR work_row.order_line_id<>NEW.order_line_id OR req.material_id<>NEW.material_id OR req.quantity_unit<>NEW.quantity_unit THEN RAISE EXCEPTION 'Inventory reservation must match one frozen requirement, Material, and Production work' USING ERRCODE='23514'; END IF;
  IF material_row.consumption_unit IS NOT NULL AND material_row.consumption_unit<>NEW.quantity_unit THEN RAISE EXCEPTION 'Inventory reservation unit must match the configured Material unit' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER v2_inventory_reservation_validate_trigger BEFORE INSERT OR UPDATE OR DELETE ON v2_inventory_reservations FOR EACH ROW EXECUTE FUNCTION v2_inventory_reservation_validate();
