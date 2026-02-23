-- Migration 0049 Journal Registration Script
-- This script registers migration 0049 in the Drizzle migration journal
-- Safe to run multiple times (idempotent)

BEGIN;

-- Step 1: Discover which Drizzle journal tables exist
DO $$
DECLARE
    journal_table_drizzle BOOLEAN;
    journal_table_public BOOLEAN;
    row_exists BOOLEAN;
    next_id INTEGER;
    migration_name TEXT := '0049_add_bug_report_screenshots';
    migration_hash TEXT := '';  -- Drizzle uses empty hash for manual migrations
    migration_idx INTEGER := 41;
    migration_when BIGINT := 1739318963485;  -- Timestamp from journal.json
BEGIN
    -- Check if drizzle.__drizzle_migrations exists
    SELECT EXISTS (
        SELECT 1 FROM information_schema.tables 
        WHERE table_schema = 'drizzle' 
        AND table_name = '__drizzle_migrations'
    ) INTO journal_table_drizzle;

    -- Check if public.__drizzle_migrations exists
    SELECT EXISTS (
        SELECT 1 FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = '__drizzle_migrations'
    ) INTO journal_table_public;

    RAISE NOTICE 'Journal tables found: drizzle.__ = %, public.__ = %', 
        journal_table_drizzle, journal_table_public;

    -- Process drizzle.__drizzle_migrations if it exists
    IF journal_table_drizzle THEN
        RAISE NOTICE 'Processing drizzle.__drizzle_migrations...';
        
        -- Check if migration already exists
        SELECT EXISTS (
            SELECT 1 FROM drizzle.__drizzle_migrations 
            WHERE hash = migration_name OR hash LIKE '0049_%'
        ) INTO row_exists;

        IF row_exists THEN
            RAISE NOTICE 'Migration 0049 already exists in drizzle.__drizzle_migrations, updating...';
            UPDATE drizzle.__drizzle_migrations
            SET hash = migration_name,
                created_at = migration_when
            WHERE hash LIKE '0049_%';
        ELSE
            RAISE NOTICE 'Inserting migration 0049 into drizzle.__drizzle_migrations...';
            
            -- Get next ID
            SELECT COALESCE(MAX(id), 0) + 1 INTO next_id 
            FROM drizzle.__drizzle_migrations;
            
            INSERT INTO drizzle.__drizzle_migrations (id, hash, created_at)
            VALUES (next_id, migration_name, migration_when);
        END IF;
    END IF;

    -- Process public.__drizzle_migrations if it exists
    IF journal_table_public THEN
        RAISE NOTICE 'Processing public.__drizzle_migrations...';
        
        -- Check if migration already exists
        SELECT EXISTS (
            SELECT 1 FROM public.__drizzle_migrations 
            WHERE hash = migration_name OR hash LIKE '0049_%'
        ) INTO row_exists;

        IF row_exists THEN
            RAISE NOTICE 'Migration 0049 already exists in public.__drizzle_migrations, updating...';
            UPDATE public.__drizzle_migrations
            SET hash = migration_name,
                created_at = migration_when
            WHERE hash LIKE '0049_%';
        ELSE
            RAISE NOTICE 'Inserting migration 0049 into public.__drizzle_migrations...';
            
            -- Get next ID
            SELECT COALESCE(MAX(id), 0) + 1 INTO next_id 
            FROM public.__drizzle_migrations;
            
            INSERT INTO public.__drizzle_migrations (id, hash, created_at)
            VALUES (next_id, migration_name, migration_when);
        END IF;
    END IF;

    IF NOT journal_table_drizzle AND NOT journal_table_public THEN
        RAISE EXCEPTION 'No Drizzle migration journal tables found!';
    END IF;
END $$;

-- Step 2: Verify the results
DO $$
DECLARE
    journal_table_drizzle BOOLEAN;
    journal_table_public BOOLEAN;
BEGIN
    SELECT EXISTS (
        SELECT 1 FROM information_schema.tables 
        WHERE table_schema = 'drizzle' AND table_name = '__drizzle_migrations'
    ) INTO journal_table_drizzle;

    SELECT EXISTS (
        SELECT 1 FROM information_schema.tables 
        WHERE table_schema = 'public' AND table_name = '__drizzle_migrations'
    ) INTO journal_table_public;

    RAISE NOTICE '=== VERIFICATION RESULTS ===';

    IF journal_table_drizzle THEN
        RAISE NOTICE 'drizzle.__drizzle_migrations - Last 5 migrations:';
        PERFORM * FROM (
            SELECT id, hash, created_at 
            FROM drizzle.__drizzle_migrations 
            ORDER BY id DESC LIMIT 5
        ) AS recent;
    END IF;

    IF journal_table_public THEN
        RAISE NOTICE 'public.__drizzle_migrations - Last 5 migrations:';
        PERFORM * FROM (
            SELECT id, hash, created_at 
            FROM public.__drizzle_migrations 
            ORDER BY id DESC LIMIT 5
        ) AS recent;
    END IF;
END $$;

-- Show migration 0049 specifically from each table
SELECT 'drizzle.__drizzle_migrations' as source, id, hash, created_at
FROM drizzle.__drizzle_migrations
WHERE hash LIKE '0049_%'
UNION ALL
SELECT 'public.__drizzle_migrations' as source, id, hash, created_at
FROM public.__drizzle_migrations
WHERE hash LIKE '0049_%';

COMMIT;

-- Final confirmation
SELECT 'Migration 0049 registration complete!' as status;
