-- Migration: 0021_add_organization_id_to_tables.sql
-- Description: Adds organization_id FK to all tenant-scoped tables and backfills with Titan Group org
-- Run order: SECOND (after 0020_multi_tenant_organizations.sql)
-- IMPORTANT: This migration uses 'org_titan_001' - must match the ID in 0020 migration

-- ============================================================
-- PHASE 1: Add organization_id columns (nullable initially)
-- ============================================================

-- Media Assets
DO $$ BEGIN
  ALTER TABLE media_assets ADD COLUMN organization_id VARCHAR;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- Product Types
DO $$ BEGIN
  ALTER TABLE product_types ADD COLUMN organization_id VARCHAR;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- Products
DO $$ BEGIN
  ALTER TABLE products ADD COLUMN organization_id VARCHAR;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- Global Variables
DO $$ BEGIN
  ALTER TABLE global_variables ADD COLUMN organization_id VARCHAR;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- Quotes
DO $$ BEGIN
  ALTER TABLE quotes ADD COLUMN organization_id VARCHAR;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- Pricing Rules
DO $$ BEGIN
  ALTER TABLE pricing_rules ADD COLUMN organization_id VARCHAR;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- Formula Templates
DO $$ BEGIN
  ALTER TABLE formula_templates ADD COLUMN organization_id VARCHAR;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- Email Settings
DO $$ BEGIN
  ALTER TABLE email_settings ADD COLUMN organization_id VARCHAR;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- Audit Logs
DO $$ BEGIN
  ALTER TABLE audit_logs ADD COLUMN organization_id VARCHAR;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- Company Settings
DO $$ BEGIN
  ALTER TABLE company_settings ADD COLUMN organization_id VARCHAR;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- Customers
DO $$ BEGIN
  ALTER TABLE customers ADD COLUMN organization_id VARCHAR;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- Orders
DO $$ BEGIN
  ALTER TABLE orders ADD COLUMN organization_id VARCHAR;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- Invoices
DO $$ BEGIN
  ALTER TABLE invoices ADD COLUMN organization_id VARCHAR;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- Job Statuses
DO $$ BEGIN
  ALTER TABLE job_statuses ADD COLUMN organization_id VARCHAR;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- Materials
DO $$ BEGIN
  ALTER TABLE materials ADD COLUMN organization_id VARCHAR;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- Vendors
DO $$ BEGIN
  ALTER TABLE vendors ADD COLUMN organization_id VARCHAR;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- Purchase Orders
DO $$ BEGIN
  ALTER TABLE purchase_orders ADD COLUMN organization_id VARCHAR;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- OAuth Connections
DO $$ BEGIN
  ALTER TABLE oauth_connections ADD COLUMN organization_id VARCHAR;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- Accounting Sync Jobs
DO $$ BEGIN
  ALTER TABLE accounting_sync_jobs ADD COLUMN organization_id VARCHAR;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- ============================================================
-- PHASE 2: Backfill all existing rows with Titan Group organization
-- ============================================================

UPDATE media_assets SET organization_id = 'org_titan_001' WHERE organization_id IS NULL;
UPDATE product_types SET organization_id = 'org_titan_001' WHERE organization_id IS NULL;
UPDATE products SET organization_id = 'org_titan_001' WHERE organization_id IS NULL;
UPDATE global_variables SET organization_id = 'org_titan_001' WHERE organization_id IS NULL;
UPDATE quotes SET organization_id = 'org_titan_001' WHERE organization_id IS NULL;
UPDATE pricing_rules SET organization_id = 'org_titan_001' WHERE organization_id IS NULL;
UPDATE formula_templates SET organization_id = 'org_titan_001' WHERE organization_id IS NULL;
UPDATE email_settings SET organization_id = 'org_titan_001' WHERE organization_id IS NULL;
UPDATE audit_logs SET organization_id = 'org_titan_001' WHERE organization_id IS NULL;
UPDATE company_settings SET organization_id = 'org_titan_001' WHERE organization_id IS NULL;
UPDATE customers SET organization_id = 'org_titan_001' WHERE organization_id IS NULL;
UPDATE orders SET organization_id = 'org_titan_001' WHERE organization_id IS NULL;
UPDATE invoices SET organization_id = 'org_titan_001' WHERE organization_id IS NULL;
UPDATE job_statuses SET organization_id = 'org_titan_001' WHERE organization_id IS NULL;
UPDATE materials SET organization_id = 'org_titan_001' WHERE organization_id IS NULL;
UPDATE vendors SET organization_id = 'org_titan_001' WHERE organization_id IS NULL;
UPDATE purchase_orders SET organization_id = 'org_titan_001' WHERE organization_id IS NULL;
UPDATE oauth_connections SET organization_id = 'org_titan_001' WHERE organization_id IS NULL;
UPDATE accounting_sync_jobs SET organization_id = 'org_titan_001' WHERE organization_id IS NULL;

-- ============================================================
-- PHASE 3: Set NOT NULL constraints (after backfill)
-- ============================================================

ALTER TABLE media_assets ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE product_types ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE products ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE global_variables ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE quotes ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE pricing_rules ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE formula_templates ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE email_settings ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE audit_logs ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE company_settings ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE customers ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE orders ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE invoices ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE job_statuses ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE materials ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE vendors ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE purchase_orders ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE oauth_connections ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE accounting_sync_jobs ALTER COLUMN organization_id SET NOT NULL;

-- ============================================================
-- PHASE 4: Add foreign key constraints (idempotent)
-- ============================================================

DO $$ BEGIN
  ALTER TABLE media_assets ADD CONSTRAINT media_assets_organization_fk 
    FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE product_types ADD CONSTRAINT product_types_organization_fk 
    FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE products ADD CONSTRAINT products_organization_fk 
    FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE global_variables ADD CONSTRAINT global_variables_organization_fk 
    FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE quotes ADD CONSTRAINT quotes_organization_fk 
    FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE pricing_rules ADD CONSTRAINT pricing_rules_organization_fk 
    FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE formula_templates ADD CONSTRAINT formula_templates_organization_fk 
    FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE email_settings ADD CONSTRAINT email_settings_organization_fk 
    FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE audit_logs ADD CONSTRAINT audit_logs_organization_fk 
    FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE company_settings ADD CONSTRAINT company_settings_organization_fk 
    FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE customers ADD CONSTRAINT customers_organization_fk 
    FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE orders ADD CONSTRAINT orders_organization_fk 
    FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE invoices ADD CONSTRAINT invoices_organization_fk 
    FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE job_statuses ADD CONSTRAINT job_statuses_organization_fk 
    FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE materials ADD CONSTRAINT materials_organization_fk 
    FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE vendors ADD CONSTRAINT vendors_organization_fk 
    FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE purchase_orders ADD CONSTRAINT purchase_orders_organization_fk 
    FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE oauth_connections ADD CONSTRAINT oauth_connections_organization_fk 
    FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE accounting_sync_jobs ADD CONSTRAINT accounting_sync_jobs_organization_fk 
    FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================
-- PHASE 5: Create basic organization_id indexes
-- ============================================================

CREATE INDEX IF NOT EXISTS media_assets_organization_id_idx ON media_assets(organization_id);
CREATE INDEX IF NOT EXISTS product_types_organization_id_idx ON product_types(organization_id);
CREATE INDEX IF NOT EXISTS products_organization_id_idx ON products(organization_id);
CREATE INDEX IF NOT EXISTS global_variables_organization_id_idx ON global_variables(organization_id);
CREATE INDEX IF NOT EXISTS quotes_organization_id_idx ON quotes(organization_id);
CREATE INDEX IF NOT EXISTS pricing_rules_organization_id_idx ON pricing_rules(organization_id);
CREATE INDEX IF NOT EXISTS formula_templates_organization_id_idx ON formula_templates(organization_id);
CREATE INDEX IF NOT EXISTS email_settings_organization_id_idx ON email_settings(organization_id);
CREATE INDEX IF NOT EXISTS audit_logs_organization_id_idx ON audit_logs(organization_id);
CREATE INDEX IF NOT EXISTS company_settings_organization_id_idx ON company_settings(organization_id);
CREATE INDEX IF NOT EXISTS customers_organization_id_idx ON customers(organization_id);
CREATE INDEX IF NOT EXISTS orders_organization_id_idx ON orders(organization_id);
CREATE INDEX IF NOT EXISTS invoices_organization_id_idx ON invoices(organization_id);
CREATE INDEX IF NOT EXISTS job_statuses_organization_id_idx ON job_statuses(organization_id);
CREATE INDEX IF NOT EXISTS materials_organization_id_idx ON materials(organization_id);
CREATE INDEX IF NOT EXISTS vendors_organization_id_idx ON vendors(organization_id);
CREATE INDEX IF NOT EXISTS purchase_orders_organization_id_idx ON purchase_orders(organization_id);
CREATE INDEX IF NOT EXISTS oauth_connections_organization_id_idx ON oauth_connections(organization_id);
CREATE INDEX IF NOT EXISTS accounting_sync_jobs_organization_id_idx ON accounting_sync_jobs(organization_id);

-- ============================================================
-- PHASE 6: Drop global unique constraints that need to become org-scoped
-- ============================================================

-- Drop global unique constraints (they will be replaced with org-scoped unique constraints)
ALTER TABLE product_types DROP CONSTRAINT IF EXISTS product_types_name_key;
ALTER TABLE global_variables DROP CONSTRAINT IF EXISTS global_variables_name_key;
ALTER TABLE quotes DROP CONSTRAINT IF EXISTS quotes_quote_number_key;
ALTER TABLE pricing_rules DROP CONSTRAINT IF EXISTS pricing_rules_name_key;
ALTER TABLE formula_templates DROP CONSTRAINT IF EXISTS formula_templates_name_key;
ALTER TABLE job_statuses DROP CONSTRAINT IF EXISTS job_statuses_key_key;
ALTER TABLE materials DROP CONSTRAINT IF EXISTS materials_sku_key;
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_order_number_key;
ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_invoice_number_key;
ALTER TABLE purchase_orders DROP CONSTRAINT IF EXISTS purchase_orders_po_number_key;

-- Also drop as indexes (some may have been created as indexes, not constraints)
DROP INDEX IF EXISTS product_types_name_key;
DROP INDEX IF EXISTS global_variables_name_key;
DROP INDEX IF EXISTS quotes_quote_number_key;
DROP INDEX IF EXISTS pricing_rules_name_key;
DROP INDEX IF EXISTS formula_templates_name_key;
DROP INDEX IF EXISTS job_statuses_key_key;
DROP INDEX IF EXISTS materials_sku_key;
DROP INDEX IF EXISTS orders_order_number_key;
DROP INDEX IF EXISTS invoices_invoice_number_key;
DROP INDEX IF EXISTS purchase_orders_po_number_key;

-- ============================================================
-- PHASE 7: Create org-scoped unique constraints
-- ============================================================

-- Product type name unique per org
CREATE UNIQUE INDEX IF NOT EXISTS product_types_org_name_unique 
  ON product_types(organization_id, name);

-- Global variable name unique per org
CREATE UNIQUE INDEX IF NOT EXISTS global_variables_org_name_unique 
  ON global_variables(organization_id, name);

-- Quote number unique per org
CREATE UNIQUE INDEX IF NOT EXISTS quotes_org_quote_number_unique 
  ON quotes(organization_id, quote_number);

-- Pricing rule name unique per org
CREATE UNIQUE INDEX IF NOT EXISTS pricing_rules_org_name_unique 
  ON pricing_rules(organization_id, name);

-- Formula template name unique per org
CREATE UNIQUE INDEX IF NOT EXISTS formula_templates_org_name_unique 
  ON formula_templates(organization_id, name);

-- Job status key unique per org
CREATE UNIQUE INDEX IF NOT EXISTS job_statuses_org_key_unique 
  ON job_statuses(organization_id, key);

-- Material SKU unique per org
CREATE UNIQUE INDEX IF NOT EXISTS materials_org_sku_unique 
  ON materials(organization_id, sku);

-- Order number unique per org
CREATE UNIQUE INDEX IF NOT EXISTS orders_org_order_number_unique 
  ON orders(organization_id, order_number);

-- Invoice number unique per org
CREATE UNIQUE INDEX IF NOT EXISTS invoices_org_invoice_number_unique 
  ON invoices(organization_id, invoice_number);

-- PO number unique per org
CREATE UNIQUE INDEX IF NOT EXISTS purchase_orders_org_po_number_unique 
  ON purchase_orders(organization_id, po_number);

-- ============================================================
-- PHASE 8: Create composite indexes for common query patterns
-- ============================================================

-- Customers - common queries by org + status
CREATE INDEX IF NOT EXISTS customers_org_is_active_idx ON customers(organization_id, is_active);

-- Quotes - common queries by org + status + date
CREATE INDEX IF NOT EXISTS quotes_org_status_idx ON quotes(organization_id, status);
CREATE INDEX IF NOT EXISTS quotes_org_created_at_idx ON quotes(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS quotes_org_customer_idx ON quotes(organization_id, customer_id);

-- Orders - common queries by org + status + date
CREATE INDEX IF NOT EXISTS orders_org_status_idx ON orders(organization_id, status);
CREATE INDEX IF NOT EXISTS orders_org_created_at_idx ON orders(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS orders_org_customer_idx ON orders(organization_id, customer_id);

-- Invoices - common queries by org + status + date
CREATE INDEX IF NOT EXISTS invoices_org_status_idx ON invoices(organization_id, status);
CREATE INDEX IF NOT EXISTS invoices_org_created_at_idx ON invoices(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS invoices_org_customer_idx ON invoices(organization_id, customer_id);

-- Products - common queries by org + active status
CREATE INDEX IF NOT EXISTS products_org_is_active_idx ON products(organization_id, is_active);
CREATE INDEX IF NOT EXISTS products_org_product_type_idx ON products(organization_id, product_type_id);

-- Materials - common queries by org + active status
CREATE INDEX IF NOT EXISTS materials_org_is_active_idx ON materials(organization_id, is_active);
CREATE INDEX IF NOT EXISTS materials_org_category_idx ON materials(organization_id, category);

-- Vendors - common queries by org + active status
CREATE INDEX IF NOT EXISTS vendors_org_is_active_idx ON vendors(organization_id, is_active);

-- Purchase Orders - common queries by org + status + vendor
CREATE INDEX IF NOT EXISTS purchase_orders_org_status_idx ON purchase_orders(organization_id, status);
CREATE INDEX IF NOT EXISTS purchase_orders_org_vendor_idx ON purchase_orders(organization_id, vendor_id);

-- Audit logs - common queries by org + date + action
CREATE INDEX IF NOT EXISTS audit_logs_org_created_at_idx ON audit_logs(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_logs_org_action_idx ON audit_logs(organization_id, action_type);
CREATE INDEX IF NOT EXISTS audit_logs_org_entity_idx ON audit_logs(organization_id, entity_type, entity_id);

-- OAuth Connections - common queries by org + provider
CREATE INDEX IF NOT EXISTS oauth_connections_org_provider_idx ON oauth_connections(organization_id, provider);

-- Accounting Sync Jobs - common queries by org + status + date
CREATE INDEX IF NOT EXISTS accounting_sync_jobs_org_status_idx ON accounting_sync_jobs(organization_id, status);
CREATE INDEX IF NOT EXISTS accounting_sync_jobs_org_created_idx ON accounting_sync_jobs(organization_id, created_at DESC);
