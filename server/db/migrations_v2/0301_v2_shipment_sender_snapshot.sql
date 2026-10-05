-- Shipping-owned immutable prepared sender evidence. No historical backfill.
ALTER TABLE v2_fulfillment_shipment_prepared_revisions ADD COLUMN sender_snapshot jsonb;
ALTER TABLE v2_fulfillment_shipment_prepared_revisions ADD CONSTRAINT v2_shipment_sender_snapshot_shape_chk CHECK (
  sender_snapshot IS NULL OR COALESCE((
    jsonb_typeof(sender_snapshot)='object' AND sender_snapshot->>'version'='1'
    AND jsonb_typeof(sender_snapshot->'blindShipping')='boolean'
    AND jsonb_typeof(sender_snapshot->'intents')='array'
    AND (sender_snapshot->>'source') IN ('customer','custom','organization')
    AND ((sender_snapshot->>'blindShipping')::boolean = ((sender_snapshot->>'source') <> 'organization'))
    AND (NOT (sender_snapshot->>'blindShipping')::boolean OR jsonb_typeof(sender_snapshot->'sender')='object')
  ),false)
);
-- The existing whole-row UPDATE/DELETE guards protect this field as well.
-- Historical NULL revisions require explicit correction before handoff.
