-- M7.8I: shipment economics is an internal, append-only staff authority.
-- A frozen customer price is evidence, never a recalculated projection.
ALTER TABLE v2_fulfillment_shipments
  ADD COLUMN customer_shipping_price_frozen_at timestamptz,
  ADD CONSTRAINT v2_fulfillment_shipments_shipping_price_freeze_chk CHECK (
    (customer_shipping_price_cents IS NULL AND customer_shipping_price_frozen_at IS NULL AND shipping_pricing_policy_snapshot IS NULL)
    OR
    (customer_shipping_price_cents IS NOT NULL AND customer_shipping_price_frozen_at IS NOT NULL AND shipping_pricing_policy_snapshot IS NOT NULL)
  ) NOT VALID;

CREATE TABLE v2_fulfillment_shipment_economics_events (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  shipment_id varchar NOT NULL,
  event_kind varchar(32) NOT NULL,
  detail jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  principal_kind varchar(32) NOT NULL,
  principal_subject varchar(255) NOT NULL,
  staff_actor_user_id varchar REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT v2_fulfillment_shipment_economics_events_shipment_fk FOREIGN KEY(shipment_id,organization_id)
    REFERENCES v2_fulfillment_shipments(id,organization_id) ON DELETE RESTRICT,
  CONSTRAINT v2_fulfillment_shipment_economics_events_kind_chk CHECK(event_kind IN ('estimated_cost_set','actual_cost_set','customer_price_frozen')),
  CONSTRAINT v2_fulfillment_shipment_economics_events_detail_chk CHECK(jsonb_typeof(detail)='object'),
  CONSTRAINT v2_fulfillment_shipment_economics_events_actor_chk CHECK(principal_kind IN ('staff','delegated_ai','service') AND length(btrim(principal_subject))>0)
);
CREATE INDEX v2_fulfillment_shipment_economics_events_history_idx ON v2_fulfillment_shipment_economics_events(organization_id,shipment_id,created_at,id);
CREATE TRIGGER v2_fulfillment_shipment_economics_events_immutable_trigger
  BEFORE UPDATE OR DELETE ON v2_fulfillment_shipment_economics_events
  FOR EACH ROW EXECUTE FUNCTION v2_fulfillment_shipment_recovery_immutable_validate();

CREATE TABLE v2_shipping_pricing_policy_events (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  customer_id varchar,
  event_kind varchar(24) NOT NULL,
  detail jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  principal_kind varchar(32) NOT NULL,
  principal_subject varchar(255) NOT NULL,
  staff_actor_user_id varchar REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT v2_shipping_pricing_policy_events_customer_fk FOREIGN KEY(customer_id,organization_id) REFERENCES customers(id,organization_id) ON DELETE RESTRICT,
  CONSTRAINT v2_shipping_pricing_policy_events_kind_chk CHECK(event_kind IN ('organization_default_set','customer_override_set','customer_override_cleared')),
  CONSTRAINT v2_shipping_pricing_policy_events_detail_chk CHECK(jsonb_typeof(detail)='object'),
  CONSTRAINT v2_shipping_pricing_policy_events_actor_chk CHECK(principal_kind IN ('staff','delegated_ai','service') AND length(btrim(principal_subject))>0)
);
CREATE INDEX v2_shipping_pricing_policy_events_history_idx ON v2_shipping_pricing_policy_events(organization_id,customer_id,created_at,id);
CREATE TRIGGER v2_shipping_pricing_policy_events_immutable_trigger
  BEFORE UPDATE OR DELETE ON v2_shipping_pricing_policy_events
  FOR EACH ROW EXECUTE FUNCTION v2_fulfillment_shipment_recovery_immutable_validate();
