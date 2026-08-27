-- Completed handoffs are immutable physical facts. Their printed customer
-- documents need the exact contemporary presentation, not today's Sales/CRM.
-- The paired parent key is established before the child FK. 0231 had never
-- committed because PostgreSQL rejects a composite FK without this exact key.
ALTER TABLE v2_fulfillment_handoffs
  ADD CONSTRAINT v2_fulfillment_handoffs_id_org_uidx UNIQUE (id, organization_id);

CREATE TABLE v2_fulfillment_handoff_document_snapshots (
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  handoff_id varchar NOT NULL,
  snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id,handoff_id),
  CONSTRAINT v2_fulfillment_handoff_document_snapshot_handoff_fk FOREIGN KEY (handoff_id,organization_id)
    REFERENCES v2_fulfillment_handoffs(id,organization_id) ON DELETE RESTRICT,
  CONSTRAINT v2_fulfillment_handoff_document_snapshot_nonempty_chk CHECK (snapshot ? 'orderNumber' AND snapshot ? 'method' AND snapshot ? 'lines')
);
CREATE OR REPLACE FUNCTION v2_fulfillment_handoff_document_snapshot_immutable() RETURNS trigger AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'Fulfillment handoff document snapshot is immutable' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER v2_fulfillment_handoff_document_snapshot_immutable_trigger BEFORE INSERT OR UPDATE OR DELETE ON v2_fulfillment_handoff_document_snapshots
FOR EACH ROW EXECUTE FUNCTION v2_fulfillment_handoff_document_snapshot_immutable();
