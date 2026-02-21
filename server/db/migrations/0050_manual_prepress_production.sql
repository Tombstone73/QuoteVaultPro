-- Manual Prepress Production Workflow
-- Supports multiple ORIGINAL and FINAL files per line item
-- Clean state transitions with session-based locking

-- Step 1: Create enums
DO $$ BEGIN
  CREATE TYPE prepress_session_status AS ENUM ('active', 'complete');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE line_item_file_role AS ENUM ('original', 'final', 'reference');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE line_item_file_status AS ENUM ('active', 'superseded');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Step 2: Update order_line_items status column to support prepress states
-- We're using varchar, so no enum needed - just document valid values
COMMENT ON COLUMN order_line_items.status IS 'Valid values: queued, pending_prepress, in_prepress, prepress_complete, print_ready, printing, finishing, done, canceled';

-- Step 3: Create prepress_sessions table
CREATE TABLE IF NOT EXISTS prepress_sessions (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  order_id varchar NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  line_item_id varchar NOT NULL REFERENCES order_line_items(id) ON DELETE CASCADE,
  status prepress_session_status NOT NULL DEFAULT 'active',
  
  -- Session ownership and locking
  started_by_user_id varchar NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  lock_owner_user_id varchar NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  
  -- Session notes and issue tracking
  notes_text text,
  issue_flag boolean NOT NULL DEFAULT false,
  issue_type text,
  
  -- Completion tracking
  completed_by_user_id varchar REFERENCES users(id) ON DELETE SET NULL,
  
  -- Timestamps
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Indexes for prepress_sessions
CREATE INDEX IF NOT EXISTS prepress_sessions_org_idx ON prepress_sessions(organization_id);
CREATE INDEX IF NOT EXISTS prepress_sessions_order_idx ON prepress_sessions(order_id);
CREATE INDEX IF NOT EXISTS prepress_sessions_line_item_idx ON prepress_sessions(line_item_id);
CREATE INDEX IF NOT EXISTS prepress_sessions_status_idx ON prepress_sessions(status);
CREATE INDEX IF NOT EXISTS prepress_sessions_lock_owner_idx ON prepress_sessions(lock_owner_user_id);

-- Auto-update updated_at trigger for prepress_sessions
CREATE OR REPLACE FUNCTION prepress_sessions_set_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS prepress_sessions_set_updated_at_trg ON prepress_sessions;
CREATE TRIGGER prepress_sessions_set_updated_at_trg
BEFORE UPDATE ON prepress_sessions
FOR EACH ROW
EXECUTE FUNCTION prepress_sessions_set_updated_at();

-- Step 4: Create line_item_files table
CREATE TABLE IF NOT EXISTS line_item_files (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  order_id varchar NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  line_item_id varchar NOT NULL REFERENCES order_line_items(id) ON DELETE CASCADE,
  prepress_session_id varchar REFERENCES prepress_sessions(id) ON DELETE SET NULL,
  
  -- File metadata
  role line_item_file_role NOT NULL,
  status line_item_file_status NOT NULL DEFAULT 'active',
  tag text,
  
  -- Storage information
  storage_bucket varchar(255),
  storage_path text NOT NULL,
  storage_key text,
  original_filename varchar(512) NOT NULL,
  mime_type varchar(255) NOT NULL,
  size_bytes integer NOT NULL,
  
  -- Versioning
  supersedes_file_id varchar REFERENCES line_item_files(id) ON DELETE SET NULL,
  
  -- Audit
  created_by_user_id varchar NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Indexes for line_item_files
CREATE INDEX IF NOT EXISTS line_item_files_org_idx ON line_item_files(organization_id);
CREATE INDEX IF NOT EXISTS line_item_files_order_idx ON line_item_files(order_id);
CREATE INDEX IF NOT EXISTS line_item_files_line_item_idx ON line_item_files(line_item_id);
CREATE INDEX IF NOT EXISTS line_item_files_session_idx ON line_item_files(prepress_session_id);
CREATE INDEX IF NOT EXISTS line_item_files_role_status_idx ON line_item_files(role, status);
CREATE INDEX IF NOT EXISTS line_item_files_supersedes_idx ON line_item_files(supersedes_file_id);

-- Step 5: Grant permissions (if using RLS)
-- Note: Adjust based on your security model
-- GRANT SELECT, INSERT, UPDATE, DELETE ON prepress_sessions TO authenticated;
-- GRANT SELECT, INSERT, UPDATE, DELETE ON line_item_files TO authenticated;
