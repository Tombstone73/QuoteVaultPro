-- A ProductionWork retains immutable artwork/requirement/attempt evidence.
-- Its quantity target, however, is the current commercial Order-line target:
-- an authorized revision must expose remaining output instead of leaving a
-- one-unit historical target falsely satisfied.  This is the only permitted
-- ProductionWork update, and it must equal the scoped current Order line.
CREATE OR REPLACE FUNCTION v2_production_validate() RETURNS trigger AS $$
DECLARE
  a record;
  req record;
  pu record;
  order_id varchar;
  order_state varchar;
  line_quantity integer;
BEGIN
  IF TG_TABLE_NAME='v2_production_works' THEN
    IF TG_OP='DELETE' THEN
      RAISE EXCEPTION 'Production work is operational history and cannot be deleted' USING ERRCODE='23514';
    END IF;

    SELECT commercial_state INTO order_state FROM v2_sales_order_details
      WHERE organization_id=NEW.organization_id AND document_id=NEW.order_document_id FOR SHARE;
    IF order_state IS DISTINCT FROM 'open' THEN
      RAISE EXCEPTION 'Production work requires an open Order' USING ERRCODE='23514';
    END IF;

    SELECT * INTO a FROM v2_artwork_assignments
      WHERE organization_id=NEW.organization_id AND id=NEW.artwork_assignment_id;
    SELECT * INTO req FROM v2_sales_line_production_requirements
      WHERE organization_id=NEW.organization_id AND order_line_id=NEW.order_line_id AND requirement_key=NEW.requirement_key;
    IF NOT FOUND OR a.purpose<>'production'
      OR a.order_document_id<>NEW.order_document_id
      OR a.order_line_id<>NEW.order_line_id
      OR a.artwork_file_id<>NEW.artwork_file_id
      OR a.side IS DISTINCT FROM NEW.side
      OR a.source_page_index IS DISTINCT FROM NEW.source_page_index
      OR a.layer_key IS DISTINCT FROM NEW.layer_key
      OR a.layer_order IS DISTINCT FROM NEW.layer_order
      OR req.side IS DISTINCT FROM NEW.side
      OR req.source_page_index IS DISTINCT FROM NEW.source_page_index
      OR req.layer_key IS DISTINCT FROM NEW.layer_key
      OR req.layer_order IS DISTINCT FROM NEW.layer_order THEN
      RAISE EXCEPTION 'Production work must snapshot exact required production Artwork evidence' USING ERRCODE='23514';
    END IF;

    IF NEW.prepress_unit_id IS NOT NULL THEN
      SELECT * INTO pu FROM v2_prepress_units
        WHERE organization_id=NEW.organization_id AND id=NEW.prepress_unit_id;
      IF NOT FOUND OR pu.artwork_assignment_id<>NEW.artwork_assignment_id OR pu.completed_at IS NULL THEN
        RAISE EXCEPTION 'Production work Prepress evidence must be completed for the same Artwork assignment' USING ERRCODE='23514';
      END IF;
    END IF;

    IF TG_OP='UPDATE' THEN
      SELECT quantity INTO line_quantity FROM v2_sales_document_lines
        WHERE organization_id=NEW.organization_id
          AND document_id=NEW.order_document_id
          AND id=NEW.order_line_id
        FOR SHARE;
      IF NOT FOUND OR NEW.ordered_quantity IS DISTINCT FROM line_quantity THEN
        RAISE EXCEPTION 'Production work target must equal the current Order line quantity' USING ERRCODE='23514';
      END IF;
      IF NEW.organization_id IS DISTINCT FROM OLD.organization_id
        OR NEW.id IS DISTINCT FROM OLD.id
        OR NEW.order_document_id IS DISTINCT FROM OLD.order_document_id
        OR NEW.order_line_id IS DISTINCT FROM OLD.order_line_id
        OR NEW.requirement_key IS DISTINCT FROM OLD.requirement_key
        OR NEW.artwork_assignment_id IS DISTINCT FROM OLD.artwork_assignment_id
        OR NEW.artwork_file_id IS DISTINCT FROM OLD.artwork_file_id
        OR NEW.prepress_unit_id IS DISTINCT FROM OLD.prepress_unit_id
        OR NEW.side IS DISTINCT FROM OLD.side
        OR NEW.source_page_index IS DISTINCT FROM OLD.source_page_index
        OR NEW.layer_key IS DISTINCT FROM OLD.layer_key
        OR NEW.layer_order IS DISTINCT FROM OLD.layer_order
        OR NEW.created_principal_kind IS DISTINCT FROM OLD.created_principal_kind
        OR NEW.created_principal_subject IS DISTINCT FROM OLD.created_principal_subject
        OR NEW.created_staff_actor_user_id IS DISTINCT FROM OLD.created_staff_actor_user_id
        OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
        RAISE EXCEPTION 'Production work evidence is immutable' USING ERRCODE='23514';
      END IF;
    END IF;
  ELSE
    IF TG_OP='DELETE' AND OLD.completed_at IS NOT NULL THEN
      RAISE EXCEPTION 'Completed Production attempt is immutable' USING ERRCODE='23514';
    END IF;
    IF TG_OP='UPDATE' AND OLD.completed_at IS NOT NULL THEN
      RAISE EXCEPTION 'Completed Production attempt is immutable' USING ERRCODE='23514';
    END IF;
    IF TG_OP<>'DELETE' THEN
      SELECT w.order_document_id INTO order_id FROM v2_production_works w
        WHERE w.organization_id=NEW.organization_id AND w.id=NEW.production_work_id;
      SELECT commercial_state INTO order_state FROM v2_sales_order_details
        WHERE organization_id=NEW.organization_id AND document_id=order_id FOR SHARE;
      IF order_state IS DISTINCT FROM 'open' THEN
        RAISE EXCEPTION 'Production attempts require an open Order' USING ERRCODE='23514';
      END IF;
    END IF;
    IF TG_OP='UPDATE' AND (
      NEW.organization_id IS DISTINCT FROM OLD.organization_id
      OR NEW.production_work_id IS DISTINCT FROM OLD.production_work_id
      OR NEW.sequence IS DISTINCT FROM OLD.sequence
      OR NEW.attempt_kind IS DISTINCT FROM OLD.attempt_kind
      OR NEW.station_key IS DISTINCT FROM OLD.station_key
      OR NEW.started_at IS DISTINCT FROM OLD.started_at
      OR NEW.started_principal_kind IS DISTINCT FROM OLD.started_principal_kind
      OR NEW.started_principal_subject IS DISTINCT FROM OLD.started_principal_subject
      OR NEW.started_staff_actor_user_id IS DISTINCT FROM OLD.started_staff_actor_user_id) THEN
      RAISE EXCEPTION 'Production attempt start evidence is immutable' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN COALESCE(NEW,OLD);
END; $$ LANGUAGE plpgsql;
