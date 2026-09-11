-- M7.8C continuation: a rework request is immutable exception evidence, not
-- a backward routing transition. It intentionally preserves active attempts
-- and output, and creates no Fulfillment or Prepress handoff authority.
ALTER TABLE v2_production_work_events
  ADD COLUMN reason varchar(500),
  ADD COLUMN recorded_good_quantity integer,
  ADD COLUMN recorded_waste_quantity integer;

ALTER TABLE v2_production_work_events
  DROP CONSTRAINT v2_production_work_events_kind_chk,
  DROP CONSTRAINT v2_production_work_events_content_chk,
  ADD CONSTRAINT v2_production_work_events_kind_chk CHECK(event_kind IN ('hold','resume','note','rework_requested')),
  ADD CONSTRAINT v2_production_work_events_content_chk CHECK(
    (event_kind='note' AND note IS NOT NULL AND length(btrim(note))>0)
    OR (event_kind='hold' AND category IS NOT NULL AND length(btrim(category))>0)
    OR (event_kind='rework_requested' AND reason IS NOT NULL AND length(btrim(reason))>0
      AND recorded_good_quantity IS NOT NULL AND recorded_good_quantity>=0
      AND recorded_waste_quantity IS NOT NULL AND recorded_waste_quantity>=0)
    OR event_kind='resume'
  );
