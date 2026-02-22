-- 0056_fulfillment_architecture_lock
-- Final lock adjustments for fulfillment backend architecture.
-- Assumes 0055_fulfillment_backend_architecture has been applied.

-- Shipments index alignment
CREATE INDEX IF NOT EXISTS shipments_org_primary_order_idx
  ON shipments (organization_id, primary_order_id);

-- Shipment items index alignment
CREATE INDEX IF NOT EXISTS shipment_items_org_shipment_idx
  ON shipment_items (organization_id, shipment_id);

-- Fulfillment events query index alignment
CREATE INDEX IF NOT EXISTS fulfillment_events_org_entity_idx
  ON fulfillment_events (organization_id, entity_type);
