-- M7.5E: a Route Instance must not retain a pointer into a mutable template
-- step. New instances snapshot the explicitly configured production station;
-- historical instances remain NULL and therefore fail closed for direct or
-- Prepress-driven Production handoff until reconciled by an authorized flow.
ALTER TABLE v2_route_instance_steps
  ADD COLUMN production_destination_station_key varchar(24),
  ADD CONSTRAINT v2_route_instance_steps_production_destination_station_chk
    CHECK (production_destination_station_key IS NULL OR production_destination_station_key IN ('flatbed','roll')),
  ADD CONSTRAINT v2_route_instance_steps_production_destination_kind_chk
    CHECK (production_destination_station_key IS NULL OR step_kind = 'production');

CREATE INDEX v2_route_instance_steps_production_destination_idx
  ON v2_route_instance_steps(organization_id, production_destination_station_key)
  WHERE production_destination_station_key IS NOT NULL;
