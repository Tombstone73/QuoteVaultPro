-- Close Job Override consumes operational fulfillment obligations without
-- inventing physical shipment, pickup, or delivery evidence.
CREATE TABLE IF NOT EXISTS fulfillment_administrative_reconciliations (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  order_id varchar NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  line_item_id varchar NOT NULL REFERENCES order_line_items(id) ON DELETE CASCADE,
  reconciled_quantity integer NOT NULL CHECK (reconciled_quantity > 0),
  source varchar(80) NOT NULL DEFAULT 'close_job_override',
  reason varchar(80) NOT NULL,
  note text,
  source_invoice_id varchar,
  actor_user_id varchar REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS fulfillment_admin_reconciliation_org_order_idx
  ON fulfillment_administrative_reconciliations (organization_id, order_id, created_at);
CREATE INDEX IF NOT EXISTS fulfillment_admin_reconciliation_org_line_idx
  ON fulfillment_administrative_reconciliations (organization_id, line_item_id);
