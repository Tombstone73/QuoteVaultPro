-- QuickBooks PaymentRefNum is an operator-facing accounting reference, not a
-- V2 payment identity. Keep its monotonically allocated PMT sequence in
-- tenant-scoped integration metadata so recovery/replay never invents a new
-- provider reference and V2 Billing facts remain immutable.
CREATE TABLE v2_quickbooks_payment_reference_counters (
  organization_id varchar PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  next_sequence bigint NOT NULL DEFAULT 1,
  CONSTRAINT v2_quickbooks_payment_reference_counter_range_chk
    CHECK (next_sequence BETWEEN 1 AND 100000000000000000)
);

CREATE TABLE v2_quickbooks_payment_references (
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  payment_id varchar NOT NULL,
  sequence_number bigint NOT NULL,
  payment_ref_num varchar(21) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT v2_quickbooks_payment_reference_payment_pk
    PRIMARY KEY (organization_id, payment_id),
  CONSTRAINT v2_quickbooks_payment_reference_payment_tenant_fk
    FOREIGN KEY (payment_id, organization_id)
    REFERENCES v2_billing_payments(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT v2_quickbooks_payment_reference_sequence_uidx
    UNIQUE (organization_id, sequence_number),
  CONSTRAINT v2_quickbooks_payment_reference_ref_uidx
    UNIQUE (organization_id, payment_ref_num),
  CONSTRAINT v2_quickbooks_payment_reference_sequence_range_chk
    CHECK (sequence_number BETWEEN 1 AND 99999999999999999),
  CONSTRAINT v2_quickbooks_payment_reference_format_chk
    CHECK (payment_ref_num = 'PMT-' || sequence_number::text)
);
