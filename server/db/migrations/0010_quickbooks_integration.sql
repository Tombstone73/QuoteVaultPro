-- QuickBooks Integration Schema
-- Add sync fields to customers and orders tables

-- Extend customers with externalAccountingId/sync fields
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS external_accounting_id varchar(64),
  ADD COLUMN IF NOT EXISTS sync_status varchar(20),
  ADD COLUMN IF NOT EXISTS sync_error text,
  ADD COLUMN IF NOT EXISTS synced_at timestamp;

CREATE INDEX IF NOT EXISTS idx_customers_external_accounting_id ON customers (external_accounting_id);

-- Extend orders with external accounting linkage
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS external_accounting_id varchar(64),
  ADD COLUMN IF NOT EXISTS sync_status varchar(20),
  ADD COLUMN IF NOT EXISTS sync_error text,
  ADD COLUMN IF NOT EXISTS synced_at timestamp;

CREATE INDEX IF NOT EXISTS idx_orders_external_accounting_id ON orders (external_accounting_id);

-- Safe creation of enums for OAuth and sync tables
DO $$ BEGIN
  CREATE TYPE accounting_provider AS ENUM ('quickbooks');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE sync_direction AS ENUM ('push', 'pull');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE sync_status_enum AS ENUM ('pending', 'processing', 'synced', 'error', 'skipped');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE sync_resource AS ENUM ('customer', 'invoice', 'order');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- OAuth connections (stores provider tokens)
CREATE TABLE IF NOT EXISTS oauth_connections (
  id varchar(36) PRIMARY KEY,
  provider accounting_provider NOT NULL,
  company_id varchar(64) NOT NULL,
  access_token text NOT NULL,
  refresh_token text NOT NULL,
  token_expires_at timestamp,
  created_by_user_id varchar(36) NOT NULL,
  created_at timestamp DEFAULT now() NOT NULL,
  updated_at timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_oauth_connections_provider ON oauth_connections (provider);

-- Sync job queue
CREATE TABLE IF NOT EXISTS accounting_sync_jobs (
  id varchar(36) PRIMARY KEY,
  provider accounting_provider NOT NULL,
  resource_type sync_resource NOT NULL,
  direction sync_direction NOT NULL,
  status sync_status_enum DEFAULT 'pending' NOT NULL,
  error text,
  payload_json jsonb,
  created_at timestamp DEFAULT now() NOT NULL,
  updated_at timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sync_jobs_status ON accounting_sync_jobs (status);
CREATE INDEX IF NOT EXISTS idx_sync_jobs_resource_direction ON accounting_sync_jobs (resource_type, direction);

-- Add missing material tracking fields to order_line_items
ALTER TABLE order_line_items
  ADD COLUMN IF NOT EXISTS material_id varchar(36),
  ADD COLUMN IF NOT EXISTS material_usage_json jsonb,
  ADD COLUMN IF NOT EXISTS requires_inventory boolean NOT NULL DEFAULT true;

-- Add foreign key constraint for material_id (if materials table exists)
DO $$ 
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'materials') AND
     NOT EXISTS (SELECT 1 FROM information_schema.table_constraints 
                 WHERE constraint_name = 'order_line_items_material_id_fkey') THEN
    ALTER TABLE order_line_items
      ADD CONSTRAINT order_line_items_material_id_fkey 
      FOREIGN KEY (material_id) REFERENCES materials(id) ON DELETE SET NULL;
  END IF;
END $$;
