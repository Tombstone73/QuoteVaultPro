-- Successor cycles keep their own canonical destination snapshot.  This is
-- derived from the frozen route at creation, never entered as free text.
ALTER TABLE v2_production_rework_cycles ADD COLUMN destination_station_key varchar(32);
ALTER TABLE v2_production_rework_cycles ADD CONSTRAINT v2_production_rework_cycles_destination_chk CHECK(destination_station_key IS NULL OR destination_station_key IN ('flatbed','roll'));
CREATE INDEX v2_production_rework_cycles_destination_idx ON v2_production_rework_cycles(organization_id,destination_station_key,state);
