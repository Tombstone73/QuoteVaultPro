-- M7.8H: an immutable bridge from a blocked Production work to one new
-- Prepress/Production successor cycle.  Historical route, work, attempt and
-- Artwork evidence are never rewound or overwritten.
CREATE TABLE v2_production_rework_cycles (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  predecessor_production_work_id varchar NOT NULL,
  order_document_id varchar NOT NULL,
  order_line_id varchar NOT NULL,
  requirement_key varchar(120) NOT NULL,
  prior_artwork_assignment_id varchar NOT NULL,
  successor_prepress_unit_id varchar,
  successor_production_work_id varchar,
  remaining_required_quantity integer NOT NULL,
  prior_recorded_good_quantity integer NOT NULL DEFAULT 0,
  prior_recorded_waste_quantity integer NOT NULL DEFAULT 0,
  reason text NOT NULL,
  category varchar(120),
  note text,
  state varchar(24) NOT NULL DEFAULT 'prepress_pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  created_principal_kind varchar(32) NOT NULL,
  created_principal_subject varchar(255) NOT NULL,
  created_staff_actor_user_id varchar REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT v2_production_rework_cycles_id_org_uidx UNIQUE(id,organization_id),
  CONSTRAINT v2_production_rework_cycles_predecessor_uidx UNIQUE(organization_id,predecessor_production_work_id),
  CONSTRAINT v2_production_rework_cycles_remaining_chk CHECK(remaining_required_quantity>0 AND prior_recorded_good_quantity>=0 AND prior_recorded_waste_quantity>=0),
  CONSTRAINT v2_production_rework_cycles_state_chk CHECK(state IN ('prepress_pending','production_created')),
  CONSTRAINT v2_production_rework_cycles_predecessor_fk FOREIGN KEY(predecessor_production_work_id,organization_id) REFERENCES v2_production_works(id,organization_id) ON DELETE RESTRICT,
  CONSTRAINT v2_production_rework_cycles_line_fk FOREIGN KEY(order_line_id,organization_id,order_document_id) REFERENCES v2_sales_document_lines(id,organization_id,document_id) ON DELETE RESTRICT,
  CONSTRAINT v2_production_rework_cycles_prior_art_fk FOREIGN KEY(prior_artwork_assignment_id,organization_id) REFERENCES v2_artwork_assignments(id,organization_id) ON DELETE RESTRICT
);

ALTER TABLE v2_prepress_units DROP CONSTRAINT v2_prepress_units_assignment_uidx;
ALTER TABLE v2_prepress_units ADD COLUMN rework_cycle_id varchar;
ALTER TABLE v2_prepress_units ADD CONSTRAINT v2_prepress_units_rework_cycle_fk FOREIGN KEY(rework_cycle_id,organization_id) REFERENCES v2_production_rework_cycles(id,organization_id) ON DELETE RESTRICT;
CREATE UNIQUE INDEX v2_prepress_units_normal_assignment_uidx ON v2_prepress_units(organization_id,artwork_assignment_id) WHERE rework_cycle_id IS NULL;
CREATE UNIQUE INDEX v2_prepress_units_rework_cycle_uidx ON v2_prepress_units(organization_id,rework_cycle_id) WHERE rework_cycle_id IS NOT NULL;

ALTER TABLE v2_production_works ADD COLUMN rework_cycle_id varchar;
ALTER TABLE v2_production_works ADD COLUMN predecessor_production_work_id varchar;
ALTER TABLE v2_production_works DROP CONSTRAINT v2_production_works_assignment_uidx;
ALTER TABLE v2_production_works DROP CONSTRAINT v2_production_works_requirement_uidx;
ALTER TABLE v2_production_works ADD CONSTRAINT v2_production_works_rework_cycle_fk FOREIGN KEY(rework_cycle_id,organization_id) REFERENCES v2_production_rework_cycles(id,organization_id) ON DELETE RESTRICT;
ALTER TABLE v2_production_works ADD CONSTRAINT v2_production_works_predecessor_work_fk FOREIGN KEY(predecessor_production_work_id,organization_id) REFERENCES v2_production_works(id,organization_id) ON DELETE RESTRICT;
CREATE UNIQUE INDEX v2_production_works_normal_assignment_uidx ON v2_production_works(organization_id,artwork_assignment_id) WHERE rework_cycle_id IS NULL;
CREATE UNIQUE INDEX v2_production_works_normal_requirement_uidx ON v2_production_works(organization_id,order_line_id,requirement_key,artwork_assignment_id) WHERE rework_cycle_id IS NULL;
CREATE UNIQUE INDEX v2_production_works_rework_cycle_uidx ON v2_production_works(organization_id,rework_cycle_id) WHERE rework_cycle_id IS NOT NULL;

ALTER TABLE v2_production_rework_cycles ADD CONSTRAINT v2_production_rework_cycles_successor_prepress_fk FOREIGN KEY(successor_prepress_unit_id,organization_id) REFERENCES v2_prepress_units(id,organization_id) ON DELETE RESTRICT;
ALTER TABLE v2_production_rework_cycles ADD CONSTRAINT v2_production_rework_cycles_successor_production_fk FOREIGN KEY(successor_production_work_id,organization_id) REFERENCES v2_production_works(id,organization_id) ON DELETE RESTRICT;

-- A rework unit has no started/completed evidence yet, so the operator may
-- explicitly replace only its prepared Production-Artwork reference. Once it
-- starts, the ordinary immutable Prepress evidence rule resumes.
CREATE OR REPLACE FUNCTION v2_prepress_unit_validate() RETURNS trigger AS $$
DECLARE a record; identity_changed boolean;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.completed_at IS NOT NULL THEN RAISE EXCEPTION 'Completed Prepress evidence is immutable' USING ERRCODE='23514'; END IF;
    RETURN OLD;
  END IF;
  SELECT * INTO a FROM v2_artwork_assignments WHERE id=NEW.artwork_assignment_id AND organization_id=NEW.organization_id;
  IF NOT FOUND OR a.purpose <> 'production' OR a.order_document_id <> NEW.order_document_id OR a.order_line_id <> NEW.order_line_id OR a.artwork_file_id <> NEW.artwork_file_id OR a.side IS DISTINCT FROM NEW.side OR a.source_page_index IS DISTINCT FROM NEW.source_page_index OR a.layer_key IS DISTINCT FROM NEW.layer_key OR a.layer_order IS DISTINCT FROM NEW.layer_order THEN RAISE EXCEPTION 'Prepress Unit must snapshot one production Artwork assignment for its OrderLine' USING ERRCODE='23514'; END IF;
  IF TG_OP = 'UPDATE' THEN
    identity_changed := NEW.organization_id IS DISTINCT FROM OLD.organization_id OR NEW.order_document_id IS DISTINCT FROM OLD.order_document_id OR NEW.order_line_id IS DISTINCT FROM OLD.order_line_id OR NEW.artwork_assignment_id IS DISTINCT FROM OLD.artwork_assignment_id OR NEW.artwork_file_id IS DISTINCT FROM OLD.artwork_file_id OR NEW.side IS DISTINCT FROM OLD.side OR NEW.source_page_index IS DISTINCT FROM OLD.source_page_index OR NEW.layer_key IS DISTINCT FROM OLD.layer_key OR NEW.layer_order IS DISTINCT FROM OLD.layer_order;
    IF identity_changed AND NOT (OLD.rework_cycle_id IS NOT NULL AND OLD.started_at IS NULL AND OLD.completed_at IS NULL) THEN RAISE EXCEPTION 'Prepress evidence identity is immutable' USING ERRCODE='23514'; END IF;
    IF OLD.started_at IS NOT NULL AND (NEW.started_at IS DISTINCT FROM OLD.started_at OR NEW.started_principal_kind IS DISTINCT FROM OLD.started_principal_kind OR NEW.started_principal_subject IS DISTINCT FROM OLD.started_principal_subject OR NEW.started_staff_actor_user_id IS DISTINCT FROM OLD.started_staff_actor_user_id) THEN RAISE EXCEPTION 'Prepress start is immutable' USING ERRCODE='23514'; END IF;
    IF OLD.completed_at IS NOT NULL THEN RAISE EXCEPTION 'Completed Prepress evidence is immutable' USING ERRCODE='23514'; END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
