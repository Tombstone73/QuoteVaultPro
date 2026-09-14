-- M7.8G: a Production Run groups existing V2 Production work for one physical
-- execution.  It is deliberately downstream of Orders, Artwork, Routing and
-- Production attempts: a reservation is never completed output.
CREATE TABLE v2_production_runs (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  station_key varchar(32) NOT NULL,
  state varchar(16) NOT NULL DEFAULT 'draft',
  revision integer NOT NULL DEFAULT 1,
  material_fingerprint varchar(255),
  layout_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_principal_kind varchar(32) NOT NULL,
  created_principal_subject varchar(255) NOT NULL,
  created_staff_actor_user_id varchar REFERENCES users(id) ON DELETE RESTRICT,
  ready_at timestamptz, started_at timestamptz, completed_at timestamptz, cancelled_at timestamptz,
  CONSTRAINT v2_production_runs_id_org_uidx UNIQUE(id,organization_id),
  CONSTRAINT v2_production_runs_station_chk CHECK(station_key IN ('flatbed','roll')),
  CONSTRAINT v2_production_runs_state_chk CHECK(state IN ('draft','ready','active','held','completed','cancelled')),
  CONSTRAINT v2_production_runs_revision_chk CHECK(revision>0),
  CONSTRAINT v2_production_runs_actor_chk CHECK(created_principal_kind IN ('staff','delegated_ai','service') AND length(btrim(created_principal_subject))>0),
  CONSTRAINT v2_production_runs_terminal_timestamp_chk CHECK((state<>'completed' OR completed_at IS NOT NULL) AND (state<>'cancelled' OR cancelled_at IS NOT NULL))
);

CREATE TABLE v2_production_run_allocations (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  production_run_id varchar NOT NULL,
  production_work_id varchar NOT NULL,
  allocated_quantity integer NOT NULL,
  good_quantity integer NOT NULL DEFAULT 0,
  waste_quantity integer NOT NULL DEFAULT 0,
  artwork_assignment_id varchar NOT NULL,
  artwork_file_id varchar NOT NULL,
  artwork_identity_fingerprint varchar(128) NOT NULL,
  artwork_object_version varchar(255) NOT NULL DEFAULT '',
  production_attempt_id varchar,
  position integer NOT NULL,
  released_at timestamptz,
  terminal_resolution varchar(16),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT v2_production_run_allocations_id_org_uidx UNIQUE(id,organization_id),
  CONSTRAINT v2_production_run_allocations_member_uidx UNIQUE(organization_id,production_run_id,production_work_id),
  CONSTRAINT v2_production_run_allocations_run_org_fk FOREIGN KEY(production_run_id,organization_id) REFERENCES v2_production_runs(id,organization_id) ON DELETE RESTRICT,
  CONSTRAINT v2_production_run_allocations_work_org_fk FOREIGN KEY(production_work_id,organization_id) REFERENCES v2_production_works(id,organization_id) ON DELETE RESTRICT,
  CONSTRAINT v2_production_run_allocations_attempt_org_fk FOREIGN KEY(production_attempt_id,organization_id) REFERENCES v2_production_attempts(id,organization_id) ON DELETE RESTRICT,
  CONSTRAINT v2_production_run_allocations_artwork_org_fk FOREIGN KEY(artwork_assignment_id,organization_id,artwork_file_id) REFERENCES v2_artwork_assignments(id,organization_id,artwork_file_id) ON DELETE RESTRICT,
  CONSTRAINT v2_production_run_allocations_artwork_identity_chk CHECK(artwork_identity_fingerprint ~ '^sha256:[A-Fa-f0-9]{64}$'),
  CONSTRAINT v2_production_run_allocations_quantity_chk CHECK(allocated_quantity>0 AND good_quantity>=0 AND waste_quantity>=0 AND good_quantity<=allocated_quantity),
  CONSTRAINT v2_production_run_allocations_terminal_resolution_chk CHECK(terminal_resolution IS NULL OR terminal_resolution IN ('successful','released','cancelled')),
  CONSTRAINT v2_production_run_allocations_position_chk CHECK(position>=0)
);
CREATE INDEX v2_production_run_allocations_work_idx ON v2_production_run_allocations(organization_id,production_work_id) WHERE released_at IS NULL;
CREATE INDEX v2_production_runs_station_state_idx ON v2_production_runs(organization_id,station_key,state,created_at DESC);

-- A terminal Run attempt records whether its linked allocation actually
-- succeeded. NULL preserves unknown historical evidence; no backfill infers a
-- disposition for pre-existing attempts.
ALTER TABLE v2_production_attempts ADD COLUMN terminal_disposition varchar(24);
ALTER TABLE v2_production_attempts ADD CONSTRAINT v2_production_attempts_terminal_disposition_chk CHECK(terminal_disposition IS NULL OR terminal_disposition IN ('successful','released','cancelled'));

CREATE TABLE v2_production_run_events (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  production_run_id varchar NOT NULL,
  sequence integer NOT NULL,
  event_kind varchar(32) NOT NULL,
  production_run_allocation_id varchar,
  production_attempt_id varchar,
  reason text,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_principal_kind varchar(32) NOT NULL,
  created_principal_subject varchar(255) NOT NULL,
  created_staff_actor_user_id varchar REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT v2_production_run_events_sequence_uidx UNIQUE(organization_id,production_run_id,sequence),
  CONSTRAINT v2_production_run_events_run_org_fk FOREIGN KEY(production_run_id,organization_id) REFERENCES v2_production_runs(id,organization_id) ON DELETE RESTRICT,
  CONSTRAINT v2_production_run_events_allocation_org_fk FOREIGN KEY(production_run_allocation_id,organization_id) REFERENCES v2_production_run_allocations(id,organization_id) ON DELETE RESTRICT,
  CONSTRAINT v2_production_run_events_attempt_org_fk FOREIGN KEY(production_attempt_id,organization_id) REFERENCES v2_production_attempts(id,organization_id) ON DELETE RESTRICT,
  CONSTRAINT v2_production_run_events_kind_chk CHECK(event_kind IN ('created','allocation_reserved','ready','artwork_refreshed','started','attempt_linked','good_output','waste_output','held','resumed','member_released','reservation_released','cancelled','completed'))
);


INSERT INTO v2_permission_capabilities(id,module,label) VALUES
 ('production.run.create','production','Create and edit Production Runs'),
 ('production.run.execute','production','Prepare, start, hold, cancel and complete Production Runs') ON CONFLICT(id) DO NOTHING;
INSERT INTO v2_permission_set_template_capabilities(template_id,capability_id)
SELECT id,capability_id FROM v2_permission_set_templates CROSS JOIN (VALUES('production.run.create'),('production.run.execute')) v(capability_id)
WHERE template_key IN ('owner','administrator') ON CONFLICT DO NOTHING;
