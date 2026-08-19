-- P7D.1: immutable recovery evidence for a P7C fact whose inventory effect
-- did not commit. Applied remains derived from the unique movement link.
CREATE TABLE v2_inventory_reconciliation_attempts (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  consumption_id varchar NOT NULL,
  business_request_id varchar NOT NULL,
  status varchar NOT NULL CHECK(status IN ('retryable','blocked')),
  error_code varchar(80) NOT NULL,
  error_message varchar(500) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT v2_inventory_reconciliation_attempts_consumption_fk FOREIGN KEY(consumption_id,organization_id) REFERENCES v2_production_material_consumptions(id,organization_id) ON DELETE RESTRICT
);
CREATE INDEX v2_inventory_reconciliation_attempts_fact_idx ON v2_inventory_reconciliation_attempts(organization_id,consumption_id,created_at DESC);
CREATE UNIQUE INDEX v2_inventory_reconciliation_attempts_request_uidx ON v2_inventory_reconciliation_attempts(organization_id,consumption_id,business_request_id);
CREATE OR REPLACE FUNCTION v2_inventory_reconciliation_attempt_validate() RETURNS trigger AS $$
BEGIN
  IF TG_OP IN ('UPDATE','DELETE') THEN RAISE EXCEPTION 'Inventory reconciliation attempts are immutable' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER v2_inventory_reconciliation_attempt_validate_trigger BEFORE INSERT OR UPDATE OR DELETE ON v2_inventory_reconciliation_attempts FOR EACH ROW EXECUTE FUNCTION v2_inventory_reconciliation_attempt_validate();
