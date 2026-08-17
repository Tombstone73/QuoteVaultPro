-- M3 Slice 5: Billing owns immutable confirmed monetary facts. Provider attempts
-- remain separate recovery records so an ambiguous response never becomes a charge.
CREATE TABLE v2_billing_provider_financial_operations (
  id varchar PRIMARY KEY,
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  invoice_id varchar NOT NULL,
  payment_id varchar,
  operation_kind varchar(16) NOT NULL,
  provider varchar(80) NOT NULL,
  provider_idempotency_key varchar(200) NOT NULL,
  provider_transaction_id varchar(200),
  amount_cents bigint NOT NULL,
  currency varchar(3) NOT NULL,
  reconciliation_state varchar(24) NOT NULL DEFAULT 'pending',
  operation_request_id varchar,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT v2_billing_provider_ops_invoice_fk FOREIGN KEY (invoice_id, organization_id) REFERENCES v2_billing_invoices(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT v2_billing_provider_ops_kind_chk CHECK (operation_kind IN ('payment','refund')),
  CONSTRAINT v2_billing_provider_ops_state_chk CHECK (reconciliation_state IN ('pending','succeeded','failed','uncertain')),
  CONSTRAINT v2_billing_provider_ops_amount_chk CHECK (amount_cents > 0),
  CONSTRAINT v2_billing_provider_ops_currency_chk CHECK (currency ~ '^[A-Z]{3}$'),
  CONSTRAINT v2_billing_provider_ops_provider_chk CHECK (length(btrim(provider)) > 0 AND length(btrim(provider_idempotency_key)) > 0),
  CONSTRAINT v2_billing_provider_ops_request_fk FOREIGN KEY (operation_request_id, organization_id) REFERENCES v2_operation_requests(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT v2_billing_provider_ops_id_org_uidx UNIQUE (id, organization_id),
  CONSTRAINT v2_billing_provider_ops_provider_key_uidx UNIQUE (organization_id, provider, provider_idempotency_key)
);
CREATE UNIQUE INDEX v2_billing_provider_ops_external_tx_uidx ON v2_billing_provider_financial_operations(organization_id, provider, provider_transaction_id) WHERE provider_transaction_id IS NOT NULL;

CREATE TABLE v2_billing_payments (
  id varchar PRIMARY KEY,
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  invoice_id varchar NOT NULL,
  source varchar(16) NOT NULL,
  method varchar(40) NOT NULL,
  amount_cents bigint NOT NULL,
  currency varchar(3) NOT NULL,
  provider_operation_id varchar,
  provider_transaction_id varchar(200),
  occurred_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  principal_kind varchar(32) NOT NULL,
  principal_subject varchar(160) NOT NULL,
  staff_actor_user_id varchar REFERENCES users(id) ON DELETE SET NULL,
  operation_request_id varchar NOT NULL,
  CONSTRAINT v2_billing_payments_invoice_fk FOREIGN KEY (invoice_id, organization_id) REFERENCES v2_billing_invoices(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT v2_billing_payments_provider_operation_fk FOREIGN KEY (provider_operation_id, organization_id) REFERENCES v2_billing_provider_financial_operations(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT v2_billing_payments_request_fk FOREIGN KEY (operation_request_id, organization_id) REFERENCES v2_operation_requests(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT v2_billing_payments_source_chk CHECK (source IN ('manual','provider')),
  CONSTRAINT v2_billing_payments_amount_chk CHECK (amount_cents > 0),
  CONSTRAINT v2_billing_payments_currency_chk CHECK (currency ~ '^[A-Z]{3}$'),
  CONSTRAINT v2_billing_payments_actor_chk CHECK (principal_kind IN ('staff','delegated_ai','portal','service') AND length(btrim(principal_subject)) > 0),
  CONSTRAINT v2_billing_payments_id_org_uidx UNIQUE (id, organization_id),
  CONSTRAINT v2_billing_payments_provider_operation_uidx UNIQUE (provider_operation_id)
);
CREATE TABLE v2_billing_payment_allocations (
  id varchar PRIMARY KEY,
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  payment_id varchar NOT NULL,
  invoice_id varchar NOT NULL,
  amount_cents bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT v2_billing_payment_allocations_payment_fk FOREIGN KEY (payment_id, organization_id) REFERENCES v2_billing_payments(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT v2_billing_payment_allocations_invoice_fk FOREIGN KEY (invoice_id, organization_id) REFERENCES v2_billing_invoices(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT v2_billing_payment_allocations_amount_chk CHECK (amount_cents > 0),
  CONSTRAINT v2_billing_payment_allocations_payment_uidx UNIQUE (payment_id),
  CONSTRAINT v2_billing_payment_allocations_id_org_uidx UNIQUE (id, organization_id)
);
CREATE TABLE v2_billing_refunds (
  id varchar PRIMARY KEY,
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  invoice_id varchar NOT NULL,
  source varchar(16) NOT NULL,
  amount_cents bigint NOT NULL,
  currency varchar(3) NOT NULL,
  provider_operation_id varchar,
  provider_transaction_id varchar(200),
  occurred_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  principal_kind varchar(32) NOT NULL,
  principal_subject varchar(160) NOT NULL,
  staff_actor_user_id varchar REFERENCES users(id) ON DELETE SET NULL,
  operation_request_id varchar NOT NULL,
  CONSTRAINT v2_billing_refunds_invoice_fk FOREIGN KEY (invoice_id, organization_id) REFERENCES v2_billing_invoices(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT v2_billing_refunds_provider_operation_fk FOREIGN KEY (provider_operation_id, organization_id) REFERENCES v2_billing_provider_financial_operations(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT v2_billing_refunds_request_fk FOREIGN KEY (operation_request_id, organization_id) REFERENCES v2_operation_requests(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT v2_billing_refunds_source_chk CHECK (source IN ('manual','provider')),
  CONSTRAINT v2_billing_refunds_amount_chk CHECK (amount_cents > 0),
  CONSTRAINT v2_billing_refunds_currency_chk CHECK (currency ~ '^[A-Z]{3}$'),
  CONSTRAINT v2_billing_refunds_actor_chk CHECK (principal_kind IN ('staff','delegated_ai','portal','service') AND length(btrim(principal_subject)) > 0),
  CONSTRAINT v2_billing_refunds_id_org_uidx UNIQUE (id, organization_id),
  CONSTRAINT v2_billing_refunds_provider_operation_uidx UNIQUE (provider_operation_id)
);
CREATE TABLE v2_billing_refund_allocations (
  id varchar PRIMARY KEY,
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  refund_id varchar NOT NULL,
  payment_id varchar NOT NULL,
  amount_cents bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT v2_billing_refund_allocations_refund_fk FOREIGN KEY (refund_id, organization_id) REFERENCES v2_billing_refunds(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT v2_billing_refund_allocations_payment_fk FOREIGN KEY (payment_id, organization_id) REFERENCES v2_billing_payments(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT v2_billing_refund_allocations_amount_chk CHECK (amount_cents > 0),
  CONSTRAINT v2_billing_refund_allocations_refund_uidx UNIQUE (refund_id),
  CONSTRAINT v2_billing_refund_allocations_id_org_uidx UNIQUE (id, organization_id)
);
CREATE TABLE v2_billing_provider_events (
  id varchar PRIMARY KEY,
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  provider varchar(80) NOT NULL,
  provider_event_id varchar(200) NOT NULL,
  provider_operation_id varchar NOT NULL,
  event_kind varchar(32) NOT NULL,
  occurred_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT v2_billing_provider_events_operation_fk FOREIGN KEY (provider_operation_id, organization_id) REFERENCES v2_billing_provider_financial_operations(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT v2_billing_provider_events_unique UNIQUE (organization_id, provider, provider_event_id),
  CONSTRAINT v2_billing_provider_events_id_org_uidx UNIQUE (id, organization_id)
);
CREATE INDEX v2_billing_payments_invoice_idx ON v2_billing_payments(organization_id,invoice_id,recorded_at);
CREATE INDEX v2_billing_refunds_invoice_idx ON v2_billing_refunds(organization_id,invoice_id,recorded_at);
CREATE INDEX v2_billing_provider_ops_reconcile_idx ON v2_billing_provider_financial_operations(organization_id,reconciliation_state,updated_at);

CREATE OR REPLACE FUNCTION v2_billing_financial_history_immutable_validate() RETURNS trigger AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'Billing financial history is immutable.'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER v2_billing_payments_immutable_trigger BEFORE UPDATE OR DELETE ON v2_billing_payments FOR EACH ROW EXECUTE FUNCTION v2_billing_financial_history_immutable_validate();
CREATE TRIGGER v2_billing_payment_allocations_immutable_trigger BEFORE UPDATE OR DELETE ON v2_billing_payment_allocations FOR EACH ROW EXECUTE FUNCTION v2_billing_financial_history_immutable_validate();
CREATE TRIGGER v2_billing_refunds_immutable_trigger BEFORE UPDATE OR DELETE ON v2_billing_refunds FOR EACH ROW EXECUTE FUNCTION v2_billing_financial_history_immutable_validate();
CREATE TRIGGER v2_billing_refund_allocations_immutable_trigger BEFORE UPDATE OR DELETE ON v2_billing_refund_allocations FOR EACH ROW EXECUTE FUNCTION v2_billing_financial_history_immutable_validate();
CREATE TRIGGER v2_billing_provider_events_immutable_trigger BEFORE UPDATE OR DELETE ON v2_billing_provider_events FOR EACH ROW EXECUTE FUNCTION v2_billing_financial_history_immutable_validate();
