-- M7.8I: a shipment's frozen customer freight may be allocated by Order and
-- projected exactly once to the canonical Invoice for that work.  Freight is
-- deliberately an Invoice additional charge, never a fake Product/Order line.
ALTER TABLE v2_fulfillment_shipment_shipping_allocations
  ADD COLUMN membership_fingerprint varchar(128),
  ADD COLUMN projected_at timestamptz;

CREATE TABLE v2_billing_invoice_additional_charges (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  invoice_id varchar NOT NULL,
  sales_order_document_id varchar NOT NULL,
  charge_kind varchar(32) NOT NULL,
  source_shipment_id varchar NOT NULL,
  shipment_shipping_allocation_id varchar NOT NULL,
  customer_charge_cents bigint NOT NULL,
  tax_cents bigint NOT NULL,
  tax_evidence jsonb NOT NULL,
  customer_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_principal_kind varchar(32) NOT NULL,
  created_principal_subject varchar(255) NOT NULL,
  created_staff_actor_user_id varchar REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT v2_billing_invoice_additional_charges_invoice_fk FOREIGN KEY(invoice_id,organization_id) REFERENCES v2_billing_invoices(id,organization_id) ON DELETE RESTRICT,
  CONSTRAINT v2_billing_invoice_additional_charges_order_fk FOREIGN KEY(sales_order_document_id,organization_id) REFERENCES v2_sales_documents(id,organization_id) ON DELETE RESTRICT,
  CONSTRAINT v2_billing_invoice_additional_charges_shipment_fk FOREIGN KEY(source_shipment_id,organization_id) REFERENCES v2_fulfillment_shipments(id,organization_id) ON DELETE RESTRICT,
  CONSTRAINT v2_billing_invoice_additional_charges_allocation_fk FOREIGN KEY(shipment_shipping_allocation_id,organization_id) REFERENCES v2_fulfillment_shipment_shipping_allocations(id,organization_id) ON DELETE RESTRICT,
  CONSTRAINT v2_billing_invoice_additional_charges_kind_chk CHECK(charge_kind IN ('shipping')),
  CONSTRAINT v2_billing_invoice_additional_charges_amount_chk CHECK(customer_charge_cents >= 0 AND tax_cents >= 0),
  CONSTRAINT v2_billing_invoice_additional_charges_tax_evidence_chk CHECK(jsonb_typeof(tax_evidence) = 'object'),
  CONSTRAINT v2_billing_invoice_additional_charges_actor_chk CHECK(created_principal_kind IN ('staff','delegated_ai','service') AND length(btrim(created_principal_subject)) > 0),
  CONSTRAINT v2_billing_invoice_additional_charges_allocation_uidx UNIQUE(organization_id, shipment_shipping_allocation_id)
);
CREATE INDEX v2_billing_invoice_additional_charges_invoice_idx ON v2_billing_invoice_additional_charges(organization_id,invoice_id,created_at);

-- The immutable issuance checkpoint is intentionally not changed.  This is
-- ordered evidence for the subsequently revised live Invoice projection.
CREATE TABLE v2_billing_invoice_revisions (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  invoice_id varchar NOT NULL,
  revision_number integer NOT NULL,
  revision_kind varchar(32) NOT NULL,
  detail jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_principal_kind varchar(32) NOT NULL,
  created_principal_subject varchar(255) NOT NULL,
  created_staff_actor_user_id varchar REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT v2_billing_invoice_revisions_invoice_fk FOREIGN KEY(invoice_id,organization_id) REFERENCES v2_billing_invoices(id,organization_id) ON DELETE RESTRICT,
  CONSTRAINT v2_billing_invoice_revisions_number_chk CHECK(revision_number > 0),
  CONSTRAINT v2_billing_invoice_revisions_kind_chk CHECK(revision_kind IN ('additional_charge')),
  CONSTRAINT v2_billing_invoice_revisions_detail_chk CHECK(jsonb_typeof(detail) = 'object'),
  CONSTRAINT v2_billing_invoice_revisions_actor_chk CHECK(created_principal_kind IN ('staff','delegated_ai','service') AND length(btrim(created_principal_subject)) > 0),
  CONSTRAINT v2_billing_invoice_revisions_unique_number UNIQUE(organization_id,invoice_id,revision_number)
);
CREATE INDEX v2_billing_invoice_revisions_invoice_idx ON v2_billing_invoice_revisions(organization_id,invoice_id,revision_number);
