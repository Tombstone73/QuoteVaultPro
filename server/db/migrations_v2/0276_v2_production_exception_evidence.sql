-- M7.8C (safe subset): append-only operator exception evidence.  This table
-- deliberately owns neither attempts, output, routing, artwork nor fulfillment.
CREATE TABLE v2_production_work_events (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  production_work_id varchar NOT NULL,
  production_attempt_id varchar,
  sequence integer NOT NULL,
  event_kind varchar(32) NOT NULL,
  category varchar(120),
  note text,
  created_principal_kind varchar(32) NOT NULL,
  created_principal_subject varchar(255) NOT NULL,
  created_staff_actor_user_id varchar REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT v2_production_work_events_work_tenant_fk FOREIGN KEY(production_work_id,organization_id) REFERENCES v2_production_works(id,organization_id) ON DELETE RESTRICT,
  CONSTRAINT v2_production_work_events_attempt_tenant_fk FOREIGN KEY(production_attempt_id,organization_id) REFERENCES v2_production_attempts(id,organization_id) ON DELETE RESTRICT,
  CONSTRAINT v2_production_work_events_sequence_uidx UNIQUE(organization_id,production_work_id,sequence),
  CONSTRAINT v2_production_work_events_kind_chk CHECK(event_kind IN ('hold','resume','note','return_to_prepress','rework_released')),
  CONSTRAINT v2_production_work_events_content_chk CHECK((event_kind='note' AND note IS NOT NULL AND length(btrim(note))>0) OR (event_kind='hold' AND category IS NOT NULL AND length(btrim(category))>0) OR event_kind IN ('resume','return_to_prepress','rework_released')),
  CONSTRAINT v2_production_work_events_actor_chk CHECK(created_principal_kind IN ('staff','delegated_ai','portal','service') AND length(btrim(created_principal_subject))>0)
);
CREATE INDEX v2_production_work_events_work_created_idx ON v2_production_work_events(organization_id,production_work_id,sequence);

-- Controls are append-only.  A hold can reference the active attempt but
-- never changes its quantities or completion evidence.
CREATE OR REPLACE FUNCTION v2_production_work_event_validate() RETURNS trigger AS $$
DECLARE attempt_work varchar;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'Production exception evidence is append-only' USING ERRCODE='23514';
  END IF;
  IF NEW.production_attempt_id IS NOT NULL THEN
    SELECT production_work_id INTO attempt_work FROM v2_production_attempts WHERE organization_id=NEW.organization_id AND id=NEW.production_attempt_id;
    IF NOT FOUND OR attempt_work<>NEW.production_work_id THEN
      RAISE EXCEPTION 'Production exception attempt must belong to its work' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER v2_production_work_event_validate_trigger BEFORE INSERT OR UPDATE OR DELETE ON v2_production_work_events FOR EACH ROW EXECUTE FUNCTION v2_production_work_event_validate();

INSERT INTO v2_permission_capabilities(id,module,label) VALUES
 ('production.hold','production','Place and resume an operational Production hold'),
 ('production.rework','production','Return Production work to canonical Prepress rework'),
 ('production.note','production','Record append-only Production issue notes')
ON CONFLICT(id) DO NOTHING;
INSERT INTO v2_permission_set_template_capabilities(template_id,capability_id)
SELECT id,capability_id FROM v2_permission_set_templates CROSS JOIN (VALUES('production.hold'),('production.rework'),('production.note')) v(capability_id)
WHERE template_key IN ('owner','administrator') ON CONFLICT DO NOTHING;
