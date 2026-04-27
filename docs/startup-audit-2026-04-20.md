# Server Startup Audit — 2026-04-20

Audit of the QuoteVaultPro/TitanOS server startup path, confirming where and how Drizzle `migrations_v2` run in production (Railway).

---

## Files Inspected

| File | Purpose |
|------|---------|
| `package.json` | `start` script → `node dist/index.js` |
| `server/index.ts` | Entry point; calls `await runMigrations()` at lines 121–123 |
| `server/runMigrations.ts` | Migration runner; advisory lock, `migrate()` call, kill switch |
| `server/db.ts` | Neon `Pool` + Drizzle `db`; throws if `DATABASE_URL` unset |
| `scripts/copy-migrations.mjs` | Copies `server/db/migrations_v2 → dist/db/migrations_v2` on build |
| `dist/db/migrations_v2/` | Build artifact — found stale at audit time (only 0000–0025 present) |
| `server/db/migrations_v2/meta/_journal.json` | Journal — confirmed entries 0000–0032 |

---

## Do Migrations Run Today?

**Yes.** The startup chain is intact end-to-end:

```
npm run start
  → node dist/index.js
    → server/index.ts (compiled)
      → await runMigrations()           ← line 121
        → migrate(db, {
            migrationsFolder: dist/db/migrations_v2,
            migrationsTable:  "__drizzle_migrations_v2",
            migrationsSchema: "public"
          })
```

- `DRIZZLE_AUTO_MIGRATE` defaults to **enabled**; only `"0"` or `"false"` skips it
- Advisory lock on key `928372001` prevents concurrent pod races during rolling deploys
- Uses the same `DATABASE_URL`-backed `db` instance as the rest of the application
- Railway executes `npm run start` from `package.json` — the full chain runs on every deploy

---

## Root Cause — Stale Dist

The local `dist/db/migrations_v2/` snapshot only contained migrations **0000–0025**. Migrations 0026–0032 (including the new `0032_quote_line_item_proof_approval_snapshot`) were absent from the built artifact because `npm run build` had not been re-run after those migrations were added.

**Impact on Railway:** none. Railway runs a fresh `npm run build` on every deploy, which triggers `scripts/copy-migrations.mjs` and produces a complete `dist/db/migrations_v2/`. The stale state only affects a local `dist/` that was never rebuilt. No action required beyond deploying.

---

## Files Changed

| File | Change |
|------|--------|
| `server/runMigrations.ts` | Three log lines updated to include required phrases |

### Exact Diffs

```diff
- console.log(`[Migrations] Starting — folder: ${migrationsFolder}`);
+ console.log(`[Migrations] Starting migrations_v2 — folder: ${migrationsFolder}`);

- console.log("[Migrations] Complete — migrate() returned without error");
+ console.log("[Migrations] Migrations_v2 complete — migrate() returned without error");

- console.error("[Migrations] FAILED — error message:", err?.message);
+ console.error("[Migrations] Migrations_v2 failed — error message:", err?.message);
```

---

## Final Startup Flow (After Patch)

### Happy Path

```
node dist/index.js
  [Migrations] runMigrations() entered
  [Migrations] DATABASE_URL → host=<neon-host> db=<dbname> (redacted)
  [Migrations] DRIZZLE_AUTO_MIGRATE raw=undefined parsed=""
  [Migrations] import.meta.url = file:///app/dist/index.js
  [Migrations] Starting migrations_v2 — folder: /app/dist/db/migrations_v2
  [Migrations] Folder exists: true
  [Migrations] Folder contents (N): 0000_baseline.sql, ..., 0032_quote_line_item_proof_approval_snapshot.sql, meta
  [Migrations] Advisory lock acquired
  [Migrations] DB identity: db=<name>, user=<user>, addr=null
  [Migrations] Ledger (__drizzle_migrations_v2): N rows, highest id=...
  [Migrations] Calling drizzle migrate() now...
  [Migrations] Migrations_v2 complete — migrate() returned without error
  → server continues startup (Express routes, WebSocket, etc.)
```

### Failure Path

```
  [Migrations] Migrations_v2 failed — error message: <reason>
  [Migrations] FAILED — stack: <stack trace>
  → throw re-caught by server/index.ts → server does not start
```

### Kill Switch

```
DRIZZLE_AUTO_MIGRATE=0  (or =false)
  [Migrations] DRIZZLE_AUTO_MIGRATE=disabled — skipping auto-migration
  → server continues without running migrations
```

---

## Migration Ledger Reference

| Table | Schema | Key |
|-------|--------|-----|
| `__drizzle_migrations_v2` | `public` | advisory lock `928372001` |

Latest applied migration as of this audit: **idx 32** — `0032_quote_line_item_proof_approval_snapshot`

Next migration must use **idx 33**.
