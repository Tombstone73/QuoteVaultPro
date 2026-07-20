-- One customer proof package may cover multiple order line items.
-- Existing proof versions are backfilled as one-member packages.

CREATE TABLE IF NOT EXISTS proof_version_line_items (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id VARCHAR NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  order_id VARCHAR NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  proof_version_id VARCHAR NOT NULL REFERENCES line_item_proof_versions(id) ON DELETE CASCADE,
  line_item_id VARCHAR NOT NULL REFERENCES order_line_items(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  line_item_label_snapshot TEXT,
  display_size_snapshot TEXT,
  quantity_snapshot NUMERIC(12, 3),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS proof_version_line_items_version_line_uidx
  ON proof_version_line_items(proof_version_id, line_item_id);
CREATE INDEX IF NOT EXISTS proof_version_line_items_org_idx
  ON proof_version_line_items(organization_id);
CREATE INDEX IF NOT EXISTS proof_version_line_items_order_idx
  ON proof_version_line_items(order_id);
CREATE INDEX IF NOT EXISTS proof_version_line_items_line_item_idx
  ON proof_version_line_items(line_item_id);
CREATE INDEX IF NOT EXISTS proof_version_line_items_version_idx
  ON proof_version_line_items(proof_version_id);

INSERT INTO proof_version_line_items (
  organization_id,
  order_id,
  proof_version_id,
  line_item_id,
  sort_order,
  quantity_snapshot
)
SELECT
  version.organization_id,
  version.order_id,
  version.id,
  version.line_item_id,
  0,
  line_item.quantity
FROM line_item_proof_versions version
JOIN order_line_items line_item ON line_item.id = version.line_item_id
ON CONFLICT (proof_version_id, line_item_id) DO NOTHING;
