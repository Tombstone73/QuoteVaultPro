-- P7D: immutable V2 stock movement and reservation ledger.  materials.stock_quantity
-- remains a transactionally maintained V1 compatibility projection, never the audit trail.
CREATE TABLE v2_inventory_reservations (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  order_document_id varchar NOT NULL,
  order_line_id varchar NOT NULL,
  production_work_id varchar NOT NULL,
  material_requirement_id varchar NOT NULL,
  material_id varchar NOT NULL REFERENCES materials(id) ON DELETE RESTRICT,
  material_name_snapshot varchar NOT NULL,
  material_sku_snapshot varchar,
  opened_quantity numeric(18,6) NOT NULL CHECK(opened_quantity>0),
  quantity_unit varchar NOT NULL CHECK(quantity_unit IN ('each','square_foot','linear_foot','sheet','roll')),
  operation_request_id varchar NOT NULL REFERENCES v2_operation_requests(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT v2_inventory_reservations_line_fk FOREIGN KEY(order_line_id,organization_id,order_document_id) REFERENCES v2_sales_document_lines(id,organization_id,document_id) ON DELETE RESTRICT,
  CONSTRAINT v2_inventory_reservations_work_fk FOREIGN KEY(production_work_id,organization_id) REFERENCES v2_production_works(id,organization_id) ON DELETE RESTRICT,
  CONSTRAINT v2_inventory_reservations_requirement_fk FOREIGN KEY(material_requirement_id,organization_id) REFERENCES v2_order_line_material_requirements(id,organization_id) ON DELETE RESTRICT,
  CONSTRAINT v2_inventory_reservations_one_requirement_uidx UNIQUE(organization_id,production_work_id,material_requirement_id)
);

CREATE TABLE v2_inventory_movements (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  material_id varchar NOT NULL REFERENCES materials(id) ON DELETE RESTRICT,
  material_name_snapshot varchar NOT NULL,
  material_sku_snapshot varchar,
  order_document_id varchar NOT NULL,
  order_line_id varchar NOT NULL,
  production_work_id varchar NOT NULL,
  production_attempt_id varchar,
  material_requirement_id varchar,
  reservation_id varchar REFERENCES v2_inventory_reservations(id) ON DELETE RESTRICT,
  consumption_id varchar REFERENCES v2_production_material_consumptions(id) ON DELETE RESTRICT,
  quantity numeric(18,6) NOT NULL CHECK(quantity>0),
  quantity_unit varchar NOT NULL CHECK(quantity_unit IN ('each','square_foot','linear_foot','sheet','roll')),
  movement_kind varchar NOT NULL CHECK(movement_kind IN ('reserve','release','consume','waste','correction')),
  on_hand_delta numeric(18,6) NOT NULL,
  reserved_delta numeric(18,6) NOT NULL,
  operation_request_id varchar NOT NULL REFERENCES v2_operation_requests(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT v2_inventory_movements_line_fk FOREIGN KEY(order_line_id,organization_id,order_document_id) REFERENCES v2_sales_document_lines(id,organization_id,document_id) ON DELETE RESTRICT,
  CONSTRAINT v2_inventory_movements_work_fk FOREIGN KEY(production_work_id,organization_id) REFERENCES v2_production_works(id,organization_id) ON DELETE RESTRICT,
  CONSTRAINT v2_inventory_movements_attempt_fk FOREIGN KEY(production_attempt_id,organization_id) REFERENCES v2_production_attempts(id,organization_id) ON DELETE RESTRICT,
  CONSTRAINT v2_inventory_movements_requirement_fk FOREIGN KEY(material_requirement_id,organization_id) REFERENCES v2_order_line_material_requirements(id,organization_id) ON DELETE RESTRICT,
  CONSTRAINT v2_inventory_movements_shape_chk CHECK(
    (movement_kind='reserve' AND on_hand_delta=0 AND reserved_delta=quantity) OR
    (movement_kind='release' AND on_hand_delta=0 AND reserved_delta=-quantity) OR
    (movement_kind IN ('consume','waste') AND on_hand_delta=-quantity AND reserved_delta<=0 AND reserved_delta>=-quantity) OR
    (movement_kind='correction' AND on_hand_delta=quantity AND reserved_delta=0)
  )
);
CREATE UNIQUE INDEX v2_inventory_movements_consumption_uidx ON v2_inventory_movements(organization_id,consumption_id) WHERE consumption_id IS NOT NULL;
CREATE INDEX v2_inventory_movements_material_idx ON v2_inventory_movements(organization_id,material_id,created_at);
CREATE INDEX v2_inventory_movements_work_idx ON v2_inventory_movements(organization_id,production_work_id,created_at);
CREATE INDEX v2_inventory_movements_reservation_idx ON v2_inventory_movements(organization_id,reservation_id) WHERE reservation_id IS NOT NULL;

CREATE OR REPLACE FUNCTION v2_inventory_movement_validate() RETURNS trigger AS $$
DECLARE material_row record; work_row record; reservation_remaining numeric; reserved_total numeric; consumption_row record;
BEGIN
  IF TG_OP IN ('UPDATE','DELETE') THEN RAISE EXCEPTION 'Inventory movements are immutable; record a correction or release movement instead' USING ERRCODE='23514'; END IF;
  SELECT * INTO material_row FROM materials WHERE id=NEW.material_id AND organization_id=NEW.organization_id FOR UPDATE;
  IF material_row IS NULL THEN RAISE EXCEPTION 'Inventory Material must belong to the organization' USING ERRCODE='23514'; END IF;
  IF material_row.consumption_unit IS NOT NULL AND material_row.consumption_unit<>NEW.quantity_unit THEN RAISE EXCEPTION 'Inventory movement unit must match the configured Material unit' USING ERRCODE='23514'; END IF;
  SELECT * INTO work_row FROM v2_production_works WHERE id=NEW.production_work_id AND organization_id=NEW.organization_id;
  IF work_row IS NULL OR work_row.order_document_id<>NEW.order_document_id OR work_row.order_line_id<>NEW.order_line_id THEN RAISE EXCEPTION 'Inventory movement must belong to its Production work OrderLine' USING ERRCODE='23514'; END IF;
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
CREATE TRIGGER v2_inventory_movement_validate_trigger BEFORE INSERT OR UPDATE OR DELETE ON v2_inventory_movements FOR EACH ROW EXECUTE FUNCTION v2_inventory_movement_validate();
