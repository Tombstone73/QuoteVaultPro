-- M7.8I repair: allocation evidence is part of the same append-only shipment
-- economics history.  Preserve every existing event kind and row while
-- allowing the already-canonical equal/manual allocation writers.
ALTER TABLE v2_fulfillment_shipment_economics_events
  DROP CONSTRAINT v2_fulfillment_shipment_economics_events_kind_chk;

ALTER TABLE v2_fulfillment_shipment_economics_events
  ADD CONSTRAINT v2_fulfillment_shipment_economics_events_kind_chk CHECK (
    event_kind IN (
      'estimated_cost_set',
      'actual_cost_set',
      'customer_price_frozen',
      'shipping_allocation_equal',
      'shipping_allocation_manual'
    )
  );
