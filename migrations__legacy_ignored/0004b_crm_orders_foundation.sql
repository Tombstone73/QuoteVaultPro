-- Migration: 0004b_crm_orders_foundation.sql
-- Creates customers, orders, and order_line_items tables (foundation for CRM/Orders module)
-- This migration was missing from the original sequence

-- ============================================================
-- Customers table
-- ============================================================
CREATE TABLE IF NOT EXISTS customers (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  company_name varchar(255) NOT NULL,
  customer_type varchar(50) DEFAULT 'business',
  email varchar(255),
  phone varchar(50),
  website varchar(255),
  billing_address text,
  shipping_address text,
  tax_id varchar(100),
  credit_limit decimal(10, 2) DEFAULT '0',
  current_balance decimal(10, 2) DEFAULT '0',
  status varchar(50) DEFAULT 'active',
  is_active boolean NOT NULL DEFAULT true,
  user_id varchar REFERENCES users(id) ON DELETE SET NULL,
  assigned_to varchar REFERENCES users(id),
  notes text,
  external_accounting_id varchar(64),
  sync_status varchar(20),
  sync_error text,
  synced_at timestamp,
  created_at timestamp DEFAULT now() NOT NULL,
  updated_at timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS customers_email_idx ON customers(email);
CREATE INDEX IF NOT EXISTS customers_user_id_idx ON customers(user_id);

-- ============================================================
-- Customer Contacts table
-- ============================================================
CREATE TABLE IF NOT EXISTS customer_contacts (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id varchar NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  first_name varchar(100) NOT NULL,
  last_name varchar(100) NOT NULL,
  title varchar(100),
  email varchar(255),
  phone varchar(50),
  mobile varchar(50),
  is_primary boolean DEFAULT false NOT NULL,
  created_at timestamp DEFAULT now() NOT NULL,
  updated_at timestamp DEFAULT now() NOT NULL
);

-- ============================================================
-- Customer Notes table
-- ============================================================
CREATE TABLE IF NOT EXISTS customer_notes (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id varchar NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  user_id varchar NOT NULL REFERENCES users(id),
  note text NOT NULL,
  is_internal boolean DEFAULT true NOT NULL,
  created_at timestamp DEFAULT now() NOT NULL,
  updated_at timestamp DEFAULT now() NOT NULL
);

-- ============================================================
-- Customer Credit Transactions table
-- ============================================================
CREATE TABLE IF NOT EXISTS customer_credit_transactions (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id varchar NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  user_id varchar NOT NULL REFERENCES users(id),
  transaction_type varchar(50) NOT NULL,
  amount decimal(10, 2) NOT NULL,
  description text NOT NULL,
  reference_number varchar(100),
  created_at timestamp DEFAULT now() NOT NULL
);

-- ============================================================
-- Orders table
-- ============================================================
CREATE TABLE IF NOT EXISTS orders (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number varchar(50) NOT NULL,
  quote_id varchar REFERENCES quotes(id) ON DELETE SET NULL,
  customer_id varchar NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  contact_id varchar REFERENCES customer_contacts(id) ON DELETE SET NULL,
  status varchar(50) NOT NULL DEFAULT 'new',
  priority varchar(50) NOT NULL DEFAULT 'normal',
  fulfillment_status varchar(50) NOT NULL DEFAULT 'pending',
  due_date timestamp with time zone,
  promised_date timestamp with time zone,
  subtotal decimal(10, 2) NOT NULL DEFAULT '0',
  tax decimal(10, 2) NOT NULL DEFAULT '0',
  total decimal(10, 2) NOT NULL DEFAULT '0',
  discount decimal(10, 2) NOT NULL DEFAULT '0',
  notes_internal text,
  shipping_address jsonb,
  packing_slip_html text,
  external_accounting_id varchar(64),
  sync_status varchar(20),
  sync_error text,
  synced_at timestamp,
  created_by_user_id varchar NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamp DEFAULT now() NOT NULL,
  updated_at timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS orders_order_number_idx ON orders(order_number);
CREATE INDEX IF NOT EXISTS orders_customer_id_idx ON orders(customer_id);
CREATE INDEX IF NOT EXISTS orders_status_idx ON orders(status);
CREATE INDEX IF NOT EXISTS orders_fulfillment_status_idx ON orders(fulfillment_status);
CREATE INDEX IF NOT EXISTS orders_due_date_idx ON orders(due_date);
CREATE INDEX IF NOT EXISTS orders_created_at_idx ON orders(created_at);
CREATE INDEX IF NOT EXISTS orders_created_by_user_id_idx ON orders(created_by_user_id);

-- ============================================================
-- Order Line Items table
-- ============================================================
CREATE TABLE IF NOT EXISTS order_line_items (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id varchar NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  quote_line_item_id varchar REFERENCES quote_line_items(id) ON DELETE SET NULL,
  product_id varchar NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  product_variant_id varchar REFERENCES product_variants(id) ON DELETE SET NULL,
  product_type varchar(50) NOT NULL DEFAULT 'wide_roll',
  description text NOT NULL,
  width decimal(10, 2),
  height decimal(10, 2),
  quantity integer NOT NULL,
  sqft decimal(10, 2),
  unit_price decimal(10, 2) NOT NULL,
  total_price decimal(10, 2) NOT NULL,
  status varchar(50) NOT NULL DEFAULT 'queued',
  specs_json jsonb,
  selected_options jsonb DEFAULT '[]'::jsonb NOT NULL,
  nesting_config_snapshot jsonb,
  created_at timestamp DEFAULT now() NOT NULL,
  updated_at timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS order_line_items_order_id_idx ON order_line_items(order_id);
CREATE INDEX IF NOT EXISTS order_line_items_product_id_idx ON order_line_items(product_id);
CREATE INDEX IF NOT EXISTS order_line_items_status_idx ON order_line_items(status);
CREATE INDEX IF NOT EXISTS order_line_items_product_type_idx ON order_line_items(product_type);

-- ============================================================
-- Order Attachments table
-- ============================================================
CREATE TABLE IF NOT EXISTS order_attachments (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id varchar NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  quote_id varchar REFERENCES quotes(id) ON DELETE SET NULL,
  uploaded_by_user_id varchar REFERENCES users(id) ON DELETE SET NULL,
  uploaded_by_name varchar(255),
  file_name varchar(500) NOT NULL,
  file_url text NOT NULL,
  file_size integer,
  mime_type varchar(100),
  description text,
  created_at timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS order_attachments_order_id_idx ON order_attachments(order_id);
CREATE INDEX IF NOT EXISTS order_attachments_quote_id_idx ON order_attachments(quote_id);

-- ============================================================
-- Order Audit Log table
-- ============================================================
CREATE TABLE IF NOT EXISTS order_audit_log (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id varchar NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  user_id varchar REFERENCES users(id) ON DELETE SET NULL,
  user_name varchar(255),
  action_type varchar(100) NOT NULL,
  from_status varchar(50),
  to_status varchar(50),
  note text,
  metadata jsonb,
  created_at timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS order_audit_log_order_id_idx ON order_audit_log(order_id);
CREATE INDEX IF NOT EXISTS order_audit_log_created_at_idx ON order_audit_log(created_at);

-- ============================================================
-- Quote Workflow States table
-- ============================================================
CREATE TABLE IF NOT EXISTS quote_workflow_states (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id varchar NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  status varchar(50) NOT NULL DEFAULT 'draft',
  approved_by_customer_user_id varchar REFERENCES users(id) ON DELETE SET NULL,
  approved_by_staff_user_id varchar REFERENCES users(id) ON DELETE SET NULL,
  rejected_by_user_id varchar REFERENCES users(id) ON DELETE SET NULL,
  rejection_reason text,
  customer_notes text,
  staff_notes text,
  created_at timestamp DEFAULT now() NOT NULL,
  updated_at timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS quote_workflow_states_quote_id_idx ON quote_workflow_states(quote_id);
CREATE INDEX IF NOT EXISTS quote_workflow_states_status_idx ON quote_workflow_states(status);

-- ============================================================
-- Product Types table (for product categorization)
-- ============================================================
CREATE TABLE IF NOT EXISTS product_types (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar(100) NOT NULL,
  description text,
  sort_order integer DEFAULT 0 NOT NULL,
  created_at timestamp DEFAULT now() NOT NULL,
  updated_at timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS product_types_sort_order_idx ON product_types(sort_order);

-- Add product_type_id column to products if not exists
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name='products' AND column_name='product_type_id'
  ) THEN
    ALTER TABLE products ADD COLUMN product_type_id varchar REFERENCES product_types(id) ON DELETE RESTRICT;
  END IF;
END $$;

-- ============================================================
-- Job Statuses table (configurable workflow)
-- ============================================================
CREATE TABLE IF NOT EXISTS job_statuses (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  key varchar(50) NOT NULL,
  label varchar(100) NOT NULL,
  position integer NOT NULL,
  badge_variant varchar(50) DEFAULT 'default',
  is_default boolean DEFAULT false NOT NULL,
  created_at timestamp DEFAULT now() NOT NULL,
  updated_at timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS job_statuses_position_idx ON job_statuses(position);
CREATE INDEX IF NOT EXISTS job_statuses_key_idx ON job_statuses(key);
CREATE INDEX IF NOT EXISTS job_statuses_is_default_idx ON job_statuses(is_default);

-- ============================================================
-- Email Settings table
-- ============================================================
CREATE TABLE IF NOT EXISTS email_settings (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  provider varchar(50) NOT NULL DEFAULT 'gmail',
  from_address varchar(255) NOT NULL,
  from_name varchar(255) NOT NULL,
  client_id text,
  client_secret text,
  refresh_token text,
  smtp_host varchar(255),
  smtp_port integer,
  smtp_username varchar(255),
  smtp_password text,
  is_active boolean DEFAULT true NOT NULL,
  is_default boolean DEFAULT true NOT NULL,
  created_at timestamp DEFAULT now() NOT NULL,
  updated_at timestamp DEFAULT now() NOT NULL
);

-- ============================================================
-- Audit Logs table
-- ============================================================
CREATE TABLE IF NOT EXISTS audit_logs (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id varchar REFERENCES users(id),
  user_name varchar,
  action_type varchar NOT NULL,
  entity_type varchar NOT NULL,
  entity_id varchar,
  entity_name varchar,
  description text NOT NULL,
  old_values jsonb,
  new_values jsonb,
  ip_address varchar,
  user_agent text,
  created_at timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action_type ON audit_logs(action_type);
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity_type ON audit_logs(entity_type);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at);

-- ============================================================
-- Company Settings table
-- ============================================================
CREATE TABLE IF NOT EXISTS company_settings (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  company_name varchar(255) NOT NULL,
  address text,
  phone varchar(50),
  email varchar(255),
  website varchar(255),
  logo_url text,
  tax_rate decimal(5, 2) DEFAULT '0' NOT NULL,
  default_margin decimal(5, 2) DEFAULT '0' NOT NULL,
  created_at timestamp DEFAULT now() NOT NULL,
  updated_at timestamp DEFAULT now() NOT NULL
);

-- ============================================================
-- Add missing columns to quotes table
-- ============================================================
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name='quotes' AND column_name='customer_id'
  ) THEN
    ALTER TABLE quotes ADD COLUMN customer_id varchar REFERENCES customers(id) ON DELETE SET NULL;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name='quotes' AND column_name='contact_id'
  ) THEN
    ALTER TABLE quotes ADD COLUMN contact_id varchar REFERENCES customer_contacts(id) ON DELETE SET NULL;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name='quotes' AND column_name='source'
  ) THEN
    ALTER TABLE quotes ADD COLUMN source varchar(50) NOT NULL DEFAULT 'internal';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name='quotes' AND column_name='status'
  ) THEN
    ALTER TABLE quotes ADD COLUMN status varchar(50) NOT NULL DEFAULT 'draft';
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS quotes_customer_id_idx ON quotes(customer_id);
CREATE INDEX IF NOT EXISTS quotes_contact_id_idx ON quotes(contact_id);
CREATE INDEX IF NOT EXISTS quotes_source_idx ON quotes(source);

-- ============================================================
-- Add missing columns to quote_line_items table
-- ============================================================
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name='quote_line_items' AND column_name='product_type'
  ) THEN
    ALTER TABLE quote_line_items ADD COLUMN product_type varchar(50) NOT NULL DEFAULT 'wide_roll';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name='quote_line_items' AND column_name='specs_json'
  ) THEN
    ALTER TABLE quote_line_items ADD COLUMN specs_json jsonb;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS quote_line_items_product_type_idx ON quote_line_items(product_type);

-- ============================================================
-- Add role column to users table
-- ============================================================
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name='users' AND column_name='role'
  ) THEN
    ALTER TABLE users ADD COLUMN role varchar(50) DEFAULT 'employee' NOT NULL;
  END IF;
END $$;

-- ============================================================
-- Add missing columns to products table
-- ============================================================
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name='products' AND column_name='min_price_per_item'
  ) THEN
    ALTER TABLE products ADD COLUMN min_price_per_item decimal(10, 2);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name='products' AND column_name='nesting_volume_pricing'
  ) THEN
    ALTER TABLE products ADD COLUMN nesting_volume_pricing jsonb DEFAULT '{"enabled":false,"tiers":[]}'::jsonb NOT NULL;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name='products' AND column_name='requires_production_job'
  ) THEN
    ALTER TABLE products ADD COLUMN requires_production_job boolean DEFAULT true NOT NULL;
  END IF;
END $$;

-- ============================================================
-- Add volume_pricing to product_variants
-- ============================================================
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name='product_variants' AND column_name='volume_pricing'
  ) THEN
    ALTER TABLE product_variants ADD COLUMN volume_pricing jsonb DEFAULT '{"enabled":false,"tiers":[]}'::jsonb NOT NULL;
  END IF;
END $$;

-- ============================================================
-- Initialize next_order_number sequence
-- ============================================================
INSERT INTO global_variables (name, value, description, category)
VALUES ('next_order_number', '1001', 'Next order number sequence', 'numbering')
ON CONFLICT (name) DO NOTHING;

-- ============================================================
-- QuickBooks Integration Enums and Tables
-- ============================================================

-- Create enum types for QuickBooks integration
DO $$ BEGIN
  CREATE TYPE accounting_provider AS ENUM ('quickbooks');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE sync_direction AS ENUM ('push', 'pull');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE sync_status_enum AS ENUM ('pending', 'processing', 'synced', 'error', 'skipped');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE sync_resource AS ENUM ('customers', 'invoices', 'orders');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- OAuth Connections table
CREATE TABLE IF NOT EXISTS oauth_connections (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  provider accounting_provider NOT NULL,
  company_id varchar(64) NOT NULL,
  access_token text NOT NULL,
  refresh_token text NOT NULL,
  token_expires_at timestamp,
  metadata jsonb,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS oauth_connections_provider_idx ON oauth_connections(provider);

-- Accounting Sync Jobs table
CREATE TABLE IF NOT EXISTS accounting_sync_jobs (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  provider accounting_provider NOT NULL,
  resource_type sync_resource NOT NULL,
  direction sync_direction NOT NULL,
  status sync_status_enum NOT NULL DEFAULT 'pending',
  error text,
  payload_json jsonb,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sync_jobs_status_idx ON accounting_sync_jobs(status);
CREATE INDEX IF NOT EXISTS sync_jobs_resource_direction_idx ON accounting_sync_jobs(resource_type, direction);
