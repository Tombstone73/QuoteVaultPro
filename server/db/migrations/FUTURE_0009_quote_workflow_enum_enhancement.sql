-- ============================================================================
-- FUTURE SCHEMA MIGRATION: Quote Workflow Enhancement
-- ============================================================================
-- 
-- STATUS: PENDING APPROVAL - DO NOT RUN WITHOUT EXPLICIT AUTHORIZATION
-- 
-- PURPOSE:
-- Align database enum values with enterprise workflow semantics
-- Current: ['draft', 'pending', 'active', 'canceled']
-- Target:  ['draft', 'sent', 'approved', 'rejected', 'expired']
--
-- IMPACT:
-- - Modifies quote_status enum type
-- - Updates existing quote records to use new semantic values
-- - Requires application downtime for safe migration
-- - All code already supports new values via shared/quoteWorkflow.ts mapping
--
-- PREREQUISITES:
-- 1. Review and approval from technical lead
-- 2. Backup database before running
-- 3. Schedule maintenance window (application downtime required)
-- 4. Test migration on staging environment first
--
-- ROLLBACK PLAN:
-- See section at bottom of this file
-- ============================================================================

-- COMMENTED OUT - DO NOT UNCOMMENT WITHOUT APPROVAL

/*

-- Step 1: Create new enum type with desired values
CREATE TYPE quote_status_new AS ENUM ('draft', 'sent', 'approved', 'rejected', 'expired');

-- Step 2: Add temporary column with new type
ALTER TABLE quotes ADD COLUMN status_new quote_status_new;

-- Step 3: Migrate existing data with semantic mapping
-- 'draft' → 'draft' (unchanged)
-- 'pending' → 'sent' (semantic mapping)
-- 'active' → 'approved' (semantic mapping)
-- 'canceled' → 'rejected' (semantic mapping)
UPDATE quotes
SET status_new = CASE
  WHEN status = 'draft' THEN 'draft'::quote_status_new
  WHEN status = 'pending' THEN 'sent'::quote_status_new
  WHEN status = 'active' THEN 'approved'::quote_status_new
  WHEN status = 'canceled' THEN 'rejected'::quote_status_new
  ELSE 'draft'::quote_status_new
END;

-- Step 4: Drop old column and constraints
ALTER TABLE quotes DROP COLUMN status;

-- Step 5: Rename new column to original name
ALTER TABLE quotes RENAME COLUMN status_new TO status;

-- Step 6: Add NOT NULL constraint and default
ALTER TABLE quotes ALTER COLUMN status SET NOT NULL;
ALTER TABLE quotes ALTER COLUMN status SET DEFAULT 'draft';

-- Step 7: Drop old enum type
DROP TYPE quote_status;

-- Step 8: Rename new enum type to original name
ALTER TYPE quote_status_new RENAME TO quote_status;

-- Step 9: Recreate indexes if needed
-- (check existing indexes on quotes.status and recreate)

-- Step 10: Update statistics
ANALYZE quotes;

*/

-- ============================================================================
-- VALIDATION QUERIES (safe to run anytime)
-- ============================================================================

-- Check current enum values
SELECT typname, enumlabel, enumsortorder
FROM pg_type t
JOIN pg_enum e ON t.oid = e.enumtypid
WHERE typname = 'quote_status'
ORDER BY enumsortorder;

-- Count quotes by current status
SELECT status, COUNT(*) as count
FROM quotes
GROUP BY status
ORDER BY count DESC;

-- Identify quotes that would be affected by migration
SELECT 
  status,
  COUNT(*) as count,
  CASE
    WHEN status = 'draft' THEN 'draft (no change)'
    WHEN status = 'pending' THEN 'sent (semantic rename)'
    WHEN status = 'active' THEN 'approved (semantic rename)'
    WHEN status = 'canceled' THEN 'rejected (semantic rename)'
    ELSE 'unknown'
  END as migration_target
FROM quotes
GROUP BY status
ORDER BY count DESC;

-- ============================================================================
-- ROLLBACK PLAN (if migration fails mid-execution)
-- ============================================================================

/*

-- If migration fails after creating new column but before dropping old:
ALTER TABLE quotes DROP COLUMN IF EXISTS status_new;
DROP TYPE IF EXISTS quote_status_new;

-- If migration completes but needs to be reversed:
-- 1. Take database backup BEFORE rollback
-- 2. Reverse the migration steps in opposite order
-- 3. Map values back: sent→pending, approved→active, rejected→canceled

CREATE TYPE quote_status_old AS ENUM ('draft', 'pending', 'active', 'canceled');
ALTER TABLE quotes ADD COLUMN status_old quote_status_old;

UPDATE quotes
SET status_old = CASE
  WHEN status = 'draft' THEN 'draft'::quote_status_old
  WHEN status = 'sent' THEN 'pending'::quote_status_old
  WHEN status = 'approved' THEN 'active'::quote_status_old
  WHEN status = 'rejected' THEN 'canceled'::quote_status_old
  WHEN status = 'expired' THEN 'canceled'::quote_status_old
  ELSE 'draft'::quote_status_old
END;

ALTER TABLE quotes DROP COLUMN status;
ALTER TABLE quotes RENAME COLUMN status_old TO status;
ALTER TABLE quotes ALTER COLUMN status SET NOT NULL;
ALTER TABLE quotes ALTER COLUMN status SET DEFAULT 'active';
DROP TYPE quote_status;
ALTER TYPE quote_status_old RENAME TO quote_status;
ANALYZE quotes;

*/

-- ============================================================================
-- POST-MIGRATION VERIFICATION
-- ============================================================================

/*

-- After migration completes, run these checks:

-- 1. Verify enum values
SELECT enumlabel FROM pg_enum e
JOIN pg_type t ON e.enumtypid = t.oid
WHERE t.typname = 'quote_status'
ORDER BY e.enumsortorder;
-- Expected: draft, sent, approved, rejected, expired

-- 2. Verify no NULL statuses
SELECT COUNT(*) as null_status_count
FROM quotes
WHERE status IS NULL;
-- Expected: 0

-- 3. Verify distribution makes sense
SELECT status, COUNT(*) as count
FROM quotes
GROUP BY status
ORDER BY count DESC;
-- Should see similar distribution to pre-migration with new names

-- 4. Test application can read quotes
-- Run application with migration applied and verify quote list loads

-- 5. Test status transitions via API
-- POST /api/quotes/:id/transition with various state changes

*/

-- ============================================================================
-- NOTES FOR FUTURE MAINTAINERS
-- ============================================================================

-- This migration aligns the database schema with the enterprise workflow model
-- defined in shared/quoteWorkflow.ts. The application already handles this
-- mapping transparently, so this migration is purely for data consistency.
--
-- The 'expired' status is handled as a derived state (not stored in DB) by
-- checking the validUntil date. If a future requirement needs to persist
-- expired status, additional logic will be needed to backfill existing quotes.
--
-- The 'converted' status is also derived from the presence of an order linked
-- to the quote (via orders.quoteId or quotes.convertedToOrderId).
--
-- Migration complexity: MEDIUM
-- Estimated downtime: 2-5 minutes (depends on quote table size)
-- Risk level: LOW (semantic rename only, application already supports both)
