-- Quote Attachments table for file uploads on quotes (before order conversion)
CREATE TABLE IF NOT EXISTS quote_attachments (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id VARCHAR NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  organization_id VARCHAR NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  uploaded_by_user_id VARCHAR REFERENCES users(id) ON DELETE SET NULL,
  uploaded_by_name VARCHAR(255),
  file_name VARCHAR(500) NOT NULL,
  file_url TEXT NOT NULL,
  file_size INTEGER,
  mime_type VARCHAR(100),
  description TEXT,
  created_at TIMESTAMP DEFAULT NOW() NOT NULL
);

-- Indexes for quote_attachments
CREATE INDEX IF NOT EXISTS quote_attachments_quote_id_idx ON quote_attachments(quote_id);
CREATE INDEX IF NOT EXISTS quote_attachments_organization_id_idx ON quote_attachments(organization_id);
