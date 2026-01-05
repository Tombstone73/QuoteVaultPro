# Tenant Column Standardization - Migration 0014

## Executive Summary
Successfully standardized tenant column naming across QuoteVaultPro. All 39 tenant-owned tables now use `organization_id` consistently. Zero legacy `org_id` columns remain in production code.

## Status: ✅ PHASE 1 COMPLETE

### Pre-Migration State
- ✅ 35 tables with `organization_id`
- ✅ 0 tables with legacy `org_id` 
- ❓ 27 child tables without direct org column

### Post-Migration State (0014)
- ✅ **39 tables with `organization_id`** (+4 from migration)
- ✅ 0 tables with legacy `org_id`
- ✅ 0 tables in transition
- 👶 23 pure child tables (correct - derive via parent FK)
- ❓ 6 system tables (migrations, sessions, users, organizations)

## Changes Made

### Migration 0014: Standardize organization_id

**Tables Updated:**
1. ✅ `jobs` - Added `organization_id`, backfilled from `orders`, indexed
2. ✅ `job_files` - Added `organization_id` + `order_id` FK, backfilled from `jobs`, indexed
3. ✅ `job_notes` - Added `organization_id`, backfilled from `jobs`, indexed
4. ✅ `job_status_log` - Added `organization_id`, backfilled from `jobs`, indexed

**Indexes Created:**
- `idx_jobs_organization_id` on `jobs(organization_id, created_at DESC)`
- `idx_job_files_organization_id` on `job_files(organization_id, created_at DESC)`
- `idx_job_notes_organization_id` on `job_notes(organization_id, created_at DESC)`
- `idx_job_status_log_organization_id` on `job_status_log(organization_id, created_at DESC)`

**Backfill Results:**
- All 4 tables: 0 NULL organization_id records (100% backfill success)

### Files Created/Modified

#### Created Files:
1. `server/scripts/auditTenantColumns.ts` - Automated audit tool for tenant column inventory
2. `server/db/migrations/0014_standardize_organization_id.sql` - Additive migration (no drops)
3. `apply-migration-0014.ts` - Migration runner with verification

#### Migration Applied:
- ✅ Executed successfully
- ✅ All backfills completed (0 nulls remaining)
- ✅ Indexes created
- ✅ Foreign keys added (job_files → orders)

## Architectural Decisions

### Tables with `organization_id` (Direct Filtering)
**When to add:** Table is queried independently OR performance-critical

Examples:
- `jobs`, `job_files`, `job_notes`, `job_status_log` - Can be queried without joining parent
- `orders`, `quotes`, `invoices` - Top-level tenant-owned resources
- `materials`, `products`, `customers` - Master data

### Pure Child Tables (No `organization_id`)
**When to skip:** Always accessed via parent, never queried independently

Examples:
- `order_line_items` - Always loaded with parent order
- `quote_line_items` - Always loaded with parent quote
- `invoice_line_items` - Always loaded with parent invoice
- `customer_contacts` - Always loaded with parent customer

**Rule:** Child tables filter via parent FK, e.g.:
```sql
SELECT * FROM order_line_items oli
JOIN orders o ON oli.order_id = o.id
WHERE o.organization_id = 'org_titan_001';
```

### System Tables (No `organization_id`)
- `organizations` - Top-level (no parent)
- `users` - Global, linked via `user_organizations` junction
- `sessions` - Global session storage
- `__drizzle_migrations` - System metadata

## Phase 2 (Code Updates) - IN PROGRESS

### Required Schema Updates
File: `shared/schema.ts`

**Jobs Schema** - Add organizationId column:
```typescript
export const jobs = pgTable("jobs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id), // ← ADD
  orderId: varchar("order_id").notNull().references(() => orders.id),
  // ... existing fields
});
```

**Job Files Schema** - Add organizationId + orderId:
```typescript
export const jobFiles = pgTable("job_files", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id), // ← ADD
  orderId: varchar("order_id").references(() => orders.id), // ← ADD
  jobId: varchar("job_id").references(() => jobs.id),
  // ... existing fields
});
```

**Job Notes Schema** - Add organizationId:
```typescript
export const jobNotes = pgTable("job_notes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id), // ← ADD
  jobId: varchar("job_id").references(() => jobs.id),
  // ... existing fields
});
```

**Job Status Log Schema** - Add organizationId:
```typescript
export const jobStatusLog = pgTable("job_status_log", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id), // ← ADD
  jobId: varchar("job_id").references(() => jobs.id),
  // ... existing fields
});
```

### Repository Updates Required

**Pattern:** Add `organizationId` filter to all SELECT queries

**Example (jobs repository):**
```typescript
// BEFORE
const jobs = await db.select().from(jobsTable).where(eq(jobsTable.orderId, orderId));

// AFTER
const jobs = await db.select().from(jobsTable)
  .where(and(
    eq(jobsTable.organizationId, organizationId),
    eq(jobsTable.orderId, orderId)
  ));
```

**Files Needing Updates:**
- Search codebase for `from(jobs)`, `from(jobFiles)`, `from(jobNotes)`, `from(jobStatusLog)`
- Add `.where(eq(*.organizationId, organizationId))` to all SELECT queries
- Ensure INSERT operations include `organizationId` in the data object

## Testing Checklist

### Pre-Deployment Verification
- [x] Migration 0014 applied successfully
- [x] Audit script shows 39 tables with organization_id
- [ ] Schema updates in `shared/schema.ts` completed
- [ ] Repository queries updated to filter by organizationId
- [ ] `npm run check` passes (TypeScript)
- [ ] `npm run dev` starts without errors
- [ ] Manual smoke test: Create job, verify organizationId present

### Multi-Tenant Isolation Test
```sql
-- Create test data in two orgs
INSERT INTO organizations (id, name, slug) VALUES 
  ('test_org_a', 'Test Org A', 'test-a'),
  ('test_org_b', 'Test Org B', 'test-b');

-- Create orders in each org
-- Create jobs in each org
-- Query jobs for org A, verify org B records NOT returned
```

### Performance Test
```sql
-- Verify indexes are used
EXPLAIN ANALYZE 
SELECT * FROM jobs 
WHERE organization_id = 'org_titan_001' 
ORDER BY created_at DESC 
LIMIT 50;
-- Should show "Index Scan using idx_jobs_organization_id"
```

## Rollback Plan

If issues arise, migration is additive and safe to leave in place. To revert:

```sql
-- Remove indexes (optional)
DROP INDEX IF EXISTS idx_jobs_organization_id;
DROP INDEX IF EXISTS idx_job_files_organization_id;
DROP INDEX IF EXISTS idx_job_notes_organization_id;
DROP INDEX IF EXISTS idx_job_status_log_organization_id;

-- Remove columns (only if needed)
ALTER TABLE jobs DROP COLUMN IF EXISTS organization_id;
ALTER TABLE job_files DROP COLUMN IF EXISTS organization_id;
ALTER TABLE job_files DROP COLUMN IF EXISTS order_id;
ALTER TABLE job_notes DROP COLUMN IF EXISTS organization_id;
ALTER TABLE job_status_log DROP COLUMN IF EXISTS organization_id;
```

Code rollback: Revert schema.ts changes.

## Performance Impact

### Positive:
- ✅ Direct tenant filtering (no joins to orders for jobs queries)
- ✅ Indexes optimize `WHERE organization_id = ?` queries
- ✅ Faster tenant isolation checks

### Negligible:
- 4 new VARCHAR columns (minimal storage)
- 4 new indexes (well-scoped, low cardinality on orgId)

## Success Metrics

### Achieved:
1. ✅ Zero `org_id` columns in production schema
2. ✅ 39 tenant-owned tables have `organization_id`
3. ✅ All job-related tables can filter by organizationId directly
4. ✅ 100% backfill success (0 NULL records)
5. ✅ Indexes created for performant tenant queries

### Pending (Phase 2):
6. ⏳ Schema updated in TypeScript
7. ⏳ Repository queries updated
8. ⏳ Smoke tests passing
9. ⏳ Production deployment

## Next Steps

1. **Update Schemas** - Edit `shared/schema.ts` to add organizationId columns to jobs/jobFiles/jobNotes/jobStatusLog
2. **Update Repositories** - Add organizationId filtering to all SELECT queries for these tables
3. **Test TypeScript** - Run `npm run check` to verify no type errors
4. **Smoke Test** - Create job via UI, verify organizationId populated correctly
5. **Deploy** - Push to production
6. **Monitor** - Check logs for any tenant isolation issues
7. **Phase 3 (Optional)** - Add NOT NULL constraints after validation period

## Conclusion

✅ **Phase 1 COMPLETE:** Database schema standardized, all tenant-owned tables have `organization_id`.

⏳ **Phase 2 IN PROGRESS:** Code updates needed in `shared/schema.ts` and repositories.

The migration is **production-safe** (additive only, no drops), **reversible** (columns can be dropped if needed), and **performant** (indexed, backfilled).

**No production regressions expected** - legacy code continues working, new columns are additive. Once schema/repo updates complete, QuoteVaultPro will have consistent, predictable tenant scoping across all tables.
