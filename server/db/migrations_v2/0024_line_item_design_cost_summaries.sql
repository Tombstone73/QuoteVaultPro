CREATE TABLE IF NOT EXISTS line_item_design_cost_summaries (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  order_id varchar NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  line_item_id varchar NOT NULL REFERENCES order_line_items(id) ON DELETE CASCADE,
  design_cost_state varchar(50) NOT NULL DEFAULT 'not_applicable',
  actual_tracked_minutes decimal(10, 2) NOT NULL DEFAULT 0.00,
  corrected_tracked_minutes decimal(10, 2) NOT NULL DEFAULT 0.00,
  internal_design_cost_calculated decimal(10, 2),
  quoted_design_amount decimal(10, 2),
  sold_design_amount decimal(10, 2),
  billable_design_minutes decimal(10, 2),
  billable_design_amount decimal(10, 2),
  billing_status varchar(50) NOT NULL DEFAULT 'not_billable',
  last_synced_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS line_item_design_cost_summaries_line_item_id_unique
  ON line_item_design_cost_summaries(line_item_id);

CREATE INDEX IF NOT EXISTS line_item_design_cost_summaries_org_id_idx
  ON line_item_design_cost_summaries(organization_id);

CREATE INDEX IF NOT EXISTS line_item_design_cost_summaries_order_id_idx
  ON line_item_design_cost_summaries(order_id);

CREATE INDEX IF NOT EXISTS line_item_design_cost_summaries_billing_status_idx
  ON line_item_design_cost_summaries(billing_status);