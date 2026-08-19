-- Canonical V2 Inventory inbound stock: a receipt is an immutable inventory
-- fact outside ProductionWork. materials.stock_quantity remains only the
-- transactionally maintained compatibility projection.
ALTER TABLE v2_inventory_movements
  ALTER COLUMN order_document_id DROP NOT NULL,
  ALTER COLUMN order_line_id DROP NOT NULL,
  ALTER COLUMN production_work_id DROP NOT NULL,
  ADD COLUMN reason varchar(500);

ALTER TABLE v2_inventory_movements
  DROP CONSTRAINT IF EXISTS v2_inventory_movements_shape_chk,
  DROP CONSTRAINT IF EXISTS v2_inventory_movements_movement_kind_check,
  ADD CONSTRAINT v2_inventory_movements_movement_kind_check
    CHECK (movement_kind IN ('receipt','reserve','release','consume','waste','correction')),
  ADD CONSTRAINT v2_inventory_movements_reason_length_chk
    CHECK (reason IS NULL OR length(btrim(reason)) BETWEEN 1 AND 500),
  ADD CONSTRAINT v2_inventory_movements_shape_chk CHECK(
    (movement_kind='receipt'
      AND order_document_id IS NULL AND order_line_id IS NULL AND production_work_id IS NULL
      AND production_attempt_id IS NULL AND material_requirement_id IS NULL
      AND reservation_id IS NULL AND consumption_id IS NULL
      AND on_hand_delta=quantity AND reserved_delta=0
      AND reason IS NOT NULL AND length(btrim(reason))>0)
    OR
    (movement_kind='reserve' AND order_document_id IS NOT NULL AND order_line_id IS NOT NULL AND production_work_id IS NOT NULL AND on_hand_delta=0 AND reserved_delta=quantity)
    OR
    (movement_kind='release' AND order_document_id IS NOT NULL AND order_line_id IS NOT NULL AND production_work_id IS NOT NULL AND on_hand_delta=0 AND reserved_delta=-quantity)
    OR
    (movement_kind IN ('consume','waste') AND order_document_id IS NOT NULL AND order_line_id IS NOT NULL AND production_work_id IS NOT NULL AND on_hand_delta=-quantity AND reserved_delta<=0 AND reserved_delta>=-quantity)
    OR
    (movement_kind='correction' AND order_document_id IS NOT NULL AND order_line_id IS NOT NULL AND production_work_id IS NOT NULL AND on_hand_delta=quantity AND reserved_delta=0)
  );

CREATE OR REPLACE FUNCTION v2_inventory_movement_validate() RETURNS trigger AS $$
DECLARE material_row record; work_row record; reservation_remaining numeric; reserved_total numeric; consumption_row record; requirement_row record;
BEGIN
  IF TG_OP IN ('UPDATE','DELETE') THEN RAISE EXCEPTION 'Inventory movements are immutable; record a correction or release movement instead' USING ERRCODE='23514'; END IF;
  SELECT * INTO material_row FROM materials WHERE id=NEW.material_id AND organization_id=NEW.organization_id FOR UPDATE;
  IF material_row IS NULL THEN RAISE EXCEPTION 'Inventory Material must belong to the organization' USING ERRCODE='23514'; END IF;
  IF NEW.movement_kind='receipt' THEN
    IF material_row.inventory_unit IS NULL OR material_row.inventory_unit<>NEW.quantity_unit THEN
      RAISE EXCEPTION 'Inventory receipt unit must match the configured Material inventory unit' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  END IF;
  SELECT * INTO work_row FROM v2_production_works WHERE id=NEW.production_work_id AND organization_id=NEW.organization_id;
  IF work_row IS NULL OR work_row.order_document_id<>NEW.order_document_id OR work_row.order_line_id<>NEW.order_line_id THEN RAISE EXCEPTION 'Inventory movement must belong to its Production work OrderLine' USING ERRCODE='23514'; END IF;
  IF NEW.material_requirement_id IS NOT NULL THEN
    SELECT * INTO requirement_row FROM v2_order_line_material_requirements WHERE id=NEW.material_requirement_id AND organization_id=NEW.organization_id;
  END IF;
  IF material_row.consumption_unit IS NOT NULL AND material_row.consumption_unit<>NEW.quantity_unit
    AND NOT (requirement_row IS NOT NULL AND material_row.inventory_unit=NEW.quantity_unit) THEN
    RAISE EXCEPTION 'Inventory movement unit must match the configured Material unit or frozen requirement inventory basis' USING ERRCODE='23514';
  END IF;
  IF NEW.reservation_id IS NOT NULL THEN
    SELECT COALESCE(sum(reserved_delta),0) INTO reservation_remaining FROM v2_inventory_movements WHERE organization_id=NEW.organization_id AND reservation_id=NEW.reservation_id;
    IF NEW.reserved_delta<0 AND reservation_remaining + NEW.reserved_delta < 0 THEN RAISE EXCEPTION 'Inventory reservation cannot be released or consumed twice' USING ERRCODE='23514'; END IF;
  END IF;
  IF NEW.movement_kind='reserve' THEN
    SELECT COALESCE(sum(reserved_delta),0) INTO reserved_total FROM v2_inventory_movements WHERE organization_id=NEW.organization_id AND material_id=NEW.material_id;
    IF material_row.stock_quantity-reserved_total < NEW.reserved_delta THEN RAISE EXCEPTION 'Insufficient available stock for reservation' USING ERRCODE='23514'; END IF;
  END IF;
  IF NEW.on_hand_delta<0 AND material_row.stock_quantity+NEW.on_hand_delta<0 THEN RAISE EXCEPTION 'Insufficient on-hand stock for Production consumption' USING ERRCODE='23514'; END IF;
  IF NEW.consumption_id IS NOT NULL THEN
    SELECT * INTO consumption_row FROM v2_production_material_consumptions WHERE id=NEW.consumption_id AND organization_id=NEW.organization_id;
    IF consumption_row IS NULL OR consumption_row.production_work_id<>NEW.production_work_id OR consumption_row.material_id<>NEW.material_id OR consumption_row.quantity_unit<>NEW.quantity_unit THEN RAISE EXCEPTION 'Inventory movement consumption reference is invalid' USING ERRCODE='23514'; END IF;
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;

INSERT INTO v2_permission_capabilities(id,module,label) VALUES
  ('inventory.view','inventory','View Inventory balances'),
  ('inventory.receive','inventory','Receive stock into Inventory')
ON CONFLICT(id) DO NOTHING;

INSERT INTO v2_permission_set_template_capabilities(template_id,capability_id)
SELECT id,capability_id FROM v2_permission_set_templates
CROSS JOIN (VALUES ('inventory.view'),('inventory.receive')) v(capability_id)
WHERE template_key IN ('owner','administrator')
ON CONFLICT DO NOTHING;

WITH inserted AS (
  INSERT INTO v2_permission_set_capabilities(organization_id,permission_set_id,capability_id)
  SELECT organization_id,id,capability_id FROM v2_permission_sets
  CROSS JOIN (VALUES ('inventory.view'),('inventory.receive')) v(capability_id)
  WHERE source_template_key IN ('owner','administrator')
  ON CONFLICT DO NOTHING
  RETURNING organization_id
)
UPDATE v2_permission_organization_state state
SET authority_revision=state.authority_revision+1,updated_at=now()
WHERE state.organization_id IN (SELECT DISTINCT organization_id FROM inserted);
