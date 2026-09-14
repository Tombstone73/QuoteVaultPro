-- M7.8I execution follow-up.  0283 established the obligation identity; this
-- migration adds append-only history and permits one replacement work for each
-- frozen production requirement of the affected line.
DROP INDEX v2_production_works_replacement_obligation_uidx;
ALTER TABLE v2_production_works ADD COLUMN replacement_origin_production_work_id varchar;
ALTER TABLE v2_production_works ADD CONSTRAINT v2_production_works_replacement_origin_fk
  FOREIGN KEY(replacement_origin_production_work_id,organization_id)
  REFERENCES v2_production_works(id,organization_id) ON DELETE RESTRICT;
CREATE UNIQUE INDEX v2_production_works_replacement_requirement_uidx
  ON v2_production_works(organization_id,replacement_obligation_id,requirement_key,artwork_assignment_id)
  WHERE replacement_obligation_id IS NOT NULL;

CREATE TABLE v2_order_replacement_obligation_events (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  replacement_obligation_id varchar NOT NULL,
  sequence integer NOT NULL,
  event_kind varchar(48) NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_principal_kind varchar(32) NOT NULL,
  created_principal_subject varchar(255) NOT NULL,
  created_staff_actor_user_id varchar REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT v2_replacement_obligation_events_obligation_fk FOREIGN KEY(replacement_obligation_id,organization_id)
    REFERENCES v2_order_replacement_obligations(id,organization_id) ON DELETE RESTRICT,
  CONSTRAINT v2_replacement_obligation_events_sequence_uidx UNIQUE(organization_id,replacement_obligation_id,sequence),
  CONSTRAINT v2_replacement_obligation_events_kind_chk CHECK(event_kind IN ('created','production_authority_created','production_satisfied','fulfillment_satisfied','completed','cancelled','corrected')),
  CONSTRAINT v2_replacement_obligation_events_actor_chk CHECK(created_principal_kind IN ('staff','delegated_ai','service') AND length(btrim(created_principal_subject))>0)
);
CREATE INDEX v2_replacement_obligation_events_order_idx ON v2_order_replacement_obligation_events(organization_id,replacement_obligation_id,sequence);

CREATE OR REPLACE FUNCTION v2_replacement_obligation_event_validate() RETURNS trigger AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'Replacement obligation events are append-only' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER v2_replacement_obligation_event_validate_trigger
  BEFORE INSERT OR UPDATE OR DELETE ON v2_order_replacement_obligation_events
  FOR EACH ROW EXECUTE FUNCTION v2_replacement_obligation_event_validate();

-- The obligation's operational status is derived from immutable Production
-- attempts and immutable handoff allocations.  This deliberately does not
-- inspect invoices or payments: billable replacement invoicing is a later
-- workflow and is never fabricated here.
CREATE OR REPLACE FUNCTION v2_refresh_replacement_obligation(p_organization_id varchar,p_obligation_id varchar)
RETURNS void AS $$
DECLARE current_status varchar; desired_status varchar; required_quantity integer; produced boolean; fulfilled boolean; next_sequence integer;
BEGIN
  SELECT status,replacement_quantity INTO current_status,required_quantity
  FROM v2_order_replacement_obligations
  WHERE organization_id=p_organization_id AND id=p_obligation_id FOR UPDATE;
  IF NOT FOUND OR current_status='cancelled' THEN RETURN; END IF;
  SELECT EXISTS(SELECT 1 FROM v2_production_works w WHERE w.organization_id=p_organization_id AND w.replacement_obligation_id=p_obligation_id)
    AND NOT EXISTS(SELECT 1 FROM v2_production_works w WHERE w.organization_id=p_organization_id AND w.replacement_obligation_id=p_obligation_id AND v2_usable_production_good_quantity(w.organization_id,w.id)<w.ordered_quantity)
  INTO produced;
  SELECT COALESCE(SUM(line.quantity),0)>=required_quantity INTO fulfilled
  FROM v2_fulfillment_handoffs handoff JOIN v2_fulfillment_handoff_lines line ON line.organization_id=handoff.organization_id AND line.handoff_id=handoff.id
  WHERE handoff.organization_id=p_organization_id AND handoff.replacement_obligation_id=p_obligation_id;
  desired_status:=CASE WHEN produced AND fulfilled THEN 'fulfilled' WHEN produced THEN 'production_complete' ELSE 'open' END;
  IF desired_status=current_status THEN RETURN; END IF;
  UPDATE v2_order_replacement_obligations SET status=desired_status WHERE organization_id=p_organization_id AND id=p_obligation_id;
  SELECT COALESCE(max(sequence),0)+1 INTO next_sequence FROM v2_order_replacement_obligation_events WHERE organization_id=p_organization_id AND replacement_obligation_id=p_obligation_id;
  INSERT INTO v2_order_replacement_obligation_events(organization_id,replacement_obligation_id,sequence,event_kind,detail,created_principal_kind,created_principal_subject)
  VALUES(p_organization_id,p_obligation_id,next_sequence,CASE WHEN desired_status='production_complete' THEN 'production_satisfied' ELSE 'fulfillment_satisfied' END,jsonb_build_object('status',desired_status),'service','replacement-obligation-reconciler');
  IF desired_status='fulfilled' THEN
    INSERT INTO v2_order_replacement_obligation_events(organization_id,replacement_obligation_id,sequence,event_kind,detail,created_principal_kind,created_principal_subject)
    VALUES(p_organization_id,p_obligation_id,next_sequence+1,'completed',jsonb_build_object('status',desired_status),'service','replacement-obligation-reconciler');
  END IF;
END;
$$ LANGUAGE plpgsql;
CREATE OR REPLACE FUNCTION v2_refresh_replacement_from_work() RETURNS trigger AS $$
DECLARE obligation_id varchar;
BEGIN
  SELECT replacement_obligation_id INTO obligation_id FROM v2_production_works WHERE organization_id=NEW.organization_id AND id=NEW.production_work_id;
  IF obligation_id IS NOT NULL THEN PERFORM v2_refresh_replacement_obligation(NEW.organization_id,obligation_id); END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER v2_refresh_replacement_after_attempt
  AFTER INSERT OR UPDATE ON v2_production_attempts FOR EACH ROW EXECUTE FUNCTION v2_refresh_replacement_from_work();
CREATE TRIGGER v2_refresh_replacement_after_disposition
  AFTER INSERT ON v2_production_output_dispositions FOR EACH ROW EXECUTE FUNCTION v2_refresh_replacement_from_work();
CREATE OR REPLACE FUNCTION v2_refresh_replacement_from_handoff_line() RETURNS trigger AS $$
DECLARE obligation_id varchar;
BEGIN
  SELECT replacement_obligation_id INTO obligation_id FROM v2_fulfillment_handoffs WHERE organization_id=NEW.organization_id AND id=NEW.handoff_id;
  IF obligation_id IS NOT NULL THEN PERFORM v2_refresh_replacement_obligation(NEW.organization_id,obligation_id); END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER v2_refresh_replacement_after_handoff_line
  AFTER INSERT ON v2_fulfillment_handoff_lines FOR EACH ROW EXECUTE FUNCTION v2_refresh_replacement_from_handoff_line();

-- A prepared physical container may reserve a replacement handoff without
-- consuming the original Order-line supply. The immutable prepared revision
-- carries the authority until finalization creates its distinct handoff.
ALTER TABLE v2_fulfillment_shipment_prepared_revision_lines
  ADD COLUMN replacement_obligation_id varchar;
ALTER TABLE v2_fulfillment_shipment_prepared_revision_lines
  ADD CONSTRAINT v2_fulfillment_prepared_revision_lines_replacement_fk
  FOREIGN KEY(replacement_obligation_id,organization_id)
  REFERENCES v2_order_replacement_obligations(id,organization_id) ON DELETE RESTRICT;
ALTER TABLE v2_fulfillment_shipment_prepared_revision_lines
  DROP CONSTRAINT v2_fulfillment_shipment_prepared_revision_lines_once_uidx;
CREATE UNIQUE INDEX v2_fulfillment_prepared_revision_lines_authority_uidx
  ON v2_fulfillment_shipment_prepared_revision_lines(
    organization_id,revision_id,order_line_id,COALESCE(replacement_obligation_id,'')
  );
CREATE INDEX v2_fulfillment_prepared_revision_lines_replacement_idx
  ON v2_fulfillment_shipment_prepared_revision_lines(organization_id,replacement_obligation_id)
  WHERE replacement_obligation_id IS NOT NULL;
