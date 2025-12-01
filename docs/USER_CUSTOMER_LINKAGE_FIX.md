# User-Customer Linkage Fix - Implementation Summary

## Problem
- Customer quick quotes were created without `customerId`, causing conversion to orders to fail
- No direct linkage between `users` table and `customers` table
- Users logging in as customers couldn't automatically access their customer record

## Solution Implemented

### Phase A: Database Schema Changes

**Migration Created**: `server/db/migrations/0009_add_customer_user_link.sql`
- Adds `user_id` column to `customers` table
- Creates foreign key reference: `customers.user_id → users.id`
- Creates indexes for efficient lookups
- Safe for existing data (nullable column)

**Schema Updated**: `shared/schema.ts`
- Added `userId` field to `customers` table definition
- Added indexes for `userId` and `email` lookups

### Phase B: User-Customer Sync Utility

**Created**: `server/db/syncUsersToCustomers.ts`
- `syncUsersToCustomers()`: Batch sync all users to customers
  - Links existing customers by `userId` (if already set)
  - Matches customers by email (case-insensitive)
  - Creates new customer records for users without one
  - Returns statistics (linked, created, skipped, errors)

- `ensureCustomerForUser(userId)`: On-demand customer lookup/creation
  - Used during quote creation to guarantee `customerId`
  - Tries to link existing customer first
  - Creates new customer if none exists
  - Returns `customerId` for use in quotes/orders

**CLI Script**: `sync-users-customers.ts`
- Standalone script to run sync manually
- Usage: `npm run db:sync-users`

**Auto-Sync**: Added to `server/index.ts`
- Runs automatically on server startup in development mode
- Ensures customer records are always in sync during dev

### Phase C: Quote Creation Fix

**Updated**: `server/routes.ts` - `POST /api/quotes`
- For `customer_quick_quote` source:
  - Calls `ensureCustomerForUser(userId)` to get/create customerId
  - Always sets `customerId` on the quote
  - Prevents orphaned quotes without customers

- For `internal` source:
  - Requires `customerId` to be provided explicitly
  - Returns error if missing

### Phase D: Quote-to-Order Conversion Fix

**Updated**: `server/routes.ts` - `POST /api/orders/from-quote/:quoteId`
- For `customer_quick_quote`:
  - First checks if quote already has `customerId` (new behavior)
  - Falls back to `ensureCustomerForUser()` for legacy quotes
  - No longer queries by email directly

- For `internal`:
  - Uses `customerId` from quote or provided value
  - Clear error message if missing

### Phase E: Diagnostics

**Added**: `GET /api/debug/user-customer-linkage` (dev only)
- Shows all users and their customer linkage status
- Shows sample quotes with their customer assignments
- Helps verify sync worked correctly

## Commands to Run

### 1. Apply Database Migration
```bash
npm run db:push
```
This applies the new `user_id` column to the customers table.

### 2. Run User-Customer Sync
```bash
npm run db:sync-users
```
This links all existing users to their customer records (or creates them).

### 3. Start Development Server
```bash
npm run dev
```
The sync will run automatically on startup in development mode.

### 4. Check Linkage Status (Optional)
Visit in browser while dev server is running:
```
http://localhost:5000/api/debug/user-customer-linkage
```

## Expected Behavior After Fix

### Scenario A: Customer Quick Quote
1. Customer logs in (e.g., test@local.dev)
2. Uses calculator to create quote
3. Quote is saved with:
   - `source`: "customer_quick_quote"
   - `userId`: user's ID
   - `customerId`: **automatically set** via `ensureCustomerForUser()`
4. Customer clicks "Convert to Order" from `/my-quotes`
5. Order is created successfully ✓

### Scenario B: Internal Quote
1. Staff member logs in
2. Creates quote for a customer
3. Selects customer from dropdown
4. Quote is saved with:
   - `source`: "internal"
   - `userId`: staff member's ID
   - `customerId`: selected customer ID
5. Staff converts quote to order
6. Order is created successfully ✓

### Scenario C: Legacy Quote (Pre-Fix)
1. Old quote exists with `customerId`: null
2. Staff tries to convert to order
3. System calls `ensureCustomerForUser()` for the quote's `userId`
4. Customer is found/created
5. Order is created with the ensured `customerId` ✓

## Files Changed

### New Files
- `server/db/migrations/0009_add_customer_user_link.sql`
- `server/db/syncUsersToCustomers.ts`
- `sync-users-customers.ts`

### Modified Files
- `shared/schema.ts` - Added `userId` to customers table
- `server/index.ts` - Added auto-sync on startup
- `server/routes.ts` - Updated quote creation and order conversion logic
- `package.json` - Added `db:sync-users` script

## Testing Checklist

- [ ] Migration applied successfully (`npm run db:push`)
- [ ] Sync completed without errors (`npm run db:sync-users`)
- [ ] All users have linked customers (check `/api/debug/user-customer-linkage`)
- [ ] New customer quick quote has `customerId` set
- [ ] Customer can convert their quick quote to order
- [ ] Staff can create internal quote and convert to order
- [ ] Legacy quotes can still be converted (with auto-linking)

## Notes

- The `user_id` column on customers is nullable to support:
  - Customers created by staff before user accounts exist
  - B2B customers with multiple user logins (future feature)
  
- The sync is idempotent - safe to run multiple times
  
- In production, run the sync manually after migration:
  ```bash
  npm run db:sync-users
  ```

## Rollback (If Needed)

If issues arise, the migration can be rolled back:
```sql
ALTER TABLE customers DROP COLUMN IF EXISTS user_id;
DROP INDEX IF EXISTS customers_user_id_idx;
DROP INDEX IF EXISTS customers_email_idx;
```

Then revert the code changes in routes.ts and schema.ts.
