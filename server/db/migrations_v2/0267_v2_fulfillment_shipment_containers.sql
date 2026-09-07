-- M7.5G: a shipment is a physical container, distinct from the immutable
-- per-Order customer handoff facts that it eventually carries.  Prepared
-- containers deliberately have no fulfillment allocation effect.
CREATE TABLE v2_fulfillment_shipments (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  customer_id varchar REFERENCES customers(id) ON DELETE RESTRICT,
  destination jsonb,
  shipment_status varchar(16) NOT NULL DEFAULT 'prepared',
  manual_carrier_name varchar(120),
  manual_carrier_service varchar(120),
  manual_tracking_number varchar(180),
  notes varchar(2000),
  package_count integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_principal_kind varchar(32) NOT NULL,
  created_principal_subject varchar(255) NOT NULL,
  created_staff_actor_user_id varchar REFERENCES users(id) ON DELETE RESTRICT,
  shipped_at timestamptz,
  shipped_principal_kind varchar(32),
  shipped_principal_subject varchar(255),
  shipped_staff_actor_user_id varchar REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT v2_fulfillment_shipments_status_chk CHECK (shipment_status IN ('prepared','shipped')),
  CONSTRAINT v2_fulfillment_shipments_package_count_chk CHECK (package_count IS NULL OR package_count > 0),
  CONSTRAINT v2_fulfillment_shipments_shipped_chk CHECK ((shipment_status='prepared' AND shipped_at IS NULL AND shipped_principal_kind IS NULL AND shipped_principal_subject IS NULL) OR (shipment_status='shipped' AND shipped_at IS NOT NULL AND shipped_principal_kind IS NOT NULL AND shipped_principal_subject IS NOT NULL)),
  CONSTRAINT v2_fulfillment_shipments_actor_chk CHECK (created_principal_kind IN ('staff','delegated_ai','portal','service') AND length(btrim(created_principal_subject))>0),
  CONSTRAINT v2_fulfillment_shipments_shipped_actor_chk CHECK (shipped_principal_kind IS NULL OR shipped_principal_kind IN ('staff','delegated_ai','portal','service'))
);
CREATE INDEX v2_fulfillment_shipments_org_status_idx ON v2_fulfillment_shipments(organization_id,shipment_status,created_at DESC);

-- Only completed immutable shipment handoffs may be attached. Each handoff is
-- carried by at most one physical container, preserving per-Order history.
CREATE TABLE v2_fulfillment_shipment_handoffs (
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  shipment_id varchar NOT NULL REFERENCES v2_fulfillment_shipments(id) ON DELETE RESTRICT,
  handoff_id varchar NOT NULL,
  attached_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id,shipment_id,handoff_id),
  CONSTRAINT v2_fulfillment_shipment_handoffs_once_uidx UNIQUE (organization_id,handoff_id),
  CONSTRAINT v2_fulfillment_shipment_handoffs_handoff_fk FOREIGN KEY (handoff_id,organization_id) REFERENCES v2_fulfillment_handoffs(id,organization_id) ON DELETE RESTRICT
);
CREATE OR REPLACE FUNCTION v2_fulfillment_shipment_handoff_validate() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM v2_fulfillment_handoffs h JOIN v2_fulfillment_shipments s ON s.organization_id=h.organization_id AND s.id=NEW.shipment_id WHERE h.organization_id=NEW.organization_id AND h.id=NEW.handoff_id AND h.handoff_method='shipment' AND s.shipment_status='shipped') THEN
    RAISE EXCEPTION 'Only shipped containers may contain immutable shipment handoffs' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER v2_fulfillment_shipment_handoff_validate_trigger BEFORE INSERT OR UPDATE OR DELETE ON v2_fulfillment_shipment_handoffs
FOR EACH ROW EXECUTE FUNCTION v2_fulfillment_shipment_handoff_validate();
