# TITAN KERNEL Module Completion Document — Multi-Tenant Architecture & Organization Management

## 1. Module Purpose

The Multi-Tenant Architecture module establishes organization-level data isolation across the entire TitanOS platform. This foundational infrastructure change enables:

- **Internal Multi-Company Operations:** Support for multiple independent business units or brands within a single TitanOS deployment, each with isolated data.
- **Future SaaS Enablement:** Architecture designed to support external customer organizations with complete tenant separation.
- **Data Isolation Guarantees:** Prevent cross-tenant data leakage at the database, storage, and API layers.
- **Organization Context Awareness:** All tenant-scoped operations automatically resolve and enforce the correct organization boundary.

This module transforms TitanOS from a single-tenant application into a multi-tenant platform while maintaining backward compatibility with existing data through automatic migration and backfill strategies.

---

## 2. Completed Scope Overview

### Schema Changes
- Created `organizations` table as the tenant root entity.
- Created `user_organizations` junction table for many-to-many user-org relationships.
- Added `organizationId` column to all 19 tenant-scoped tables.
- Converted global unique constraints to per-organization scoped constraints.
- Added composite indexes for tenant-scoped queries.

### Tenant Middleware
- `tenantContext` middleware resolves `organizationId` from user session or header.
- `portalContext` middleware derives `organizationId` from customer record for portal users.
- `optionalTenantContext` for routes that work with or without tenant context.
- Auto-provisioning logic for users without organization membership.

### Storage Scoping
- All tenant-scoped storage functions accept `organizationId` as first parameter.
- Insert functions use `Omit<InsertType, 'organizationId'>` pattern.
- Query functions filter by `organizationId`.
- Jobs scoped via orders relationship (indirect scoping).

### Route Updates
- All tenant-scoped routes include `tenantContext` middleware.
- All storage calls pass `organizationId` from request context.
- Audit log creation includes `organizationId`.
- Portal routes use `portalContext` for customer-derived org resolution.

### Portal Scoping
- Portal users derive organization from linked customer record.
- Quote and order filtering by both `organizationId` and `customerId`.
- Explicit ownership verification before operations.

### QuickBooks Scoping
- All QB routes include `tenantContext`.
- Connection status verified against organization.
- Sync jobs filtered by `organizationId`.
- OAuth flow includes TODO for org-aware state parameter.

### Migrations
- `0020_multi_tenant_organizations.sql`: Core tables and backfill.
- `0021_per_org_unique_constraints.sql`: Constraint conversion and indexes.

---

## 3. Data Model Summary

### Organizations Table
```sql
organizations (
  id VARCHAR PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  slug VARCHAR(100) UNIQUE NOT NULL,
  type VARCHAR(50) DEFAULT 'internal',  -- 'internal' | 'customer'
  status VARCHAR(50) DEFAULT 'active',  -- 'active' | 'suspended' | 'inactive'
  settings JSONB DEFAULT '{}',
  billing JSONB DEFAULT '{}',
  createdAt TIMESTAMP DEFAULT NOW(),
  updatedAt TIMESTAMP DEFAULT NOW()
)
```

### User Organizations Table
```sql
user_organizations (
  id VARCHAR PRIMARY KEY,
  userId VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  organizationId VARCHAR NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  role VARCHAR(50) DEFAULT 'member',  -- 'owner' | 'admin' | 'member'
  isDefault BOOLEAN DEFAULT false,
  createdAt TIMESTAMP DEFAULT NOW(),
  updatedAt TIMESTAMP DEFAULT NOW(),
  UNIQUE(userId, organizationId)
)
```

### Tenant-Scoped Tables (19 Total)

| Table | Scoping Method | Notes |
|-------|---------------|-------|
| `customers` | Direct | Has `organizationId` column |
| `customer_contacts` | Direct | Has `organizationId` column |
| `customer_notes` | Direct | Has `organizationId` column |
| `customer_credit_transactions` | Direct | Has `organizationId` column |
| `quotes` | Direct | Has `organizationId` column |
| `quote_line_items` | Via Parent | Inherits from `quotes` |
| `orders` | Direct | Has `organizationId` column |
| `order_line_items` | Via Parent | Inherits from `orders` |
| `invoices` | Direct | Has `organizationId` column |
| `invoice_line_items` | Via Parent | Inherits from `invoices` |
| `payments` | Via Parent | Inherits from `invoices` |
| `jobs` | Via Parent | Inherits from `orders` (no direct `organizationId`) |
| `products` | Direct | Has `organizationId` column |
| `product_variants` | Via Parent | Inherits from `products` |
| `product_options` | Via Parent | Inherits from `products` |
| `materials` | Direct | Has `organizationId` column |
| `vendors` | Direct | Has `organizationId` column |
| `purchase_orders` | Direct | Has `organizationId` column |
| `purchase_order_line_items` | Via Parent | Inherits from `purchase_orders` |
| `media_assets` | Direct | Has `organizationId` column |
| `formula_templates` | Direct | Has `organizationId` column |
| `pricing_rules` | Direct | Has `organizationId` column |
| `email_settings` | Direct | Has `organizationId` column |
| `company_settings` | Direct | Has `organizationId` column |
| `job_status_config` | Direct | Has `organizationId` column |
| `audit_logs` | Direct | Has `organizationId` column |
| `oauth_connections` | Direct | Has `organizationId` column |
| `accounting_sync_jobs` | Direct | Has `organizationId` column |

### Enums

| Enum | Values | Usage |
|------|--------|-------|
| `organization_type` | `'internal'`, `'customer'` | Distinguishes internal business units from external SaaS customers |
| `organization_status` | `'active'`, `'suspended'`, `'inactive'` | Controls organization access state |
| `user_organization_role` | `'owner'`, `'admin'`, `'member'` | Role within organization context |

### Per-Organization Unique Constraints

The following constraints were converted from global uniqueness to per-organization uniqueness:

| Table | Constraint | Columns |
|-------|-----------|---------|
| `products` | `products_org_sku_unique` | `(organizationId, sku)` |
| `products` | `products_org_name_unique` | `(organizationId, name)` |
| `customers` | `customers_org_company_name_unique` | `(organizationId, companyName)` |
| `orders` | `orders_org_order_number_unique` | `(organizationId, orderNumber)` |
| `quotes` | `quotes_org_quote_number_unique` | `(organizationId, quoteNumber)` |
| `invoices` | `invoices_org_invoice_number_unique` | `(organizationId, invoiceNumber)` |
| `purchase_orders` | `purchase_orders_org_po_number_unique` | `(organizationId, poNumber)` |
| `materials` | `materials_org_sku_unique` | `(organizationId, sku)` |
| `materials` | `materials_org_name_unique` | `(organizationId, name)` |
| `vendors` | `vendors_org_name_unique` | `(organizationId, name)` |

### Composite Indexes

All tenant-scoped tables include an index on `organizationId` for query performance:

```sql
CREATE INDEX idx_{table}_organization_id ON {table}(organization_id);
```

---

## 4. Database Migration Summary

### Migration 0020: Core Multi-Tenant Infrastructure

**Purpose:** Establish the foundational multi-tenant schema with organizations, user-org relationships, and organizationId columns on all tenant tables.

**Tables Created:**
- `organizations` with all fields
- `user_organizations` with user-org membership

**Columns Added:**
- `organization_id VARCHAR REFERENCES organizations(id)` to all 19+ tenant tables

**Backfill Strategy:**
```sql
-- Create default organization
INSERT INTO organizations (id, name, slug, type, status)
VALUES ('org_titan_001', 'Titan Graphics', 'titan', 'internal', 'active')
ON CONFLICT (id) DO NOTHING;

-- Backfill all existing data to default org
UPDATE customers SET organization_id = 'org_titan_001' WHERE organization_id IS NULL;
UPDATE products SET organization_id = 'org_titan_001' WHERE organization_id IS NULL;
-- ... repeated for all tenant tables
```

**User Auto-Association:**
```sql
-- Associate all existing users with default organization
INSERT INTO user_organizations (id, user_id, organization_id, role, is_default)
SELECT 
  gen_random_uuid()::text,
  id,
  'org_titan_001',
  CASE WHEN role = 'owner' THEN 'owner' WHEN role = 'admin' THEN 'admin' ELSE 'member' END,
  true
FROM users
ON CONFLICT (user_id, organization_id) DO NOTHING;
```

**Idempotency Rules:**
- All `CREATE TABLE` uses `IF NOT EXISTS`.
- All `ALTER TABLE ADD COLUMN` wrapped in conditional blocks.
- All `INSERT` uses `ON CONFLICT DO NOTHING`.

### Migration 0021: Per-Organization Unique Constraints

**Purpose:** Convert global unique constraints to per-organization scoped constraints and add performance indexes.

**Unique Constraint Drops:**
```sql
ALTER TABLE products DROP CONSTRAINT IF EXISTS products_sku_key;
ALTER TABLE products DROP CONSTRAINT IF EXISTS products_name_key;
ALTER TABLE customers DROP CONSTRAINT IF EXISTS customers_company_name_key;
-- ... repeated for all affected tables
```

**New Per-Org Constraints:**
```sql
ALTER TABLE products ADD CONSTRAINT products_org_sku_unique 
  UNIQUE (organization_id, sku);
ALTER TABLE products ADD CONSTRAINT products_org_name_unique 
  UNIQUE (organization_id, name);
-- ... repeated for all scoped constraints
```

**Index Creation:**
```sql
CREATE INDEX IF NOT EXISTS idx_customers_organization_id ON customers(organization_id);
CREATE INDEX IF NOT EXISTS idx_products_organization_id ON products(organization_id);
-- ... repeated for all tenant tables
```

---

## 5. Backend (API + Server) Summary

### Tenant Middleware (`server/tenantContext.ts`)

#### `tenantContext` Middleware
Primary middleware for resolving organization context:

```typescript
export const tenantContext: RequestHandler = async (req, res, next) => {
  // 1. Check for X-Organization-Id header (org switching)
  // 2. Verify user has membership in requested org
  // 3. Fallback: Get user's default organization
  // 4. Fallback: Get any organization user belongs to
  // 5. Fallback: Derive from customer record (portal users)
  // 6. Auto-provision to default org if no membership exists
  
  req.organizationId = resolvedOrgId;
  req.organizationSlug = resolvedSlug;
  next();
};
```

**Resolution Priority:**
1. `X-Organization-Id` header (verified against membership)
2. User's default organization (from `user_organizations.isDefault`)
3. Any organization the user belongs to
4. Customer-linked organization (for portal users)
5. Auto-provisioned default organization

#### `portalContext` Middleware
Specialized middleware for customer portal users:

```typescript
export const portalContext: RequestHandler = async (req, res, next) => {
  // 1. Look up customer by userId
  // 2. Fallback: Look up customer by email
  // 3. Derive organizationId from customer.organizationId
  // 4. Attach both organizationId and customerId to request
  
  req.organizationId = customer.organizationId;
  req.portalCustomerId = customer.id;
  req.portalCustomer = customer;
  next();
};
```

#### `optionalTenantContext` Middleware
For routes that work with or without authentication:

```typescript
export const optionalTenantContext: RequestHandler = async (req, res, next) => {
  // Attempts to resolve org context but doesn't block if unavailable
  // Used for public/anonymous routes that behave differently when authenticated
};
```

#### Helper Functions

| Function | Purpose |
|----------|---------|
| `getRequestOrganizationId(req)` | Extract `organizationId` from request, throws if missing |
| `getRequestOrganizationIdOrDefault(req)` | Extract or fallback to `DEFAULT_ORGANIZATION_ID` |
| `getUserOrganizations(userId)` | Get all organizations a user belongs to |
| `setDefaultOrganization(userId, orgId)` | Update user's default organization |
| `ensureUserOrganization(userId)` | Ensure user has at least default org membership |
| `getPortalCustomer(req)` | Extract portal customer context from request |

#### Constants
```typescript
export const DEFAULT_ORGANIZATION_ID = 'org_titan_001';
export const DEFAULT_ORGANIZATION_SLUG = 'titan';
```

### Where Tenant Context is Wired

The `tenantContext` middleware is applied to all tenant-scoped API routes:

```typescript
app.get('/api/customers', isAuthenticated, tenantContext, async (req, res) => { ... });
app.post('/api/products', isAuthenticated, tenantContext, async (req, res) => { ... });
app.get('/api/orders', isAuthenticated, tenantContext, async (req, res) => { ... });
// ... all tenant-scoped routes
```

---

## 6. Storage Layer Summary

### Interface Pattern

All tenant-scoped storage functions follow this signature pattern:

```typescript
interface IStorage {
  // Read operations
  getCustomers(organizationId: string, filters?: FilterOptions): Promise<Customer[]>;
  getCustomerById(organizationId: string, id: string): Promise<Customer | undefined>;
  
  // Create operations (organizationId first, then Omit type)
  createCustomer(organizationId: string, data: Omit<InsertCustomer, 'organizationId'>): Promise<Customer>;
  
  // Update operations
  updateCustomer(organizationId: string, id: string, data: Partial<...>): Promise<Customer>;
  
  // Delete operations
  deleteCustomer(organizationId: string, id: string): Promise<void>;
}
```

### Implementation Pattern

```typescript
async getCustomers(organizationId: string, filters?: FilterOptions): Promise<Customer[]> {
  const conditions = [eq(customers.organizationId, organizationId)];
  // Add filter conditions...
  return await db.select().from(customers).where(and(...conditions));
}

async createCustomer(organizationId: string, data: Omit<InsertCustomer, 'organizationId'>): Promise<Customer> {
  const [customer] = await db.insert(customers)
    .values({ ...data, organizationId })
    .returning();
  return customer;
}
```

### Special Cases

#### Jobs Scoping (Via Orders)
Jobs don't have a direct `organizationId` column. They're scoped via their parent order:

```typescript
async getJobs(organizationId: string, filters?: JobFilters): Promise<Job[]> {
  // First get valid order IDs for this organization
  const validOrders = await db.select({ id: orders.id })
    .from(orders)
    .where(eq(orders.organizationId, organizationId));
  const validOrderIds = validOrders.map(o => o.id);
  
  // Then filter jobs by those order IDs
  const conditions = [inArray(jobs.orderId, validOrderIds)];
  // Apply additional filters...
  return await db.select().from(jobs).where(and(...conditions));
}
```

#### Audit Logs
Audit log creation accepts `organizationId` as first parameter:

```typescript
async createAuditLog(
  organizationId: string, 
  log: Omit<InsertAuditLog, 'organizationId'>
): Promise<AuditLog> {
  const [auditLog] = await db.insert(auditLogs)
    .values({ ...log, organizationId })
    .returning();
  return auditLog;
}
```

#### Portal-Specific Functions

```typescript
async getQuotesForCustomer(
  organizationId: string, 
  customerId: string, 
  filters?: { source?: string }
): Promise<QuoteWithRelations[]> {
  const conditions = [
    eq(quotes.organizationId, organizationId),
    eq(quotes.customerId, customerId),
  ];
  if (filters?.source) {
    conditions.push(eq(quotes.source, filters.source));
  }
  // Fetch with relations...
}
```

### Enforcement Rules

| Operation | Rule |
|-----------|------|
| **SELECT** | Always filter by `organizationId` in WHERE clause |
| **INSERT** | Always inject `organizationId` from request context |
| **UPDATE** | Always include `organizationId` in WHERE clause |
| **DELETE** | Always include `organizationId` in WHERE clause |

---

## 7. Route-Level Changes

### All Tenant-Scoped Routes Updated

Every route handler for tenant-owned resources follows this pattern:

```typescript
app.get('/api/{resource}', isAuthenticated, tenantContext, async (req: any, res) => {
  try {
    const organizationId = getRequestOrganizationId(req);
    if (!organizationId) {
      return res.status(500).json({ message: 'Missing organization context' });
    }
    
    const data = await storage.getResource(organizationId, /* filters */);
    res.json(data);
  } catch (error) {
    // Error handling
  }
});
```

### Route Categories Updated

#### Customer & CRM Routes
- `GET/POST /api/customers`
- `GET/PATCH/DELETE /api/customers/:id`
- `GET/POST /api/customers/:id/contacts`
- `GET/POST /api/customers/:id/notes`
- `GET/POST /api/customers/:id/credit-transactions`

#### Product Catalog Routes
- `GET/POST /api/products`
- `GET/PATCH/DELETE /api/products/:id`
- `PUT /api/products/:id/thumbnails`
- `POST /api/products/:id/clone`

#### Quote & Order Routes
- `GET/POST /api/quotes`
- `GET/PATCH/DELETE /api/quotes/:id`
- `POST /api/quotes/:id/convert-to-order`
- `GET/POST /api/orders`
- `GET/PATCH/DELETE /api/orders/:id`

#### Job & Production Routes
- `GET/POST /api/jobs`
- `GET/PATCH /api/jobs/:id`
- `GET/POST /api/job-status-config`

#### Invoicing & Payment Routes
- `GET/POST /api/invoices`
- `GET/PATCH/DELETE /api/invoices/:id`
- `POST /api/invoices/:id/send`
- `POST /api/payments`

#### Vendor & Procurement Routes
- `GET/POST /api/vendors`
- `GET/PATCH/DELETE /api/vendors/:id`
- `GET/POST /api/purchase-orders`
- `GET/PATCH/DELETE /api/purchase-orders/:id`
- `POST /api/purchase-orders/:id/receive`

#### Inventory & Materials Routes
- `GET/POST /api/materials`
- `GET/PATCH/DELETE /api/materials/:id`
- `POST /api/materials/:id/adjust`

#### Settings Routes
- `GET/POST /api/company-settings`
- `GET/POST /api/email-settings`
- `GET/POST /api/formula-templates`
- `GET/POST /api/pricing-rules`

#### Media & Assets Routes
- `GET/POST /api/media-assets`
- `DELETE /api/media-assets/:id`

### QuickBooks Integration Routes

All QuickBooks routes now include tenant context:

```typescript
app.get('/api/integrations/quickbooks/status', isAuthenticated, tenantContext, ...);
app.get('/api/integrations/quickbooks/auth-url', isAuthenticated, tenantContext, ...);
app.post('/api/integrations/quickbooks/disconnect', isAuthenticated, tenantContext, ...);
app.post('/api/integrations/quickbooks/sync/pull', isAuthenticated, tenantContext, ...);
app.post('/api/integrations/quickbooks/sync/push', isAuthenticated, tenantContext, ...);
app.get('/api/integrations/quickbooks/jobs', isAuthenticated, tenantContext, ...);
app.get('/api/integrations/quickbooks/jobs/:id', isAuthenticated, tenantContext, ...);
```

Sync jobs are filtered by `organizationId`:
```typescript
const jobs = await db.select()
  .from(accountingSyncJobs)
  .where(and(
    eq(accountingSyncJobs.organizationId, organizationId),
    // other filters
  ));
```

---

## 8. Portal Architecture

### Organization Resolution for Portal Users

Portal users (customers) derive their organization context differently from staff users:

| User Type | Resolution Method |
|-----------|-------------------|
| **Staff** | `userOrganizations` table → user's default/selected org |
| **Portal** | `customers` table → customer's `organizationId` |

### Portal Context Middleware

```typescript
export const portalContext: RequestHandler = async (req, res, next) => {
  const user = req.user;
  
  // 1. Look up customer by userId (direct linkage)
  let customer = await db.select().from(customers)
    .where(eq(customers.userId, user.id)).limit(1);
  
  // 2. Fallback: Look up by email
  if (!customer.length && user.email) {
    customer = await db.select().from(customers)
      .where(eq(customers.email, user.email)).limit(1);
  }
  
  if (!customer.length) {
    return res.status(403).json({ 
      message: 'No customer account found',
      code: 'NO_CUSTOMER_ACCOUNT'
    });
  }
  
  req.organizationId = customer[0].organizationId;
  req.portalCustomerId = customer[0].id;
  req.portalCustomer = customer[0];
  next();
};
```

### Portal Route Handlers

Portal routes use `portalContext` and filter by both org and customer:

```typescript
app.get('/api/portal/my-quotes', isAuthenticated, portalContext, async (req, res) => {
  const portalCustomer = getPortalCustomer(req);
  const { organizationId, id: customerId } = portalCustomer;
  
  const quotes = await storage.getQuotesForCustomer(
    organizationId, 
    customerId, 
    { source: 'customer_quick_quote' }
  );
  res.json({ success: true, data: quotes });
});

app.get('/api/portal/my-orders', isAuthenticated, portalContext, async (req, res) => {
  const { organizationId, id: customerId } = getPortalCustomer(req);
  const orders = await storage.getAllOrders(organizationId, { customerId });
  res.json({ success: true, data: orders });
});

app.post('/api/portal/convert-quote/:id', isAuthenticated, portalContext, async (req, res) => {
  const { organizationId, id: customerId } = getPortalCustomer(req);
  
  // Verify quote belongs to this customer
  const quote = await storage.getQuoteById(organizationId, quoteId, userId);
  if (quote.customerId !== customerId) {
    return res.status(403).json({ error: 'Quote does not belong to this customer' });
  }
  
  // Proceed with conversion...
});
```

### Portal Access Constraints

| Constraint | Enforcement |
|------------|-------------|
| Portal user must have linked customer | `portalContext` middleware returns 403 |
| Quotes filtered to customer's source | `source: 'customer_quick_quote'` filter |
| Orders filtered to customer's ID | `customerId` filter in storage call |
| Quote conversion requires ownership | Explicit `customerId` verification |

---

## 9. Automation + Integration Layer Implications

### Current State

The following automation components require organization-aware updates:

| Component | Current State | Required Update |
|-----------|---------------|-----------------|
| **Email Parsing** | Not org-aware | Derive org from sender domain/customer |
| **PDF Auto-Namer** | Not org-aware | Include org prefix in file paths |
| **Routing Engine** | Not org-aware | Route to org-specific queues |
| **Thumbnail Generator** | Not org-aware | Store in org-specific paths |
| **n8n Workflows** | Not org-aware | Pass `organizationId` in webhook payloads |

### QuickBooks Integration

**Current Implementation:**
- OAuth connections stored with `organizationId`
- Sync jobs include `organizationId` column
- Routes filter jobs by organization

**TODOs:**
- Pass `organizationId` via OAuth state parameter in callback
- Update `queueSyncJobs()` to accept `organizationId`
- Update processor to scope data operations by org

### File Storage Implications

Future update required for tenant-isolated file storage:

```typescript
// Current (global paths)
const filePath = `uploads/${filename}`;

// Future (org-scoped paths)
const filePath = `tenants/${organizationId}/uploads/${filename}`;
```

---

## 10. Security Model

### Cross-Tenant Isolation Rules

| Rule | Enforcement |
|------|-------------|
| Data isolation | All queries filter by `organizationId` |
| API isolation | `tenantContext` middleware on all routes |
| Portal isolation | `portalContext` derives org from customer |
| File isolation | (Planned) Org-prefixed storage paths |

### Role-Based Organization Membership

| Role | Permissions |
|------|-------------|
| `owner` | Full org access, can manage members |
| `admin` | Full data access, limited member management |
| `member` | Standard access within org |

### Organization Switching

Staff users can switch organizations via:
1. `X-Organization-Id` header
2. UI org switcher (future)

**Validation:**
```typescript
if (headerOrgId) {
  const membership = await db.select().from(userOrganizations)
    .where(and(
      eq(userOrganizations.userId, user.id),
      eq(userOrganizations.organizationId, headerOrgId)
    ));
  
  if (!membership.length) {
    return res.status(403).json({ message: 'No access to this organization' });
  }
}
```

### Forbidden Cross-Org Access

| Action | Protection |
|--------|------------|
| View other org's data | Query filters prevent |
| Modify other org's data | WHERE clause includes orgId |
| Access other org's files | (Planned) Path-based isolation |
| Use other org's QB connection | Connection verified against org |

### Portal Safeguards

| Safeguard | Implementation |
|-----------|----------------|
| Customer linkage required | `portalContext` returns 403 if no customer |
| Org derived from customer | Cannot specify arbitrary org |
| Data scoped to customer | Additional `customerId` filter on queries |
| Quote ownership verification | Explicit check before operations |

---

## 11. Testing Plan

### Schema Integrity Checks
- [ ] Verify `organizations` table created with correct schema
- [ ] Verify `user_organizations` table with unique constraint
- [ ] Verify `organizationId` column exists on all tenant tables
- [ ] Verify foreign key references to `organizations`
- [ ] Verify per-org unique constraints created
- [ ] Verify composite indexes exist

### Backfill Verification
- [ ] All existing customers have `organizationId = 'org_titan_001'`
- [ ] All existing products have `organizationId`
- [ ] All existing orders, quotes, invoices backfilled
- [ ] All existing users have `user_organizations` membership
- [ ] No NULL `organizationId` values in tenant tables

### Org Isolation Correctness
- [ ] Create data in Org A, verify invisible from Org B
- [ ] Switch organizations via header, verify correct data
- [ ] Attempt cross-org access, verify 403 response
- [ ] Verify audit logs scoped to correct org

### Portal Isolation Tests
- [ ] Portal user sees only their quotes
- [ ] Portal user sees only their orders
- [ ] Portal user cannot access other customer's data
- [ ] Portal user with no customer gets 403
- [ ] Quote conversion verifies customer ownership

### Storage Scoping Tests
- [ ] `getCustomers()` returns only org's customers
- [ ] `createProduct()` injects correct `organizationId`
- [ ] `updateOrder()` fails if order belongs to different org
- [ ] `deleteVendor()` fails if vendor belongs to different org
- [ ] `getJobs()` correctly scopes via orders relationship

### Routing Tests
- [ ] All tenant routes require `tenantContext`
- [ ] Routes return 500 if org context missing
- [ ] Portal routes use `portalContext`
- [ ] QuickBooks routes filter by org

### QuickBooks Job Isolation Tests
- [ ] Sync jobs created with `organizationId`
- [ ] Job list filtered by current org
- [ ] Job detail returns 404 for other org's jobs
- [ ] Connection status verified against org

### Automation Pipeline Tests
- [ ] (Future) Email parsing derives correct org
- [ ] (Future) File storage uses org paths
- [ ] (Future) n8n webhooks include org context

---

## 12. Known Gaps / TODOs

### High Priority

| Gap | Description | Impact |
|-----|-------------|--------|
| OAuth state parameter | QB callback should receive orgId via state | Connection might save to wrong org |
| QuickBooks service scoping | Functions should accept orgId parameter | Sync operations may cross orgs |
| File storage paths | Files should be org-prefixed | File access not isolated |

### Medium Priority

| Gap | Description |
|-----|-------------|
| Automation job scoping | Email parser, PDF namer need org awareness |
| n8n workflow updates | Webhooks need to pass organizationId |
| Org switcher UI | Frontend component for switching orgs |
| Org settings page | UI for managing organization settings |
| Member management UI | UI for managing org members |

### Low Priority / Future

| Gap | Description |
|-----|-------------|
| Performance optimization | Add caching for org lookups |
| Org-level feature flags | Per-org feature toggles |
| Usage metering | Track per-org usage for SaaS billing |
| Org-level audit log viewer | UI filtered by current org |

---

## 13. Versioning and Deployment Notes

### Migration Order

Migrations must be applied in sequence:
1. `0020_multi_tenant_organizations.sql` - Creates core tables and backfills
2. `0021_per_org_unique_constraints.sql` - Converts constraints and adds indexes

### Non-Reversible Changes

| Change | Reversibility |
|--------|---------------|
| Adding `organizationId` columns | Reversible (drop column) |
| Dropping global unique constraints | **Non-reversible** (data may now have per-org duplicates) |
| Creating per-org constraints | Reversible (drop constraint) |
| Backfilling org IDs | Data remains, column drop loses association |

### Safe Backfill Requirements

1. **Before migration:**
   - Ensure default organization exists (migration creates it)
   - Backup database

2. **During migration:**
   - Migrations are idempotent (safe to re-run)
   - Backfill uses `WHERE organization_id IS NULL`

3. **After migration:**
   - Verify no NULL values: `SELECT COUNT(*) FROM {table} WHERE organization_id IS NULL`
   - Verify user memberships: `SELECT COUNT(*) FROM users u LEFT JOIN user_organizations uo ON u.id = uo.user_id WHERE uo.id IS NULL`

### Deployment Steps

1. **Backup database**
2. **Apply migration 0020** - Creates tables and backfills data
3. **Verify backfill** - Check for NULL organizationId values
4. **Apply migration 0021** - Converts constraints
5. **Deploy updated application code** - New middleware and routes
6. **Verify application** - Test tenant isolation
7. **Monitor logs** - Watch for "Missing organization context" errors

### Rollback Considerations

**If issues occur after 0020:**
- Application continues to work (new column is populated)
- Can drop column if needed (loses tenant association)

**If issues occur after 0021:**
- Per-org constraints are in place
- **Cannot restore global constraints** if duplicate data was created
- May need to dedupe data before restoring global constraints

---

## 14. Appendix

### A. Migration 0020 Key SQL

```sql
-- Create organizations table
CREATE TABLE IF NOT EXISTS organizations (
    id VARCHAR(255) PRIMARY KEY DEFAULT gen_random_uuid()::text,
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(100) UNIQUE NOT NULL,
    type VARCHAR(50) DEFAULT 'internal',
    status VARCHAR(50) DEFAULT 'active',
    settings JSONB DEFAULT '{}',
    billing JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create user_organizations table
CREATE TABLE IF NOT EXISTS user_organizations (
    id VARCHAR(255) PRIMARY KEY DEFAULT gen_random_uuid()::text,
    user_id VARCHAR(255) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    organization_id VARCHAR(255) NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    role VARCHAR(50) DEFAULT 'member',
    is_default BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, organization_id)
);

-- Seed default organization
INSERT INTO organizations (id, name, slug, type, status)
VALUES ('org_titan_001', 'Titan Graphics', 'titan', 'internal', 'active')
ON CONFLICT (id) DO NOTHING;

-- Add organizationId to tenant tables (example)
ALTER TABLE customers ADD COLUMN IF NOT EXISTS organization_id VARCHAR(255) 
    REFERENCES organizations(id) ON DELETE CASCADE;
UPDATE customers SET organization_id = 'org_titan_001' WHERE organization_id IS NULL;
```

### B. Migration 0021 Key SQL

```sql
-- Drop global unique constraint
ALTER TABLE products DROP CONSTRAINT IF EXISTS products_sku_key;

-- Add per-org unique constraint
ALTER TABLE products ADD CONSTRAINT products_org_sku_unique 
    UNIQUE (organization_id, sku);

-- Add performance index
CREATE INDEX IF NOT EXISTS idx_products_organization_id 
    ON products(organization_id);
```

### C. Tenant Context Type Extensions

```typescript
declare global {
  namespace Express {
    interface Request {
      organizationId?: string;
      organizationSlug?: string;
      portalCustomerId?: string;
      portalCustomer?: Customer;
    }
  }
}
```

### D. Storage Function Signature Examples

```typescript
// Interface
interface IStorage {
  // With organizationId as first parameter
  getCustomers(organizationId: string, filters?: CustomerFilters): Promise<Customer[]>;
  
  // Create with Omit pattern
  createCustomer(organizationId: string, data: Omit<InsertCustomer, 'organizationId'>): Promise<Customer>;
  
  // Audit log with Omit pattern
  createAuditLog(organizationId: string, log: Omit<InsertAuditLog, 'organizationId'>): Promise<AuditLog>;
}
```

### E. Files Added/Modified

**New Files:**
- `server/tenantContext.ts` - Tenant middleware and helpers
- `migrations/0020_multi_tenant_organizations.sql` - Core schema
- `migrations/0021_per_org_unique_constraints.sql` - Constraint updates
- `docs/MODULE_COMPLETION_MULTI_TENANT_ARCHITECTURE.md` - This document

**Modified Files:**
- `shared/schema.ts` - Added organizations, user_organizations tables; added organizationId to tenant tables
- `server/storage.ts` - All tenant functions accept organizationId as first parameter
- `server/routes.ts` - Added tenantContext/portalContext middleware to all tenant routes
- `server/quickbooksService.ts` - Organization-aware connection handling

---

*Document Version: 1.0*  
*Module Status: COMPLETE (Core Implementation)*  
*Last Updated: November 30, 2025*  
*Author: TitanOS Development Team*
