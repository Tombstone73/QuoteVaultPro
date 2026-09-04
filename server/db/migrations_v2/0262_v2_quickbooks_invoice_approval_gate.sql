-- QuickBooks is an external accounting projection.  An explicit accounting
-- approval is integration metadata, not a mutation of V2 Billing truth.  The
-- approved synchronization version makes a commercial revision require a new
-- approval while preserving the prior approval audit trail.
CREATE TABLE v2_quickbooks_invoice_approvals (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  invoice_id varchar NOT NULL,
  synchronization_version bigint NOT NULL,
  approved_at timestamptz NOT NULL DEFAULT now(),
  principal_kind varchar(32) NOT NULL,
  principal_subject varchar(160) NOT NULL,
  staff_actor_user_id varchar REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT v2_quickbooks_invoice_approval_invoice_tenant_fk
    FOREIGN KEY (invoice_id, organization_id)
    REFERENCES v2_billing_invoices(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT v2_quickbooks_invoice_approval_version_uidx
    UNIQUE (organization_id, invoice_id, synchronization_version)
);

CREATE INDEX v2_quickbooks_invoice_approval_lookup_idx
  ON v2_quickbooks_invoice_approvals(organization_id, invoice_id, synchronization_version);
