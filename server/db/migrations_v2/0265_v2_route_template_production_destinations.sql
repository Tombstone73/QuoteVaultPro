-- M7.5D follow-on: direct station selection is legal only for an explicit
-- mapping on the frozen Route's template production step. Existing routes are
-- intentionally not guessed or backfilled from labels.
CREATE TABLE v2_route_template_production_destinations (
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  route_template_id varchar NOT NULL,
  route_template_step_id varchar NOT NULL,
  station_key varchar(24) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, route_template_step_id),
  CONSTRAINT v2_route_template_production_destination_template_fk FOREIGN KEY (route_template_id, organization_id)
    REFERENCES v2_route_templates(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT v2_route_template_production_destination_step_fk FOREIGN KEY (route_template_step_id, route_template_id, organization_id)
    REFERENCES v2_route_template_steps(id, route_template_id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT v2_route_template_production_destination_station_chk CHECK (station_key IN ('flatbed','roll'))
);
CREATE INDEX v2_route_template_production_destination_station_idx ON v2_route_template_production_destinations(organization_id, station_key);
