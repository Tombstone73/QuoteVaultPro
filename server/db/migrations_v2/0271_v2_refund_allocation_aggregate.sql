-- M7.5L: a Refund is one immutable reversal aggregate.  Its economic effect
-- is carried by allocation evidence, not by refunds.invoice_id (which remains
-- an old-reader compatibility anchor for a multi-invoice aggregate).
ALTER TABLE v2_billing_refund_allocations
  DROP CONSTRAINT IF EXISTS v2_billing_refund_allocations_refund_uidx;

CREATE TABLE v2_billing_refund_allocation_evidence (
  refund_allocation_id varchar PRIMARY KEY,
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  refund_id varchar NOT NULL,
  payment_id varchar NOT NULL,
  payment_allocation_id varchar NOT NULL,
  invoice_id varchar NOT NULL,
  amount_cents bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT v2_billing_refund_allocation_evidence_refund_allocation_fk
    FOREIGN KEY (refund_allocation_id, organization_id)
    REFERENCES v2_billing_refund_allocations(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT v2_billing_refund_allocation_evidence_refund_fk
    FOREIGN KEY (refund_id, organization_id)
    REFERENCES v2_billing_refunds(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT v2_billing_refund_allocation_evidence_payment_fk
    FOREIGN KEY (payment_id, organization_id)
    REFERENCES v2_billing_payments(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT v2_billing_refund_allocation_evidence_payment_allocation_fk
    FOREIGN KEY (payment_allocation_id, organization_id)
    REFERENCES v2_billing_payment_allocations(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT v2_billing_refund_allocation_evidence_invoice_fk
    FOREIGN KEY (invoice_id, organization_id)
    REFERENCES v2_billing_invoices(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT v2_billing_refund_allocation_evidence_refund_payment_allocation_uidx
    UNIQUE (refund_id, payment_allocation_id),
  CONSTRAINT v2_billing_refund_allocation_evidence_amount_chk CHECK (amount_cents > 0),
  CONSTRAINT v2_billing_refund_allocation_evidence_id_org_uidx UNIQUE (refund_allocation_id, organization_id)
);

-- Historical one-invoice refund facts are preserved byte-for-byte.  The
-- mapping is inserted only when the original payment has exactly one matching
-- allocation; no mutable history is updated and ambiguity fails closed below.
INSERT INTO v2_billing_refund_allocation_evidence(
  refund_allocation_id, organization_id, refund_id, payment_id,
  payment_allocation_id, invoice_id, amount_cents
)
SELECT a.id,a.organization_id,a.refund_id,a.payment_id,p.id,r.invoice_id,a.amount_cents
FROM v2_billing_refund_allocations a
JOIN v2_billing_refunds r ON r.organization_id=a.organization_id AND r.id=a.refund_id
JOIN v2_billing_payment_allocations p
  ON p.organization_id=a.organization_id AND p.payment_id=a.payment_id AND p.invoice_id=r.invoice_id
ON CONFLICT (refund_allocation_id) DO NOTHING;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM v2_billing_refund_allocations a
    LEFT JOIN v2_billing_refund_allocation_evidence e
      ON e.organization_id=a.organization_id AND e.refund_allocation_id=a.id
    WHERE e.refund_allocation_id IS NULL
  ) OR EXISTS (
    SELECT 1
    FROM v2_billing_refund_allocation_evidence e
    JOIN v2_billing_refund_allocations a
      ON a.organization_id=e.organization_id AND a.id=e.refund_allocation_id
    JOIN v2_billing_refunds r ON r.organization_id=e.organization_id AND r.id=e.refund_id
    JOIN v2_billing_payment_allocations p ON p.organization_id=e.organization_id AND p.id=e.payment_allocation_id
    WHERE e.refund_id<>a.refund_id OR e.payment_id<>a.payment_id OR e.invoice_id<>r.invoice_id
      OR p.payment_id<>e.payment_id OR p.invoice_id<>e.invoice_id
  ) THEN
    RAISE EXCEPTION 'Refund allocation evidence backfill found an ambiguous historic Refund; reconcile it before enabling allocation-aware refunds.';
  END IF;
END $$;

CREATE INDEX v2_billing_refund_allocation_evidence_invoice_history_idx
  ON v2_billing_refund_allocation_evidence(organization_id, invoice_id, created_at DESC);
CREATE INDEX v2_billing_refund_allocation_evidence_payment_allocation_idx
  ON v2_billing_refund_allocation_evidence(organization_id, payment_allocation_id);

CREATE TRIGGER v2_billing_refund_allocation_evidence_immutable_trigger
  BEFORE UPDATE OR DELETE ON v2_billing_refund_allocation_evidence
  FOR EACH ROW EXECUTE FUNCTION v2_billing_financial_history_immutable_validate();

COMMENT ON TABLE v2_billing_refund_allocation_evidence IS
  'Immutable allocation-to-invoice evidence for single and multi-invoice V2 Refund aggregates.';
COMMENT ON COLUMN v2_billing_refunds.invoice_id IS
  'Compatibility anchor only. Canonical Refund invoice effects are v2_billing_refund_allocation_evidence.';
