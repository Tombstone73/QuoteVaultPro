-- Compatibility entry retained because 0232 was published with the unreleased
-- 0231/0232 chain. 0231 now creates the prerequisite before its FK.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'v2_fulfillment_handoffs'::regclass
      AND conname = 'v2_fulfillment_handoffs_id_org_uidx'
  ) THEN
    ALTER TABLE v2_fulfillment_handoffs
      ADD CONSTRAINT v2_fulfillment_handoffs_id_org_uidx UNIQUE (id, organization_id);
  END IF;
END $$;
