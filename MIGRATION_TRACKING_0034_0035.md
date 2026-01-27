# Drizzle Migration Tracking Registration

This document contains SQL snippets to register migrations 0034 and 0035 in the `__drizzle_migrations` table after manually applying the SQL files in Neon.

## Table Structure

Based on existing migrations in the codebase, the `__drizzle_migrations` table has the following structure:

```sql
__drizzle_migrations (
  id INTEGER PRIMARY KEY,
  hash TEXT NOT NULL,
  created_at BIGINT NOT NULL
)
```

## Registration SQL

Run these statements **AFTER** successfully applying the migration SQL files in Neon:

```sql
-- Register migration 0034: auth_identities table
INSERT INTO public.__drizzle_migrations (id, hash, created_at)
VALUES (34, '0034_auth_identities', EXTRACT(EPOCH FROM NOW()) * 1000)
ON CONFLICT (id) DO NOTHING;

-- Register migration 0035: password_reset_tokens table
INSERT INTO public.__drizzle_migrations (id, hash, created_at)
VALUES (35, '0035_password_reset_tokens', EXTRACT(EPOCH FROM NOW()) * 1000)
ON CONFLICT (id) DO NOTHING;
```

## Verification

After registration, verify both migrations are tracked:

```sql
SELECT id, hash, to_timestamp(created_at / 1000) AS applied_at
FROM public.__drizzle_migrations
WHERE id IN (34, 35)
ORDER BY id;
```

Expected output:
```
 id |          hash           |       applied_at        
----+-------------------------+-------------------------
 34 | 0034_auth_identities    | 2026-01-27 HH:MM:SS+00
 35 | 0035_password_reset_tokens | 2026-01-27 HH:MM:SS+00
```

## Migration Application Workflow

1. **Apply migration SQL in Neon console:**
   - Copy contents of `server/db/migrations/0034_auth_identities.sql`
   - Execute in Neon SQL Editor
   - Verify table `auth_identities` exists

2. **Register in Drizzle tracking:**
   - Run the `INSERT INTO __drizzle_migrations` statement for 0034
   - Verify with SELECT query

3. **Repeat for migration 0035:**
   - Apply `server/db/migrations/0035_password_reset_tokens.sql`
   - Register with INSERT statement
   - Verify both tables exist: `auth_identities`, `password_reset_tokens`

4. **Update local Drizzle journal** (if needed):
   - Run `npm run db:pull` to sync schema locally
   - Or manually update `server/db/migrations/meta/_journal.json` if using `db:push`

## Notes

- The `created_at` value uses milliseconds since epoch (JavaScript `Date.now()` format)
- The `ON CONFLICT (id) DO NOTHING` ensures idempotency if re-run
- These statements do NOT apply the actual schema changes - they only register that the migrations were applied
- Always apply the migration SQL first, then register in tracking table
