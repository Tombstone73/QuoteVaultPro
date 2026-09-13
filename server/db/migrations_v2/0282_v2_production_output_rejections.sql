-- M7.8H follow-up: preserve immutable good-output evidence while recording
-- the separate, append-only fact that a previously accepted unit is unusable.
CREATE TABLE v2_production_output_dispositions (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  production_work_id varchar NOT NULL,
  production_attempt_id varchar NOT NULL,
  rejected_quantity integer NOT NULL,
  category varchar(120),
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_principal_kind varchar(32) NOT NULL,
  created_principal_subject varchar(255) NOT NULL,
  created_staff_actor_user_id varchar REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT v2_production_output_dispositions_id_org_uidx UNIQUE(id,organization_id),
  CONSTRAINT v2_production_output_dispositions_work_org_fk FOREIGN KEY(production_work_id,organization_id) REFERENCES v2_production_works(id,organization_id) ON DELETE RESTRICT,
  CONSTRAINT v2_production_output_dispositions_attempt_org_fk FOREIGN KEY(production_attempt_id,organization_id) REFERENCES v2_production_attempts(id,organization_id) ON DELETE RESTRICT,
  CONSTRAINT v2_production_output_dispositions_quantity_chk CHECK(rejected_quantity>0),
  CONSTRAINT v2_production_output_dispositions_reason_chk CHECK(length(btrim(reason))>0),
  CONSTRAINT v2_production_output_dispositions_actor_chk CHECK(created_principal_kind IN ('staff','delegated_ai','service') AND length(btrim(created_principal_subject))>0)
);
CREATE INDEX v2_production_output_dispositions_work_idx ON v2_production_output_dispositions(organization_id,production_work_id,created_at);
CREATE INDEX v2_production_output_dispositions_attempt_idx ON v2_production_output_dispositions(organization_id,production_attempt_id);

-- Only accepted, completed output contributes to usable physical supply.  The
-- function deliberately leaves historical attempt.good_quantity untouched.
CREATE OR REPLACE FUNCTION v2_usable_production_good_quantity(p_organization_id varchar,p_production_work_id varchar)
RETURNS integer LANGUAGE sql STABLE AS $$
  SELECT GREATEST(0,
    COALESCE(SUM(a.good_quantity) FILTER (WHERE a.completed_at IS NOT NULL),0)
    - COALESCE((SELECT SUM(d.rejected_quantity) FROM v2_production_output_dispositions d
                WHERE d.organization_id=p_organization_id AND d.production_work_id=p_production_work_id),0)
  )::integer
  FROM v2_production_attempts a
  WHERE a.organization_id=p_organization_id AND a.production_work_id=p_production_work_id;
$$;

CREATE OR REPLACE FUNCTION v2_production_output_disposition_validate() RETURNS trigger AS $$
DECLARE attempt_work varchar; attempt_good integer; attempt_completed timestamptz; prior_rejected integer;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'Production output dispositions are append-only' USING ERRCODE='23514';
  END IF;
  SELECT production_work_id,good_quantity,completed_at INTO attempt_work,attempt_good,attempt_completed
  FROM v2_production_attempts WHERE organization_id=NEW.organization_id AND id=NEW.production_attempt_id;
  IF NOT FOUND OR attempt_work<>NEW.production_work_id OR attempt_completed IS NULL THEN
    RAISE EXCEPTION 'A disposition must reference completed output from its own Production work' USING ERRCODE='23514';
  END IF;
  SELECT COALESCE(SUM(rejected_quantity),0) INTO prior_rejected
  FROM v2_production_output_dispositions
  WHERE organization_id=NEW.organization_id AND production_attempt_id=NEW.production_attempt_id;
  IF prior_rejected+NEW.rejected_quantity>attempt_good THEN
    RAISE EXCEPTION 'Rejected quantity exceeds immutable accepted output for this attempt' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER v2_production_output_disposition_validate_trigger
BEFORE INSERT OR UPDATE OR DELETE ON v2_production_output_dispositions
FOR EACH ROW EXECUTE FUNCTION v2_production_output_disposition_validate();

ALTER TABLE v2_production_work_events DROP CONSTRAINT v2_production_work_events_kind_chk;
ALTER TABLE v2_production_work_events ADD CONSTRAINT v2_production_work_events_kind_chk CHECK(event_kind IN ('hold','resume','note','return_to_prepress','rework_released','rework_requested','output_rejected'));
ALTER TABLE v2_production_work_events DROP CONSTRAINT v2_production_work_events_content_chk;
ALTER TABLE v2_production_work_events ADD CONSTRAINT v2_production_work_events_content_chk CHECK(
  (event_kind='note' AND note IS NOT NULL AND length(btrim(note))>0)
  OR (event_kind='hold' AND category IS NOT NULL AND length(btrim(category))>0)
  OR (event_kind='output_rejected' AND reason IS NOT NULL AND length(btrim(reason))>0)
  OR event_kind IN ('resume','return_to_prepress','rework_released','rework_requested')
);

INSERT INTO v2_permission_capabilities(id,module,label) VALUES
 ('production.output.reject','production','Reject or scrap previously accepted Production output')
ON CONFLICT(id) DO NOTHING;
INSERT INTO v2_permission_set_template_capabilities(template_id,capability_id)
SELECT id,capability_id FROM v2_permission_set_templates
CROSS JOIN (VALUES('production.output.reject')) v(capability_id)
WHERE template_key IN ('owner','administrator') ON CONFLICT DO NOTHING;
