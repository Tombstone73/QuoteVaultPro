CREATE TABLE IF NOT EXISTS line_item_design_briefs (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  order_id varchar NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  order_line_item_id varchar NOT NULL REFERENCES order_line_items(id) ON DELETE CASCADE,
  key_instructions text,
  design_objective text,
  requested_content text,
  layout_notes text,
  brand_style_notes text,
  reference_notes text,
  priority_notes text,
  created_by_user_id varchar REFERENCES users(id) ON DELETE SET NULL,
  updated_by_user_id varchar REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamp DEFAULT now() NOT NULL,
  updated_at timestamp DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS line_item_design_briefs_line_item_id_unique
  ON line_item_design_briefs(order_line_item_id);

CREATE INDEX IF NOT EXISTS line_item_design_briefs_org_id_idx
  ON line_item_design_briefs(organization_id);

CREATE INDEX IF NOT EXISTS line_item_design_briefs_order_id_idx
  ON line_item_design_briefs(order_id);