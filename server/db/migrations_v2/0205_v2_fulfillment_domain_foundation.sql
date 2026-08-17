-- M3 Slice 1: Fulfillment owns only completed customer handoffs and their
-- exact OrderLine allocations. Sales retains ordered quantity and cancellation.

CREATE TABLE v2_fulfillment_handoffs (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  order_document_id varchar NOT NULL,
  handoff_method varchar(16) NOT NULL,
  customer_id varchar,
  contact_id varchar,
  completed_at timestamptz NOT NULL DEFAULT now(),
  completed_principal_kind varchar(32) NOT NULL,
  completed_principal_subject varchar(255) NOT NULL,
  completed_staff_actor_user_id varchar REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT v2_fulfillment_handoffs_id_org_order_uidx UNIQUE (id, organization_id, order_document_id),
  CONSTRAINT v2_fulfillment_handoffs_order_tenant_fk FOREIGN KEY (order_document_id, organization_id)
    REFERENCES v2_sales_order_details (document_id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT v2_fulfillment_handoffs_customer_tenant_fk FOREIGN KEY (customer_id, organization_id)
    REFERENCES customers (id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT v2_fulfillment_handoffs_contact_tenant_fk FOREIGN KEY (contact_id, organization_id)
    REFERENCES customer_contacts (id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT v2_fulfillment_handoffs_method_chk CHECK (handoff_method IN ('pickup','shipment')),
  CONSTRAINT v2_fulfillment_handoffs_actor_chk CHECK (completed_principal_kind IN ('staff','delegated_ai','portal','service') AND length(btrim(completed_principal_subject)) > 0)
);

CREATE TABLE v2_fulfillment_handoff_lines (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  handoff_id varchar NOT NULL,
  order_document_id varchar NOT NULL,
  order_line_id varchar NOT NULL,
  quantity integer NOT NULL,
  CONSTRAINT v2_fulfillment_handoff_lines_id_org_uidx UNIQUE (id, organization_id),
  CONSTRAINT v2_fulfillment_handoff_lines_handoff_line_uidx UNIQUE (organization_id, handoff_id, order_line_id),
  CONSTRAINT v2_fulfillment_handoff_lines_handoff_tenant_fk FOREIGN KEY (handoff_id, organization_id, order_document_id)
    REFERENCES v2_fulfillment_handoffs (id, organization_id, order_document_id) ON DELETE RESTRICT,
  CONSTRAINT v2_fulfillment_handoff_lines_order_line_tenant_fk FOREIGN KEY (order_line_id, organization_id, order_document_id)
    REFERENCES v2_sales_document_lines (id, organization_id, document_id) ON DELETE RESTRICT,
  CONSTRAINT v2_fulfillment_handoff_lines_quantity_chk CHECK (quantity > 0)
);
CREATE INDEX v2_fulfillment_handoffs_org_order_completed_idx ON v2_fulfillment_handoffs (organization_id, order_document_id, completed_at DESC);
CREATE INDEX v2_fulfillment_handoff_lines_org_line_idx ON v2_fulfillment_handoff_lines (organization_id, order_document_id, order_line_id);

-- Completed customer handoffs are append-only operational history. The order
-- state check blocks raw SQL completion after cancellation; application code
-- additionally locks the Sales order and requested lines before aggregating.
CREATE OR REPLACE FUNCTION v2_fulfillment_immutable_validate() RETURNS trigger AS $$
BEGIN
  IF TG_TABLE_NAME = 'v2_fulfillment_handoffs' THEN
    IF TG_OP <> 'INSERT' THEN
      RAISE EXCEPTION 'Fulfillment handoff history is immutable' USING ERRCODE='23514';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM v2_sales_order_details o
      WHERE o.organization_id=NEW.organization_id AND o.document_id=NEW.order_document_id AND o.commercial_state='open'
    ) THEN
      RAISE EXCEPTION 'Fulfillment handoff requires an open Order' USING ERRCODE='23514';
    END IF;
  ELSIF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'Fulfillment handoff allocation history is immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER v2_fulfillment_handoff_immutable_trigger BEFORE INSERT OR UPDATE OR DELETE ON v2_fulfillment_handoffs
FOR EACH ROW EXECUTE FUNCTION v2_fulfillment_immutable_validate();
CREATE TRIGGER v2_fulfillment_handoff_line_immutable_trigger BEFORE INSERT OR UPDATE OR DELETE ON v2_fulfillment_handoff_lines
FOR EACH ROW EXECUTE FUNCTION v2_fulfillment_immutable_validate();

INSERT INTO v2_permission_capabilities(id,module,label) VALUES
  ('fulfillment.view','fulfillment','View fulfillment availability and handoff history'),
  ('fulfillment.pickup','fulfillment','Record completed customer pickups'),
  ('fulfillment.ship','fulfillment','Record completed customer shipments')
ON CONFLICT(id) DO NOTHING;
INSERT INTO v2_permission_set_template_capabilities(template_id,capability_id)
SELECT id,capability_id FROM v2_permission_set_templates CROSS JOIN (VALUES ('fulfillment.view'),('fulfillment.pickup'),('fulfillment.ship')) v(capability_id)
WHERE template_key IN ('owner','administrator') ON CONFLICT DO NOTHING;
