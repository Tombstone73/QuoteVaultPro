CREATE TABLE IF NOT EXISTS order_internal_notes (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  order_id varchar NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  note_text text NOT NULL,
  audience_tags jsonb,
  created_by_user_id varchar REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS order_line_item_notes (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  order_id varchar NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  line_item_id varchar NOT NULL REFERENCES order_line_items(id) ON DELETE CASCADE,
  category varchar(50) NOT NULL,
  note_text text NOT NULL,
  created_by_user_id varchar REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS order_internal_notes_order_created_idx
  ON order_internal_notes(order_id, created_at);

CREATE INDEX IF NOT EXISTS order_internal_notes_org_order_idx
  ON order_internal_notes(organization_id, order_id);

CREATE INDEX IF NOT EXISTS order_line_item_notes_order_created_idx
  ON order_line_item_notes(order_id, created_at);

CREATE INDEX IF NOT EXISTS order_line_item_notes_line_category_created_idx
  ON order_line_item_notes(line_item_id, category, created_at);

CREATE INDEX IF NOT EXISTS order_line_item_notes_org_line_idx
  ON order_line_item_notes(organization_id, line_item_id);