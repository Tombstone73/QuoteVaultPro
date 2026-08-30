-- M6: a V2 Refund is represented in QuickBooks as a customer A/R credit plus
-- a customer refund disbursement.  This table is provider-workflow metadata,
-- not Billing truth; the immutable V2 Refund remains the source of truth.

ALTER TABLE v2_quickbooks_sync_links
  DROP CONSTRAINT v2_quickbooks_sync_links_kind_chk;
ALTER TABLE v2_quickbooks_sync_links
  ADD CONSTRAINT v2_quickbooks_sync_links_kind_chk
  CHECK (entity_kind IN ('customer','invoice','payment','refund_credit_memo','refund_disbursement'));

ALTER TABLE v2_quickbooks_sync_jobs
  DROP CONSTRAINT v2_quickbooks_sync_jobs_kind_chk;
ALTER TABLE v2_quickbooks_sync_jobs
  ADD CONSTRAINT v2_quickbooks_sync_jobs_kind_chk
  CHECK (subject_kind IN ('invoice','payment','refund'));

CREATE TABLE v2_quickbooks_refund_sync_workflows (
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  refund_id varchar NOT NULL,
  state varchar(32) NOT NULL DEFAULT 'queued',
  last_error varchar(500),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CONSTRAINT v2_quickbooks_refund_sync_workflows_pk PRIMARY KEY (organization_id, refund_id),
  CONSTRAINT v2_quickbooks_refund_sync_workflows_state_chk
    CHECK (state IN ('queued','credit_created','disbursement_created','linked','succeeded','uncertain','retry','blocked')),
  CONSTRAINT v2_quickbooks_refund_sync_workflows_refund_fk
    FOREIGN KEY (refund_id, organization_id) REFERENCES v2_billing_refunds(id, organization_id) ON DELETE RESTRICT
);
