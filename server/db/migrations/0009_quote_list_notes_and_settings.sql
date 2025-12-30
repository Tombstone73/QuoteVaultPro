-- Migration: Add quote list notes table (separate from quote record locking)
-- Also add list settings table for column customization

-- Quote List Notes (list-only annotations, always editable)
CREATE TABLE IF NOT EXISTS quote_list_notes (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id VARCHAR NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  quote_id VARCHAR NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  list_label TEXT,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
  updated_by_user_id VARCHAR REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT quote_list_notes_unique UNIQUE (organization_id, quote_id)
);

CREATE INDEX quote_list_notes_org_idx ON quote_list_notes(organization_id);
CREATE INDEX quote_list_notes_quote_idx ON quote_list_notes(quote_id);

-- List Settings (column visibility, order, labels, date format)
CREATE TABLE IF NOT EXISTS list_settings (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id VARCHAR NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id VARCHAR REFERENCES users(id) ON DELETE CASCADE,
  list_key VARCHAR NOT NULL, -- e.g. 'internalQuotesList'
  settings_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
  CONSTRAINT list_settings_unique UNIQUE (organization_id, user_id, list_key)
);

CREATE INDEX list_settings_org_user_idx ON list_settings(organization_id, user_id);
CREATE INDEX list_settings_list_key_idx ON list_settings(list_key);

-- Grant permissions
GRANT ALL ON quote_list_notes TO neondb_owner;
GRANT ALL ON list_settings TO neondb_owner;
