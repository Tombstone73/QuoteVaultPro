CREATE TABLE IF NOT EXISTS fulfillment_checklist_items (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  order_id varchar NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  line_item_id varchar NOT NULL REFERENCES order_line_items(id) ON DELETE CASCADE,
  checked boolean NOT NULL DEFAULT false,
  checked_by_user_id varchar REFERENCES users(id) ON DELETE SET NULL,
  checked_at timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fulfillment_checklist_items_org_order_line_uidx UNIQUE (organization_id, order_id, line_item_id)
);

CREATE INDEX IF NOT EXISTS fulfillment_checklist_items_org_order_idx
  ON fulfillment_checklist_items (organization_id, order_id);

CREATE INDEX IF NOT EXISTS fulfillment_checklist_items_org_line_idx
  ON fulfillment_checklist_items (organization_id, line_item_id);

CREATE INDEX IF NOT EXISTS fulfillment_checklist_items_org_checked_idx
  ON fulfillment_checklist_items (organization_id, checked);
