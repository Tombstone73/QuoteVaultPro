-- Additive carrier-only projection. No Order or internal fulfillment state is changed.
CREATE UNIQUE INDEX shipments_org_identity_uidx ON shipments(organization_id,id);
CREATE TABLE shipment_tracking_states (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id varchar NOT NULL,
  shipment_id varchar NOT NULL,
  carrier varchar(20) NOT NULL,
  tracking_number varchar(255) NOT NULL,
  status varchar(24) NOT NULL DEFAULT 'unavailable' CHECK (status IN ('label_created','awaiting_package','in_transit','out_for_delivery','delivered','exception','unavailable')),
  last_event_at timestamptz,
  estimated_delivery_date date,
  delivered_at timestamptz,
  last_checked_at timestamptz,
  error_code varchar(64),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_check_at timestamptz NOT NULL DEFAULT now(),
  claim_token varchar,
  claim_until timestamptz,
  CONSTRAINT shipment_tracking_owner_fk FOREIGN KEY (organization_id,shipment_id) REFERENCES shipments(organization_id,id) ON DELETE CASCADE,
  CHECK ((claim_token IS NULL) = (claim_until IS NULL))
);
CREATE UNIQUE INDEX shipment_tracking_identity_uidx ON shipment_tracking_states(organization_id,shipment_id,carrier,tracking_number);
CREATE UNIQUE INDEX shipment_tracking_org_id_uidx ON shipment_tracking_states(organization_id,id);
CREATE INDEX shipment_tracking_due_idx ON shipment_tracking_states(next_check_at);
CREATE TABLE shipment_tracking_events (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id varchar NOT NULL,
  tracking_state_id varchar NOT NULL,
  event_key varchar(64) NOT NULL,
  status varchar(24) NOT NULL CHECK (status IN ('label_created','awaiting_package','in_transit','out_for_delivery','delivered','exception','unavailable')),
  occurred_at timestamptz NOT NULL,
  description text NOT NULL,
  estimated_delivery_date date,
  received_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT shipment_tracking_event_owner_fk FOREIGN KEY (organization_id,tracking_state_id) REFERENCES shipment_tracking_states(organization_id,id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX shipment_tracking_event_uidx ON shipment_tracking_events(tracking_state_id,event_key);
