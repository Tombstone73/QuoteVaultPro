-- V2 M1.6 commercial persistence foundation.
-- This is deliberately additive. V1 remains operational while future Sales
-- writers use these isolated V2 tables through module contracts.

-- V1 CRM/Product rows are compatibility references, but these compound keys
-- make an accidental cross-organization reference structurally impossible.
ALTER TABLE products
  ADD CONSTRAINT products_id_organization_uidx UNIQUE (id, organization_id);
ALTER TABLE customer_contacts
  ADD CONSTRAINT customer_contacts_id_organization_uidx UNIQUE (id, organization_id);

CREATE TABLE v2_sales_document_number_counters (
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  document_kind varchar(16) NOT NULL,
  next_number bigint NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT v2_sales_document_number_counters_kind_chk CHECK (document_kind IN ('quote', 'order')),
  CONSTRAINT v2_sales_document_number_counters_next_number_chk CHECK (next_number > 0),
  PRIMARY KEY (organization_id, document_kind)
);

CREATE TABLE v2_sales_documents (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  document_kind varchar(16) NOT NULL,
  business_number bigint NOT NULL,
  display_number varchar(80) NOT NULL,
  customer_id varchar,
  contact_id varchar,
  purchase_order_number varchar(255),
  requested_due_date date,
  currency varchar(3) NOT NULL,
  terms_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  tax_context_reference varchar(255),
  sales_representative_id varchar,
  commercial_notes text,
  revision bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT v2_sales_documents_kind_chk CHECK (document_kind IN ('quote', 'order')),
  CONSTRAINT v2_sales_documents_business_number_chk CHECK (business_number > 0),
  CONSTRAINT v2_sales_documents_display_number_chk CHECK (length(btrim(display_number)) > 0),
  CONSTRAINT v2_sales_documents_currency_chk CHECK (currency ~ '^[A-Z]{3}$'),
  CONSTRAINT v2_sales_documents_terms_object_chk CHECK (jsonb_typeof(terms_json) = 'object'),
  CONSTRAINT v2_sales_documents_revision_chk CHECK (revision > 0),
  CONSTRAINT v2_sales_documents_customer_or_contact_chk CHECK (customer_id IS NOT NULL OR contact_id IS NOT NULL),
  CONSTRAINT v2_sales_documents_id_organization_uidx UNIQUE (id, organization_id),
  CONSTRAINT v2_sales_documents_id_organization_kind_uidx UNIQUE (id, organization_id, document_kind),
  CONSTRAINT v2_sales_documents_org_kind_number_uidx UNIQUE (organization_id, document_kind, business_number),
  CONSTRAINT v2_sales_documents_org_kind_display_number_uidx UNIQUE (organization_id, document_kind, display_number),
  CONSTRAINT v2_sales_documents_customer_tenant_fk FOREIGN KEY (customer_id, organization_id)
    REFERENCES customers (id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT v2_sales_documents_contact_tenant_fk FOREIGN KEY (contact_id, organization_id)
    REFERENCES customer_contacts (id, organization_id) ON DELETE RESTRICT
);
CREATE INDEX v2_sales_documents_org_kind_updated_idx
  ON v2_sales_documents (organization_id, document_kind, updated_at DESC);

CREATE TABLE v2_sales_quote_details (
  document_id varchar PRIMARY KEY,
  organization_id varchar NOT NULL,
  document_kind varchar(16) NOT NULL DEFAULT 'quote',
  expires_at timestamptz,
  delivery_state varchar(24) NOT NULL DEFAULT 'not_sent',
  acceptance_state varchar(24) NOT NULL DEFAULT 'not_accepted',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT v2_sales_quote_details_kind_chk CHECK (document_kind = 'quote'),
  CONSTRAINT v2_sales_quote_details_delivery_state_chk CHECK (delivery_state IN ('not_sent', 'sent')),
  CONSTRAINT v2_sales_quote_details_acceptance_state_chk CHECK (acceptance_state IN ('not_accepted', 'accepted')),
  CONSTRAINT v2_sales_quote_details_id_organization_uidx UNIQUE (document_id, organization_id),
  CONSTRAINT v2_sales_quote_details_document_fk FOREIGN KEY (document_id, organization_id, document_kind)
    REFERENCES v2_sales_documents (id, organization_id, document_kind) ON DELETE RESTRICT
);

CREATE TABLE v2_sales_order_details (
  document_id varchar PRIMARY KEY,
  organization_id varchar NOT NULL,
  document_kind varchar(16) NOT NULL DEFAULT 'order',
  commercial_state varchar(24) NOT NULL DEFAULT 'open',
  cancelled_at timestamptz,
  cancellation_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT v2_sales_order_details_kind_chk CHECK (document_kind = 'order'),
  CONSTRAINT v2_sales_order_details_commercial_state_chk CHECK (commercial_state IN ('open', 'cancelled')),
  CONSTRAINT v2_sales_order_details_cancellation_chk CHECK (
    (commercial_state = 'open' AND cancelled_at IS NULL AND cancellation_reason IS NULL)
    OR (commercial_state = 'cancelled' AND cancelled_at IS NOT NULL AND length(btrim(cancellation_reason)) > 0)
  ),
  CONSTRAINT v2_sales_order_details_id_organization_uidx UNIQUE (document_id, organization_id),
  CONSTRAINT v2_sales_order_details_document_fk FOREIGN KEY (document_id, organization_id, document_kind)
    REFERENCES v2_sales_documents (id, organization_id, document_kind) ON DELETE RESTRICT
);

CREATE TABLE v2_sales_document_lines (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organization_id varchar NOT NULL,
  document_id varchar NOT NULL,
  position integer NOT NULL,
  product_id varchar NOT NULL,
  product_type_id varchar,
  description text NOT NULL,
  quantity integer NOT NULL,
  currency varchar(3) NOT NULL,
  calculated_unit_cents bigint NOT NULL,
  calculated_line_cents bigint NOT NULL,
  selling_unit_cents bigint NOT NULL,
  selling_line_cents bigint NOT NULL,
  pricing_result_id varchar NOT NULL,
  pricing_evidence_fingerprint varchar(128) NOT NULL,
  resolved_configuration jsonb NOT NULL,
  pricing_result jsonb NOT NULL,
  selling_price_decision jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT v2_sales_document_lines_position_chk CHECK (position >= 0),
  CONSTRAINT v2_sales_document_lines_description_chk CHECK (length(btrim(description)) > 0),
  CONSTRAINT v2_sales_document_lines_quantity_chk CHECK (quantity > 0),
  CONSTRAINT v2_sales_document_lines_currency_chk CHECK (currency ~ '^[A-Z]{3}$'),
  CONSTRAINT v2_sales_document_lines_pricing_result_id_chk CHECK (length(btrim(pricing_result_id)) > 0),
  CONSTRAINT v2_sales_document_lines_pricing_evidence_fingerprint_chk CHECK (length(btrim(pricing_evidence_fingerprint)) > 0),
  CONSTRAINT v2_sales_document_lines_resolved_configuration_object_chk CHECK (jsonb_typeof(resolved_configuration) = 'object'),
  CONSTRAINT v2_sales_document_lines_pricing_result_object_chk CHECK (jsonb_typeof(pricing_result) = 'object'),
  CONSTRAINT v2_sales_document_lines_selling_decision_object_chk CHECK (jsonb_typeof(selling_price_decision) = 'object'),
  CONSTRAINT v2_sales_document_lines_id_organization_uidx UNIQUE (id, organization_id),
  CONSTRAINT v2_sales_document_lines_org_document_position_uidx UNIQUE (organization_id, document_id, position),
  CONSTRAINT v2_sales_document_lines_document_tenant_fk FOREIGN KEY (document_id, organization_id)
    REFERENCES v2_sales_documents (id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT v2_sales_document_lines_product_tenant_fk FOREIGN KEY (product_id, organization_id)
    REFERENCES products (id, organization_id) ON DELETE RESTRICT
);
CREATE INDEX v2_sales_document_lines_org_product_idx ON v2_sales_document_lines (organization_id, product_id);

CREATE TABLE v2_sales_quote_checkpoints (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organization_id varchar NOT NULL,
  quote_document_id varchar NOT NULL,
  checkpoint_sequence integer NOT NULL,
  checkpoint_kind varchar(32) NOT NULL,
  schema_version integer NOT NULL,
  occurred_at timestamptz NOT NULL,
  principal_kind varchar(32) NOT NULL,
  principal_subject varchar(160) NOT NULL,
  staff_actor_user_id varchar,
  operation_request_id varchar,
  source_checkpoint_id varchar,
  evidence_fingerprint varchar(128) NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT v2_sales_quote_checkpoints_sequence_chk CHECK (checkpoint_sequence > 0),
  CONSTRAINT v2_sales_quote_checkpoints_kind_chk CHECK (checkpoint_kind IN ('quote_sent', 'quote_accepted', 'quote_converted')),
  CONSTRAINT v2_sales_quote_checkpoints_schema_version_chk CHECK (schema_version > 0),
  CONSTRAINT v2_sales_quote_checkpoints_principal_kind_chk CHECK (principal_kind IN ('staff', 'delegated_ai', 'portal', 'service')),
  CONSTRAINT v2_sales_quote_checkpoints_payload_object_chk CHECK (jsonb_typeof(payload) = 'object'),
  CONSTRAINT v2_sales_quote_checkpoints_evidence_fingerprint_chk CHECK (length(btrim(evidence_fingerprint)) > 0),
  CONSTRAINT v2_sales_quote_checkpoints_id_organization_quote_uidx UNIQUE (id, organization_id, quote_document_id),
  CONSTRAINT v2_sales_quote_checkpoints_org_quote_sequence_uidx UNIQUE (organization_id, quote_document_id, checkpoint_sequence),
  CONSTRAINT v2_sales_quote_checkpoints_org_quote_kind_evidence_uidx UNIQUE (organization_id, quote_document_id, checkpoint_kind, evidence_fingerprint),
  CONSTRAINT v2_sales_quote_checkpoints_quote_tenant_fk FOREIGN KEY (quote_document_id, organization_id)
    REFERENCES v2_sales_quote_details (document_id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT v2_sales_quote_checkpoints_request_tenant_fk FOREIGN KEY (operation_request_id, organization_id)
    REFERENCES v2_operation_requests (id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT v2_sales_quote_checkpoints_source_tenant_fk FOREIGN KEY (source_checkpoint_id, organization_id, quote_document_id)
    REFERENCES v2_sales_quote_checkpoints (id, organization_id, quote_document_id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX v2_sales_quote_checkpoints_one_acceptance_uidx
  ON v2_sales_quote_checkpoints (organization_id, quote_document_id) WHERE checkpoint_kind = 'quote_accepted';
CREATE UNIQUE INDEX v2_sales_quote_checkpoints_one_conversion_uidx
  ON v2_sales_quote_checkpoints (organization_id, quote_document_id) WHERE checkpoint_kind = 'quote_converted';

CREATE OR REPLACE FUNCTION v2_reject_sales_quote_checkpoint_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'sales quote checkpoints are immutable' USING ERRCODE = '23514';
END $$ LANGUAGE plpgsql;
CREATE TRIGGER v2_sales_quote_checkpoint_immutable
BEFORE UPDATE OR DELETE ON v2_sales_quote_checkpoints
FOR EACH ROW EXECUTE FUNCTION v2_reject_sales_quote_checkpoint_mutation();

CREATE TABLE v2_sales_quote_conversions (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organization_id varchar NOT NULL,
  quote_document_id varchar NOT NULL,
  source_checkpoint_id varchar NOT NULL,
  order_document_id varchar NOT NULL,
  conversion_checkpoint_id varchar NOT NULL,
  operation_request_id varchar,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT v2_sales_quote_conversions_id_organization_uidx UNIQUE (id, organization_id),
  CONSTRAINT v2_sales_quote_conversions_org_quote_uidx UNIQUE (organization_id, quote_document_id),
  CONSTRAINT v2_sales_quote_conversions_org_source_checkpoint_uidx UNIQUE (organization_id, source_checkpoint_id),
  CONSTRAINT v2_sales_quote_conversions_org_order_uidx UNIQUE (organization_id, order_document_id),
  CONSTRAINT v2_sales_quote_conversions_org_conversion_checkpoint_uidx UNIQUE (organization_id, conversion_checkpoint_id),
  CONSTRAINT v2_sales_quote_conversions_org_operation_request_uidx UNIQUE (organization_id, operation_request_id),
  CONSTRAINT v2_sales_quote_conversions_quote_tenant_fk FOREIGN KEY (quote_document_id, organization_id)
    REFERENCES v2_sales_quote_details (document_id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT v2_sales_quote_conversions_order_tenant_fk FOREIGN KEY (order_document_id, organization_id)
    REFERENCES v2_sales_order_details (document_id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT v2_sales_quote_conversions_source_checkpoint_tenant_fk FOREIGN KEY (source_checkpoint_id, organization_id, quote_document_id)
    REFERENCES v2_sales_quote_checkpoints (id, organization_id, quote_document_id) ON DELETE RESTRICT,
  CONSTRAINT v2_sales_quote_conversions_conversion_checkpoint_tenant_fk FOREIGN KEY (conversion_checkpoint_id, organization_id, quote_document_id)
    REFERENCES v2_sales_quote_checkpoints (id, organization_id, quote_document_id) ON DELETE RESTRICT,
  CONSTRAINT v2_sales_quote_conversions_request_tenant_fk FOREIGN KEY (operation_request_id, organization_id)
    REFERENCES v2_operation_requests (id, organization_id) ON DELETE RESTRICT
);

CREATE OR REPLACE FUNCTION v2_validate_sales_quote_conversion() RETURNS trigger AS $$
DECLARE source_kind varchar;
DECLARE conversion_kind varchar;
BEGIN
  SELECT checkpoint_kind INTO source_kind FROM v2_sales_quote_checkpoints
  WHERE id=NEW.source_checkpoint_id AND organization_id=NEW.organization_id AND quote_document_id=NEW.quote_document_id;
  SELECT checkpoint_kind INTO conversion_kind FROM v2_sales_quote_checkpoints
  WHERE id=NEW.conversion_checkpoint_id AND organization_id=NEW.organization_id AND quote_document_id=NEW.quote_document_id;
  IF source_kind NOT IN ('quote_sent', 'quote_accepted') THEN
    RAISE EXCEPTION 'quote conversion requires a sent or accepted quote checkpoint' USING ERRCODE='23514';
  END IF;
  IF conversion_kind <> 'quote_converted' THEN
    RAISE EXCEPTION 'quote conversion requires a quote_converted checkpoint' USING ERRCODE='23514';
  END IF;
  RETURN NULL;
END $$ LANGUAGE plpgsql;
CREATE CONSTRAINT TRIGGER v2_sales_quote_conversion_validate
AFTER INSERT OR UPDATE ON v2_sales_quote_conversions
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION v2_validate_sales_quote_conversion();
