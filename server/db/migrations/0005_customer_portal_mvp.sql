-- Migration: Customer Portal MVP
-- Adds order_audit_log, order_attachments, quote_workflow_states tables

CREATE TABLE IF NOT EXISTS order_audit_log (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id VARCHAR NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  user_id VARCHAR REFERENCES users(id) ON DELETE SET NULL,
  user_name VARCHAR(255),
  action_type VARCHAR(100) NOT NULL,
  from_status VARCHAR(50),
  to_status VARCHAR(50),
  note TEXT,
  metadata JSONB,
  created_at TIMESTAMP DEFAULT NOW() NOT NULL
);
CREATE INDEX IF NOT EXISTS order_audit_log_order_id_idx ON order_audit_log(order_id);
CREATE INDEX IF NOT EXISTS order_audit_log_created_at_idx ON order_audit_log(created_at);

CREATE TABLE IF NOT EXISTS order_attachments (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id VARCHAR NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  quote_id VARCHAR REFERENCES quotes(id) ON DELETE SET NULL,
  uploaded_by_user_id VARCHAR REFERENCES users(id) ON DELETE SET NULL,
  uploaded_by_name VARCHAR(255),
  file_name VARCHAR(500) NOT NULL,
  file_url TEXT NOT NULL,
  file_size INTEGER,
  mime_type VARCHAR(100),
  description TEXT,
  created_at TIMESTAMP DEFAULT NOW() NOT NULL
);
CREATE INDEX IF NOT EXISTS order_attachments_order_id_idx ON order_attachments(order_id);
CREATE INDEX IF NOT EXISTS order_attachments_quote_id_idx ON order_attachments(quote_id);

CREATE TABLE IF NOT EXISTS quote_workflow_states (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id VARCHAR NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  status VARCHAR(50) NOT NULL DEFAULT 'draft',
  approved_by_customer_user_id VARCHAR REFERENCES users(id) ON DELETE SET NULL,
  approved_by_staff_user_id VARCHAR REFERENCES users(id) ON DELETE SET NULL,
  rejected_by_user_id VARCHAR REFERENCES users(id) ON DELETE SET NULL,
  rejection_reason TEXT,
  customer_notes TEXT,
  staff_notes TEXT,
  created_at TIMESTAMP DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMP DEFAULT NOW() NOT NULL
);
CREATE INDEX IF NOT EXISTS quote_workflow_states_quote_id_idx ON quote_workflow_states(quote_id);
CREATE INDEX IF NOT EXISTS quote_workflow_states_status_idx ON quote_workflow_states(status);
