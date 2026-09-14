-- M7.8I: post-fulfillment replacement is a new operational obligation.  It
-- never rewrites the fulfilled handoff or the Production output that led to it.
CREATE TABLE v2_order_replacement_obligations (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  order_document_id varchar NOT NULL,
  order_line_id varchar NOT NULL,
  source_fulfillment_handoff_id varchar,
  source_shipment_id varchar,
  predecessor_replacement_obligation_id varchar,
  replacement_quantity integer NOT NULL,
  reason varchar(120) NOT NULL,
  responsibility varchar(24) NOT NULL,
  billing_treatment varchar(16) NOT NULL,
  note text,
  status varchar(24) NOT NULL DEFAULT 'open',
  created_at timestamptz NOT NULL DEFAULT now(),
  created_principal_kind varchar(32) NOT NULL,
  created_principal_subject varchar(255) NOT NULL,
  created_staff_actor_user_id varchar REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT v2_order_replacement_obligations_id_org_uidx UNIQUE(id,organization_id),
  CONSTRAINT v2_order_replacement_obligations_line_fk FOREIGN KEY(order_line_id,organization_id,order_document_id) REFERENCES v2_sales_document_lines(id,organization_id,document_id) ON DELETE RESTRICT,
  CONSTRAINT v2_order_replacement_obligations_source_handoff_fk FOREIGN KEY(source_fulfillment_handoff_id,organization_id) REFERENCES v2_fulfillment_handoffs(id,organization_id) ON DELETE RESTRICT,
  CONSTRAINT v2_order_replacement_obligations_source_shipment_fk FOREIGN KEY(source_shipment_id,organization_id) REFERENCES v2_fulfillment_shipments(id,organization_id) ON DELETE RESTRICT,
  CONSTRAINT v2_order_replacement_obligations_parent_fk FOREIGN KEY(predecessor_replacement_obligation_id,organization_id) REFERENCES v2_order_replacement_obligations(id,organization_id) ON DELETE RESTRICT,
  CONSTRAINT v2_order_replacement_obligations_quantity_chk CHECK(replacement_quantity>0),
  CONSTRAINT v2_order_replacement_obligations_reason_chk CHECK(length(btrim(reason))>0),
  CONSTRAINT v2_order_replacement_obligations_responsibility_chk CHECK(responsibility IN ('titan','customer','carrier','pending')),
  CONSTRAINT v2_order_replacement_obligations_billing_chk CHECK(billing_treatment IN ('no_charge','billable','pending')),
  CONSTRAINT v2_order_replacement_obligations_status_chk CHECK(status IN ('open','production_complete','fulfilled','cancelled')),
  CONSTRAINT v2_order_replacement_obligations_actor_chk CHECK(created_principal_kind IN ('staff','delegated_ai','service') AND length(btrim(created_principal_subject))>0)
);
CREATE INDEX v2_order_replacement_obligations_order_idx ON v2_order_replacement_obligations(organization_id,order_document_id,status,created_at);
CREATE INDEX v2_order_replacement_obligations_line_idx ON v2_order_replacement_obligations(organization_id,order_line_id,status);

ALTER TABLE v2_production_works ADD COLUMN replacement_obligation_id varchar;
ALTER TABLE v2_production_works ADD CONSTRAINT v2_production_works_replacement_obligation_fk FOREIGN KEY(replacement_obligation_id,organization_id) REFERENCES v2_order_replacement_obligations(id,organization_id) ON DELETE RESTRICT;
DROP INDEX v2_production_works_normal_assignment_uidx;
DROP INDEX v2_production_works_normal_requirement_uidx;
CREATE UNIQUE INDEX v2_production_works_normal_assignment_uidx ON v2_production_works(organization_id,artwork_assignment_id) WHERE rework_cycle_id IS NULL AND replacement_obligation_id IS NULL;
CREATE UNIQUE INDEX v2_production_works_normal_requirement_uidx ON v2_production_works(organization_id,order_line_id,requirement_key,artwork_assignment_id) WHERE rework_cycle_id IS NULL AND replacement_obligation_id IS NULL;
CREATE UNIQUE INDEX v2_production_works_replacement_obligation_uidx ON v2_production_works(organization_id,replacement_obligation_id) WHERE replacement_obligation_id IS NOT NULL;
ALTER TABLE v2_fulfillment_handoffs ADD COLUMN replacement_obligation_id varchar;
ALTER TABLE v2_fulfillment_handoffs ADD CONSTRAINT v2_fulfillment_handoffs_replacement_obligation_fk FOREIGN KEY(replacement_obligation_id,organization_id) REFERENCES v2_order_replacement_obligations(id,organization_id) ON DELETE RESTRICT;
CREATE INDEX v2_fulfillment_handoffs_replacement_obligation_idx ON v2_fulfillment_handoffs(organization_id,replacement_obligation_id) WHERE replacement_obligation_id IS NOT NULL;

-- Shipping cost and customer price are separate commercial facts.  A policy
-- snapshot is carried by the shipment, so later policy edits cannot reprice it.
ALTER TABLE v2_fulfillment_shipments
  ADD COLUMN estimated_carrier_cost_cents bigint,
  ADD COLUMN actual_carrier_cost_cents bigint,
  ADD COLUMN customer_shipping_price_cents bigint,
  ADD COLUMN shipping_pricing_policy_snapshot jsonb,
  ADD COLUMN shipping_responsibility varchar(24),
  ADD COLUMN shipping_reason varchar(120),
  ADD COLUMN shipping_note text,
  ADD CONSTRAINT v2_fulfillment_shipments_carrier_cost_chk CHECK ((estimated_carrier_cost_cents IS NULL OR estimated_carrier_cost_cents>=0) AND (actual_carrier_cost_cents IS NULL OR actual_carrier_cost_cents>=0) AND (customer_shipping_price_cents IS NULL OR customer_shipping_price_cents>=0)),
  ADD CONSTRAINT v2_fulfillment_shipments_shipping_responsibility_chk CHECK (shipping_responsibility IS NULL OR shipping_responsibility IN ('titan','customer','carrier','pending'));

CREATE TABLE v2_shipping_pricing_policies (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  customer_id varchar REFERENCES customers(id) ON DELETE CASCADE,
  mode varchar(24) NOT NULL,
  flat_amount_cents bigint,
  percentage_basis_points integer,
  currency varchar(3) NOT NULL DEFAULT 'USD',
  active boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_principal_kind varchar(32) NOT NULL,
  created_principal_subject varchar(255) NOT NULL,
  created_staff_actor_user_id varchar REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT v2_shipping_pricing_policies_mode_chk CHECK(mode IN ('pass_through','flat','percent','no_charge','manual')),
  CONSTRAINT v2_shipping_pricing_policies_values_chk CHECK((mode='flat' AND flat_amount_cents IS NOT NULL AND flat_amount_cents>=0) OR (mode='percent' AND percentage_basis_points IS NOT NULL AND percentage_basis_points>=0) OR (mode NOT IN ('flat','percent') AND flat_amount_cents IS NULL AND percentage_basis_points IS NULL)),
  CONSTRAINT v2_shipping_pricing_policies_version_chk CHECK(version>0),
  CONSTRAINT v2_shipping_pricing_policies_actor_chk CHECK(created_principal_kind IN ('staff','delegated_ai','service') AND length(btrim(created_principal_subject))>0)
);
CREATE UNIQUE INDEX v2_shipping_pricing_policies_one_active_org_uidx ON v2_shipping_pricing_policies(organization_id) WHERE customer_id IS NULL AND active;
CREATE UNIQUE INDEX v2_shipping_pricing_policies_one_active_customer_uidx ON v2_shipping_pricing_policies(organization_id,customer_id) WHERE customer_id IS NOT NULL AND active;

CREATE TABLE v2_fulfillment_shipment_shipping_allocations (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  shipment_id varchar NOT NULL,
  order_document_id varchar NOT NULL,
  customer_shipping_price_cents bigint NOT NULL,
  allocation_kind varchar(16) NOT NULL DEFAULT 'equal_split',
  invoiced_invoice_id varchar,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT v2_fulfillment_shipment_shipping_allocations_shipment_fk FOREIGN KEY(shipment_id,organization_id) REFERENCES v2_fulfillment_shipments(id,organization_id) ON DELETE RESTRICT,
  CONSTRAINT v2_fulfillment_shipment_shipping_allocations_order_fk FOREIGN KEY(order_document_id,organization_id) REFERENCES v2_sales_documents(id,organization_id) ON DELETE RESTRICT,
  CONSTRAINT v2_fulfillment_shipment_shipping_allocations_invoice_fk FOREIGN KEY(invoiced_invoice_id,organization_id) REFERENCES v2_billing_invoices(id,organization_id) ON DELETE RESTRICT,
  CONSTRAINT v2_fulfillment_shipment_shipping_allocations_unique_order UNIQUE(organization_id,shipment_id,order_document_id),
  CONSTRAINT v2_fulfillment_shipment_shipping_allocations_amount_chk CHECK(customer_shipping_price_cents>=0),
  CONSTRAINT v2_fulfillment_shipment_shipping_allocations_kind_chk CHECK(allocation_kind IN ('equal_split','manual'))
);
CREATE INDEX v2_fulfillment_shipment_shipping_allocations_invoice_idx ON v2_fulfillment_shipment_shipping_allocations(organization_id,invoiced_invoice_id) WHERE invoiced_invoice_id IS NOT NULL;

-- Actual carrier cost may arrive after a shipment is terminal.  It is an
-- append-only internal accounting observation and cannot reprice the customer.
CREATE TABLE v2_fulfillment_shipment_actual_cost_updates (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  shipment_id varchar NOT NULL,
  actual_carrier_cost_cents bigint NOT NULL,
  responsibility varchar(24) NOT NULL,
  reason varchar(120) NOT NULL,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_principal_kind varchar(32) NOT NULL,
  created_principal_subject varchar(255) NOT NULL,
  created_staff_actor_user_id varchar REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT v2_fulfillment_shipment_actual_cost_updates_shipment_fk FOREIGN KEY(shipment_id,organization_id) REFERENCES v2_fulfillment_shipments(id,organization_id) ON DELETE RESTRICT,
  CONSTRAINT v2_fulfillment_shipment_actual_cost_updates_cost_chk CHECK(actual_carrier_cost_cents>=0),
  CONSTRAINT v2_fulfillment_shipment_actual_cost_updates_responsibility_chk CHECK(responsibility IN ('titan','customer','carrier','pending')),
  CONSTRAINT v2_fulfillment_shipment_actual_cost_updates_reason_chk CHECK(length(btrim(reason))>0),
  CONSTRAINT v2_fulfillment_shipment_actual_cost_updates_actor_chk CHECK(created_principal_kind IN ('staff','delegated_ai','service') AND length(btrim(created_principal_subject))>0)
);
CREATE INDEX v2_fulfillment_shipment_actual_cost_updates_latest_idx ON v2_fulfillment_shipment_actual_cost_updates(organization_id,shipment_id,created_at DESC);

INSERT INTO v2_permission_capabilities(id,module,label) VALUES
 ('fulfillment.replace','fulfillment','Create post-fulfillment replacement obligations'),
 ('fulfillment.shipping.cost','fulfillment','Record internal shipment cost and absorbed freight'),
 ('fulfillment.shipping.price','fulfillment','Set customer shipping price and allocations')
ON CONFLICT(id) DO NOTHING;
INSERT INTO v2_permission_set_template_capabilities(template_id,capability_id)
SELECT id,capability_id FROM v2_permission_set_templates CROSS JOIN (VALUES
 ('fulfillment.replace'),('fulfillment.shipping.cost'),('fulfillment.shipping.price')
) v(capability_id) WHERE template_key IN ('owner','administrator') ON CONFLICT DO NOTHING;
