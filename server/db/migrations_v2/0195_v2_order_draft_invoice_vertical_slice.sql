-- M1.9: direct Orders coordinate Sales, Billing, and Routing in one V2
-- transaction. Billing owns every invoice table below; Sales owns no invoice
-- state and Routing owns no Sales line state.

ALTER TABLE product_types
  ADD CONSTRAINT product_types_id_organization_uidx UNIQUE (id, organization_id);

ALTER TABLE v2_sales_document_lines
  ADD CONSTRAINT v2_sales_document_lines_id_organization_document_uidx
  UNIQUE (id, organization_id, document_id),
  ADD CONSTRAINT v2_sales_document_lines_product_type_tenant_fk
  FOREIGN KEY (product_type_id, organization_id)
  REFERENCES product_types (id, organization_id) ON DELETE RESTRICT;

-- M1.8 deliberately deferred real Sales-work linkage until the first Order
-- writer. A route now has a physical, tenant-scoped Order header and line.
ALTER TABLE v2_route_instances
  ADD CONSTRAINT v2_route_instances_order_tenant_fk
  FOREIGN KEY (order_document_id, organization_id)
  REFERENCES v2_sales_order_details (document_id, organization_id) ON DELETE RESTRICT,
  ADD CONSTRAINT v2_route_instances_order_line_tenant_fk
  FOREIGN KEY (order_line_id, organization_id, order_document_id)
  REFERENCES v2_sales_document_lines (id, organization_id, document_id) ON DELETE RESTRICT;

CREATE TABLE v2_billing_invoices (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  sales_order_document_id varchar NOT NULL,
  invoice_state varchar(24) NOT NULL DEFAULT 'draft',
  customer_id varchar,
  contact_id varchar,
  purchase_order_number varchar(255),
  currency varchar(3) NOT NULL,
  terms_code varchar(120),
  source_sales_state_token varchar(80) NOT NULL,
  synchronization_version bigint NOT NULL DEFAULT 1,
  subtotal_cents bigint NOT NULL,
  tax_total_cents bigint NOT NULL DEFAULT 0,
  total_cents bigint NOT NULL,
  tax_context_reference varchar(255),
  tax_calculator_version varchar(120) NOT NULL,
  tax_evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  issued_at timestamptz,
  voided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT v2_billing_invoices_state_chk CHECK (invoice_state IN ('draft','issued','void')),
  CONSTRAINT v2_billing_invoices_currency_chk CHECK (currency ~ '^[A-Z]{3}$'),
  CONSTRAINT v2_billing_invoices_sales_token_chk CHECK (length(btrim(source_sales_state_token)) > 0),
  CONSTRAINT v2_billing_invoices_sync_version_chk CHECK (synchronization_version > 0),
  CONSTRAINT v2_billing_invoices_tax_evidence_object_chk CHECK (jsonb_typeof(tax_evidence) = 'object'),
  CONSTRAINT v2_billing_invoices_total_chk CHECK (total_cents = subtotal_cents + tax_total_cents),
  CONSTRAINT v2_billing_invoices_state_time_chk CHECK (
    (invoice_state = 'draft' AND issued_at IS NULL AND voided_at IS NULL)
    OR (invoice_state = 'issued' AND issued_at IS NOT NULL AND voided_at IS NULL)
    OR (invoice_state = 'void' AND voided_at IS NOT NULL)
  ),
  CONSTRAINT v2_billing_invoices_id_organization_uidx UNIQUE (id, organization_id),
  CONSTRAINT v2_billing_invoices_id_organization_order_uidx UNIQUE (id, organization_id, sales_order_document_id),
  CONSTRAINT v2_billing_invoices_order_tenant_fk FOREIGN KEY (sales_order_document_id, organization_id)
    REFERENCES v2_sales_order_details (document_id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT v2_billing_invoices_customer_tenant_fk FOREIGN KEY (customer_id, organization_id)
    REFERENCES customers (id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT v2_billing_invoices_contact_tenant_fk FOREIGN KEY (contact_id, organization_id)
    REFERENCES customer_contacts (id, organization_id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX v2_billing_invoices_one_draft_per_order_uidx
  ON v2_billing_invoices (organization_id, sales_order_document_id)
  WHERE invoice_state = 'draft';
CREATE INDEX v2_billing_invoices_org_state_updated_idx
  ON v2_billing_invoices (organization_id, invoice_state, updated_at DESC);

CREATE TABLE v2_billing_invoice_lines (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organization_id varchar NOT NULL,
  invoice_id varchar NOT NULL,
  sales_order_document_id varchar NOT NULL,
  source_sales_line_id varchar NOT NULL,
  position integer NOT NULL,
  product_id varchar NOT NULL,
  description text NOT NULL,
  quantity integer NOT NULL,
  currency varchar(3) NOT NULL,
  selling_unit_cents bigint NOT NULL,
  selling_line_cents bigint NOT NULL,
  sales_pricing_evidence_fingerprint varchar(128) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT v2_billing_invoice_lines_position_chk CHECK (position >= 0),
  CONSTRAINT v2_billing_invoice_lines_description_chk CHECK (length(btrim(description)) > 0),
  CONSTRAINT v2_billing_invoice_lines_quantity_chk CHECK (quantity > 0),
  CONSTRAINT v2_billing_invoice_lines_currency_chk CHECK (currency ~ '^[A-Z]{3}$'),
  CONSTRAINT v2_billing_invoice_lines_pricing_fingerprint_chk CHECK (length(btrim(sales_pricing_evidence_fingerprint)) > 0),
  CONSTRAINT v2_billing_invoice_lines_id_invoice_organization_uidx UNIQUE (id, invoice_id, organization_id),
  CONSTRAINT v2_billing_invoice_lines_invoice_position_uidx UNIQUE (invoice_id, organization_id, position),
  CONSTRAINT v2_billing_invoice_lines_invoice_source_line_uidx UNIQUE (invoice_id, organization_id, source_sales_line_id),
  CONSTRAINT v2_billing_invoice_lines_invoice_tenant_fk FOREIGN KEY (invoice_id, organization_id, sales_order_document_id)
    REFERENCES v2_billing_invoices (id, organization_id, sales_order_document_id) ON DELETE RESTRICT,
  CONSTRAINT v2_billing_invoice_lines_source_sales_line_tenant_fk FOREIGN KEY (source_sales_line_id, organization_id, sales_order_document_id)
    REFERENCES v2_sales_document_lines (id, organization_id, document_id) ON DELETE RESTRICT
);
CREATE INDEX v2_billing_invoice_lines_org_source_line_idx
  ON v2_billing_invoice_lines (organization_id, source_sales_line_id);

-- Override authority is intentionally distinct from Order create/edit.
INSERT INTO v2_permission_capabilities(id,module,label)
VALUES ('order.overridePrice','sales','Override order calculated price')
ON CONFLICT(id) DO NOTHING;
INSERT INTO v2_permission_set_template_capabilities(template_id,capability_id)
SELECT id,'order.overridePrice' FROM v2_permission_set_templates
WHERE template_key IN ('owner','administrator','sales') ON CONFLICT DO NOTHING;
INSERT INTO v2_permission_set_capabilities(organization_id,permission_set_id,capability_id)
SELECT organization_id,id,'order.overridePrice' FROM v2_permission_sets
WHERE source_template_key IN ('owner','administrator','sales') ON CONFLICT DO NOTHING;
