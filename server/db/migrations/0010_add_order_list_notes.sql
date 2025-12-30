-- Add order_list_notes table (mirrors quote_list_notes pattern for Orders list UI)
CREATE TABLE IF NOT EXISTS order_list_notes (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id VARCHAR NOT NULL,
  order_id VARCHAR NOT NULL,
  list_label TEXT,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_by_user_id VARCHAR,
  
  CONSTRAINT order_list_notes_org_fk FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  CONSTRAINT order_list_notes_order_fk FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
  CONSTRAINT order_list_notes_user_fk FOREIGN KEY (updated_by_user_id) REFERENCES users(id) ON DELETE SET NULL
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS order_list_notes_org_idx ON order_list_notes(organization_id);
CREATE INDEX IF NOT EXISTS order_list_notes_order_idx ON order_list_notes(order_id);

-- Unique constraint: one note per order per org
CREATE UNIQUE INDEX IF NOT EXISTS order_list_notes_unique ON order_list_notes(organization_id, order_id);
