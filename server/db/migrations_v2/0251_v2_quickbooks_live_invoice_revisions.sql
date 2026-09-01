-- V2 live Order-backed invoices remain operationally mutable.  QuickBooks
-- linkage records the last external accounting projection, not Billing truth.
-- This lets the worker update the same QuickBooks Invoice when canonical V2
-- accounting facts change, while retaining an auditable export fingerprint.

ALTER TABLE v2_quickbooks_sync_links
  ADD COLUMN projection_fingerprint varchar(80),
  ADD COLUMN projection_version varchar(80),
  ADD COLUMN projection_json jsonb,
  ADD COLUMN projection_synced_at timestamptz;

ALTER TABLE v2_quickbooks_sync_links
  ADD CONSTRAINT v2_quickbooks_sync_links_projection_json_object_chk
  CHECK (projection_json IS NULL OR jsonb_typeof(projection_json) = 'object');

CREATE INDEX v2_quickbooks_sync_links_invoice_revision_idx
  ON v2_quickbooks_sync_links (organization_id, entity_id, projection_version)
  WHERE entity_kind = 'invoice';
