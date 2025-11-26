-- Migration 0011: Artwork & File Handling System
-- Extends order_attachments table with artwork metadata (role, side, isPrimary, thumbnailUrl, orderLineItemId)
-- Adds job_files table for production file management

-- Create file role enum
DO $$ BEGIN
  CREATE TYPE file_role AS ENUM (
    'artwork',
    'proof',
    'reference',
    'customer_po',
    'setup',
    'output',
    'other'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Create file side enum
DO $$ BEGIN
  CREATE TYPE file_side AS ENUM ('front', 'back', 'na');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Extend order_attachments table with artwork metadata
-- Adding columns to existing table to preserve data
DO $$ BEGIN
  -- Add orderLineItemId for per-line-item attachments
  ALTER TABLE order_attachments ADD COLUMN IF NOT EXISTS order_line_item_id VARCHAR REFERENCES order_line_items(id) ON DELETE CASCADE;
  
  -- Add role (type of file)
  ALTER TABLE order_attachments ADD COLUMN IF NOT EXISTS role file_role DEFAULT 'other';
  
  -- Add side (front/back/n/a)
  ALTER TABLE order_attachments ADD COLUMN IF NOT EXISTS side file_side DEFAULT 'na';
  
  -- Add isPrimary flag
  ALTER TABLE order_attachments ADD COLUMN IF NOT EXISTS is_primary BOOLEAN DEFAULT false NOT NULL;
  
  -- Add thumbnailUrl for previews
  ALTER TABLE order_attachments ADD COLUMN IF NOT EXISTS thumbnail_url TEXT;
END $$;

-- Create indexes for new columns
CREATE INDEX IF NOT EXISTS order_attachments_order_line_item_id_idx ON order_attachments(order_line_item_id);
CREATE INDEX IF NOT EXISTS order_attachments_role_idx ON order_attachments(role);

-- Create job_files table - links files to production jobs
CREATE TABLE IF NOT EXISTS job_files (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id VARCHAR NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  file_id VARCHAR NOT NULL REFERENCES order_attachments(id) ON DELETE CASCADE,
  role file_role DEFAULT 'artwork',
  attached_by_user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMP DEFAULT NOW() NOT NULL
);

-- Create indexes for job_files
CREATE INDEX IF NOT EXISTS job_files_job_id_idx ON job_files(job_id);
CREATE INDEX IF NOT EXISTS job_files_file_id_idx ON job_files(file_id);
CREATE INDEX IF NOT EXISTS job_files_role_idx ON job_files(role);

-- Comments for documentation
COMMENT ON TABLE order_attachments IS 'Extended with artwork metadata: role, side, isPrimary, thumbnailUrl, orderLineItemId';
COMMENT ON COLUMN order_attachments.role IS 'File purpose: artwork, proof, reference, customer_po, setup, output, other';
COMMENT ON COLUMN order_attachments.side IS 'For sided products: front, back, or na';
COMMENT ON COLUMN order_attachments.is_primary IS 'Primary artwork file for this side/role combination';
COMMENT ON COLUMN order_attachments.thumbnail_url IS 'Optional thumbnail URL for quick preview in UI';
COMMENT ON COLUMN order_attachments.order_line_item_id IS 'Optional link to specific line item (null = order-level)';

COMMENT ON TABLE job_files IS 'Links production jobs to files/artwork from orders';
COMMENT ON COLUMN job_files.file_id IS 'References order_attachments - same file can be linked to multiple jobs';
COMMENT ON COLUMN job_files.role IS 'Role of file in production context: artwork, setup, output, etc.';
