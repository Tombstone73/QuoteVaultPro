CREATE TABLE IF NOT EXISTS portal_follow_up_items (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  idempotency_key varchar(255) NOT NULL,
  event_type varchar(80) NOT NULL,
  status varchar(30) NOT NULL DEFAULT 'new',
  customer_id varchar REFERENCES customers(id) ON DELETE SET NULL,
  customer_name text,
  entity_type varchar(40) NOT NULL,
  entity_id varchar NOT NULL,
  related_order_id varchar REFERENCES orders(id) ON DELETE SET NULL,
  related_quote_id varchar REFERENCES quotes(id) ON DELETE SET NULL,
  related_proof_id varchar REFERENCES line_item_proof_versions(id) ON DELETE SET NULL,
  title text NOT NULL,
  description text,
  follow_up_area varchar(80),
  action_url text,
  source varchar(80) NOT NULL DEFAULT 'customer_portal',
  source_audit_log_id varchar REFERENCES audit_logs(id) ON DELETE SET NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  acknowledged_at timestamptz,
  resolved_at timestamptz,
  updated_by_user_id varchar REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT portal_follow_up_items_status_ck
    CHECK (status IN ('new', 'pending', 'completed')),
  CONSTRAINT portal_follow_up_items_event_type_ck
    CHECK (event_type IN (
      'QUOTE_APPROVED',
      'QUOTE_DECLINED',
      'QUOTE_REVISION_REQUESTED',
      'PROOF_APPROVED',
      'PROOF_REJECTED',
      'PROOF_REVISION_REQUESTED',
      'INVOICE_PAYMENT_SUCCEEDED'
    ))
);

CREATE UNIQUE INDEX IF NOT EXISTS portal_follow_up_items_org_idempotency_uidx
  ON portal_follow_up_items (organization_id, idempotency_key);

CREATE INDEX IF NOT EXISTS portal_follow_up_items_org_status_created_idx
  ON portal_follow_up_items (organization_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS portal_follow_up_items_org_event_created_idx
  ON portal_follow_up_items (organization_id, event_type, created_at DESC);

CREATE INDEX IF NOT EXISTS portal_follow_up_items_customer_idx
  ON portal_follow_up_items (customer_id);

CREATE INDEX IF NOT EXISTS portal_follow_up_items_entity_idx
  ON portal_follow_up_items (organization_id, entity_type, entity_id);
