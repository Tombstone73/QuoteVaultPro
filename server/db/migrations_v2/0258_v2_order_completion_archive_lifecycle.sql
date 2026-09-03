-- M6: Order completion is an operational terminal state. Archival is an
-- orthogonal visibility choice and never deletes downstream business facts.

ALTER TABLE v2_sales_order_details
  DROP CONSTRAINT v2_sales_order_details_commercial_state_chk,
  DROP CONSTRAINT v2_sales_order_details_cancellation_chk;

ALTER TABLE v2_sales_order_details
  ADD COLUMN completed_at timestamptz,
  ADD COLUMN completed_principal_kind varchar(32),
  ADD COLUMN completed_principal_subject varchar(255),
  ADD COLUMN completed_staff_actor_user_id varchar REFERENCES users(id) ON DELETE RESTRICT,
  ADD COLUMN archived_at timestamptz,
  ADD COLUMN archived_principal_kind varchar(32),
  ADD COLUMN archived_principal_subject varchar(255),
  ADD COLUMN archived_staff_actor_user_id varchar REFERENCES users(id) ON DELETE RESTRICT,
  ADD CONSTRAINT v2_sales_order_details_commercial_state_chk
    CHECK (commercial_state IN ('open', 'completed', 'cancelled')),
  ADD CONSTRAINT v2_sales_order_details_cancellation_chk CHECK (
    (commercial_state = 'open'
      AND cancelled_at IS NULL AND cancellation_reason IS NULL
      AND completed_at IS NULL AND completed_principal_kind IS NULL
      AND completed_principal_subject IS NULL AND completed_staff_actor_user_id IS NULL)
    OR
    (commercial_state = 'completed'
      AND cancelled_at IS NULL AND cancellation_reason IS NULL
      AND completed_at IS NOT NULL
      AND completed_principal_kind IN ('staff', 'delegated_ai', 'portal', 'service')
      AND length(btrim(completed_principal_subject)) > 0
      AND ((completed_principal_kind = 'delegated_ai' AND completed_staff_actor_user_id IS NOT NULL)
        OR (completed_principal_kind <> 'delegated_ai' AND completed_staff_actor_user_id IS NULL)))
    OR
    (commercial_state = 'cancelled'
      AND cancelled_at IS NOT NULL AND length(btrim(cancellation_reason)) > 0
      AND completed_at IS NULL AND completed_principal_kind IS NULL
      AND completed_principal_subject IS NULL AND completed_staff_actor_user_id IS NULL)
  ),
  ADD CONSTRAINT v2_sales_order_details_archive_chk CHECK (
    (archived_at IS NULL AND archived_principal_kind IS NULL
      AND archived_principal_subject IS NULL AND archived_staff_actor_user_id IS NULL)
    OR
    (archived_at IS NOT NULL AND commercial_state IN ('completed', 'cancelled')
      AND archived_principal_kind IN ('staff', 'delegated_ai', 'portal', 'service')
      AND length(btrim(archived_principal_subject)) > 0
      AND ((archived_principal_kind = 'delegated_ai' AND archived_staff_actor_user_id IS NOT NULL)
        OR (archived_principal_kind <> 'delegated_ai' AND archived_staff_actor_user_id IS NULL)))
  );

CREATE INDEX v2_sales_order_details_org_state_archive_idx
  ON v2_sales_order_details (organization_id, archived_at, commercial_state, document_id);

-- Completed Orders are operationally read-only. Raw SQL must not append or
-- rewrite Production execution after the Sales terminal transition.
CREATE OR REPLACE FUNCTION v2_production_validate() RETURNS trigger AS $$
DECLARE a record; req record; pu record; order_id varchar; order_state varchar;
BEGIN
  IF TG_TABLE_NAME='v2_production_works' THEN
    IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Production work is operational history and cannot be deleted' USING ERRCODE='23514'; END IF;
    SELECT commercial_state INTO order_state FROM v2_sales_order_details
      WHERE organization_id=NEW.organization_id AND document_id=NEW.order_document_id FOR SHARE;
    IF order_state IS DISTINCT FROM 'open' THEN
      RAISE EXCEPTION 'Production work requires an open Order' USING ERRCODE='23514';
    END IF;
    SELECT * INTO a FROM v2_artwork_assignments WHERE organization_id=NEW.organization_id AND id=NEW.artwork_assignment_id;
    SELECT * INTO req FROM v2_sales_line_production_requirements WHERE organization_id=NEW.organization_id AND order_line_id=NEW.order_line_id AND requirement_key=NEW.requirement_key;
    IF NOT FOUND OR a.purpose<>'production' OR a.order_document_id<>NEW.order_document_id OR a.order_line_id<>NEW.order_line_id OR a.artwork_file_id<>NEW.artwork_file_id OR a.side IS DISTINCT FROM NEW.side OR a.source_page_index IS DISTINCT FROM NEW.source_page_index OR a.layer_key IS DISTINCT FROM NEW.layer_key OR a.layer_order IS DISTINCT FROM NEW.layer_order OR req.side IS DISTINCT FROM NEW.side OR req.source_page_index IS DISTINCT FROM NEW.source_page_index OR req.layer_key IS DISTINCT FROM NEW.layer_key OR req.layer_order IS DISTINCT FROM NEW.layer_order THEN RAISE EXCEPTION 'Production work must snapshot exact required production Artwork evidence' USING ERRCODE='23514'; END IF;
    IF NEW.prepress_unit_id IS NOT NULL THEN SELECT * INTO pu FROM v2_prepress_units WHERE organization_id=NEW.organization_id AND id=NEW.prepress_unit_id; IF NOT FOUND OR pu.artwork_assignment_id<>NEW.artwork_assignment_id OR pu.completed_at IS NULL THEN RAISE EXCEPTION 'Production work Prepress evidence must be completed for the same Artwork assignment' USING ERRCODE='23514'; END IF; END IF;
    IF TG_OP='UPDATE' THEN RAISE EXCEPTION 'Production work evidence is immutable' USING ERRCODE='23514'; END IF;
  ELSE
    IF TG_OP='DELETE' AND OLD.completed_at IS NOT NULL THEN RAISE EXCEPTION 'Completed Production attempt is immutable' USING ERRCODE='23514'; END IF;
    IF TG_OP='UPDATE' AND OLD.completed_at IS NOT NULL THEN RAISE EXCEPTION 'Completed Production attempt is immutable' USING ERRCODE='23514'; END IF;
    IF TG_OP<>'DELETE' THEN
      SELECT w.order_document_id INTO order_id FROM v2_production_works w
        WHERE w.organization_id=NEW.organization_id AND w.id=NEW.production_work_id;
      SELECT commercial_state INTO order_state FROM v2_sales_order_details
        WHERE organization_id=NEW.organization_id AND document_id=order_id FOR SHARE;
      IF order_state IS DISTINCT FROM 'open' THEN
        RAISE EXCEPTION 'Production attempts require an open Order' USING ERRCODE='23514';
      END IF;
    END IF;
    IF TG_OP='UPDATE' AND (NEW.organization_id IS DISTINCT FROM OLD.organization_id OR NEW.production_work_id IS DISTINCT FROM OLD.production_work_id OR NEW.sequence IS DISTINCT FROM OLD.sequence OR NEW.attempt_kind IS DISTINCT FROM OLD.attempt_kind OR NEW.station_key IS DISTINCT FROM OLD.station_key OR NEW.started_at IS DISTINCT FROM OLD.started_at OR NEW.started_principal_kind IS DISTINCT FROM OLD.started_principal_kind OR NEW.started_principal_subject IS DISTINCT FROM OLD.started_principal_subject OR NEW.started_staff_actor_user_id IS DISTINCT FROM OLD.started_staff_actor_user_id) THEN RAISE EXCEPTION 'Production attempt start evidence is immutable' USING ERRCODE='23514'; END IF;
  END IF;
  RETURN COALESCE(NEW,OLD);
END; $$ LANGUAGE plpgsql;

-- Every operational owner keeps its own facts. This guard only prevents new
-- mutations after Sales has made the explicit terminal transition; reads and
-- immutable historical evidence remain available through their normal paths.
CREATE FUNCTION v2_order_open_for_operational_write() RETURNS trigger AS $$
DECLARE order_id varchar; order_state varchar;
BEGIN
  IF TG_TABLE_NAME IN ('v2_artwork_assignments', 'v2_proof_works', 'v2_prepress_units', 'v2_fulfillment_handoffs', 'v2_route_instances') THEN
    order_id := NEW.order_document_id;
  ELSIF TG_TABLE_NAME = 'v2_proof_versions' THEN
    SELECT w.order_document_id INTO order_id FROM v2_proof_works w
      WHERE w.organization_id=NEW.organization_id AND w.id=NEW.proof_work_id;
  ELSIF TG_TABLE_NAME = 'v2_proof_responses' THEN
    SELECT w.order_document_id INTO order_id FROM v2_proof_versions v
      JOIN v2_proof_works w ON w.organization_id=v.organization_id AND w.id=v.proof_work_id
      WHERE v.organization_id=NEW.organization_id AND v.id=NEW.proof_version_id;
  END IF;
  SELECT commercial_state INTO order_state FROM v2_sales_order_details
    WHERE organization_id=NEW.organization_id AND document_id=order_id FOR SHARE;
  IF order_state IS DISTINCT FROM 'open' THEN
    RAISE EXCEPTION 'Operational writes require an open Order' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;

CREATE TRIGGER v2_artwork_assignment_open_order_guard BEFORE INSERT ON v2_artwork_assignments
  FOR EACH ROW EXECUTE FUNCTION v2_order_open_for_operational_write();
CREATE TRIGGER v2_proof_work_open_order_guard BEFORE INSERT ON v2_proof_works
  FOR EACH ROW EXECUTE FUNCTION v2_order_open_for_operational_write();
CREATE TRIGGER v2_proof_version_open_order_guard BEFORE INSERT OR UPDATE ON v2_proof_versions
  FOR EACH ROW EXECUTE FUNCTION v2_order_open_for_operational_write();
CREATE TRIGGER v2_proof_response_open_order_guard BEFORE INSERT OR UPDATE ON v2_proof_responses
  FOR EACH ROW EXECUTE FUNCTION v2_order_open_for_operational_write();
CREATE TRIGGER v2_prepress_unit_open_order_guard BEFORE INSERT OR UPDATE ON v2_prepress_units
  FOR EACH ROW EXECUTE FUNCTION v2_order_open_for_operational_write();
CREATE TRIGGER v2_fulfillment_handoff_open_order_guard BEFORE INSERT OR UPDATE ON v2_fulfillment_handoffs
  FOR EACH ROW EXECUTE FUNCTION v2_order_open_for_operational_write();
CREATE TRIGGER v2_route_instance_open_order_guard BEFORE INSERT OR UPDATE ON v2_route_instances
  FOR EACH ROW EXECUTE FUNCTION v2_order_open_for_operational_write();
