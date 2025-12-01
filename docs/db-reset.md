# Database Reset & Migration Guide

## ⚠️ IMPORTANT: DO NOT USE `db:push` FOR PRODUCTION

This project uses SQL migrations via Drizzle Kit. The `db:push` command should only be used for rapid prototyping in isolated development environments - **never on shared or production databases**.

## Commands

### Run Migrations (Recommended)
```bash
npm run db:migrate
```
This runs all pending SQL migrations in order and tracks which have been applied.

### Generate a New Migration
When you modify `shared/schema.ts`, generate a migration:
```bash
npx drizzle-kit generate
```
This creates a new SQL file in `/migrations/` that you should review before running.

### View Migration Status
```bash
npx drizzle-kit status
```

## Fresh Database Setup

### Option 1: Create New Neon Database
1. Go to https://neon.tech and create a new database
2. Copy the connection string
3. Update `.env` with the new `DATABASE_URL`
4. Run migrations:
   ```bash
   npm run db:migrate
   ```

### Option 2: Reset Existing Neon Database
1. In Neon console, delete all tables (or delete and recreate the database)
2. Run migrations:
   ```bash
   npm run db:migrate
   ```

## Migration File Structure

```
migrations/
├── 0000_cool_taskmaster.sql        # Core schema (users, products, quotes)
├── 0001_clever_human_torch.sql     # Global variables value type change
├── 0002_luxuriant_veda.sql         # Product price breaks
├── 0003_add_nesting_calculator.sql # Nesting calculator fields
├── 0004_make_pricing_formula_optional.sql
├── 0004b_crm_orders_foundation.sql # CRM, orders, customers, OAuth
├── 0005_production_workflow.sql    # Jobs, job notes, status log
├── 0006_invoicing.sql              # Invoices, payments
├── 0007_shipping_fulfillment.sql   # Shipments
├── 0008_inventory_management.sql   # Materials, inventory
├── 0009_vendors_purchase_orders.sql # Vendors, POs
├── 0011_artwork_file_handling.sql  # File roles, job files
├── 0020_multi_tenant_organizations.sql # Organizations, user_organizations
├── 0021_add_organization_id_to_tables.sql # Multi-tenant FK columns
└── meta/
    └── _journal.json               # Migration history tracking
```

## Default Organization

After running migrations, the database contains:
- **Titan Group** organization (`org_titan_001`)
- All new users will be automatically linked to this organization

## Troubleshooting

### "relation does not exist" errors
The migrations have dependencies. Ensure you run them in order using `npm run db:migrate`.

### "duplicate key" or "already exists" errors
This usually means the migration was partially applied. You may need to reset the database and run migrations fresh.

### Schema out of sync
If `shared/schema.ts` differs from the database:
1. Generate a new migration: `npx drizzle-kit generate`
2. Review the generated SQL file
3. Run: `npm run db:migrate`

## Multi-Tenant Architecture

All tenant-scoped tables have an `organization_id` column. New records must include this field. The API middleware should automatically inject the current user's organization ID.

Tables with organization_id:
- products, product_types, quotes, customers, orders
- invoices, materials, vendors, purchase_orders
- global_variables, formula_templates, pricing_rules
- email_settings, audit_logs, company_settings
- job_statuses, oauth_connections, accounting_sync_jobs
- media_assets
