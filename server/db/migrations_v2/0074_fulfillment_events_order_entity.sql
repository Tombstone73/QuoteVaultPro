DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'fulfillment_events_entity_type_chk'
  ) THEN
    ALTER TABLE fulfillment_events
      DROP CONSTRAINT fulfillment_events_entity_type_chk;
  END IF;

  ALTER TABLE fulfillment_events
    ADD CONSTRAINT fulfillment_events_entity_type_chk
    CHECK (entity_type IN ('SHIPMENT', 'PICKUP_TICKET', 'ORDER'));
END $$;
