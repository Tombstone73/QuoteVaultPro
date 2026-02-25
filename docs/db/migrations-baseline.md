# Canonical Drizzle Migration Lineage (v2)

This repository now treats **v2** as the canonical Drizzle migration lineage.

- Canonical folder: `server/db/migrations_v2`
- Canonical ledger table: `public.__drizzle_migrations_v2`
- Baseline tag: `0000_baseline`

Legacy migrations and legacy ledgers are retained for audit/forensics and are not replayed.

## Why this exists

Previous history had mixed migration bookkeeping across environments. v2 provides a clean, deterministic lineage **without changing runtime schema**.

## One-time baseline initialization (staging/prod)

Run once per database, before using `db:migrate` with v2:

1. Deploy code containing:
   - `drizzle.config.ts` pointing to `server/db/migrations_v2`
   - `__drizzle_migrations_v2` ledger config
2. Run:

```bash
npm run db:migrations:v2:init-baseline
```

What it does (idempotent):
- Takes advisory lock
- Creates `public.__drizzle_migrations_v2` if missing
- Adds unique index on `hash`
- Inserts `0000_baseline` with `ON CONFLICT DO NOTHING`

## Normal migration flow after baseline

For new schema changes going forward:

1. Generate/author next migration in `server/db/migrations_v2` (e.g. `0001_*.sql`)
2. Deploy code
3. Run:

```bash
npm run db:migrate
```

## Build artifact behavior

Build now copies:

- `server/db/migrations_v2` → `dist/db/migrations`

This keeps runtime path stable while using v2 lineage content.

## Verification checklist

- `npm run db:status` points at `server/db/migrations_v2`
- `db:status` can read `public.__drizzle_migrations_v2`
- Ledger contains at least `0000_baseline`
- New migrations apply against v2 ledger only

## Rollback plan

If rollout must be reverted:

1. Revert `drizzle.config.ts` to old migrations folder/table settings.
2. Revert helper scripts (`db:status`, `db:migrate:verbose`, copy script) to old lineage.
3. Redeploy application.

Notes:
- Leaving `public.__drizzle_migrations_v2` in DB is safe; it is bookkeeping-only.
- Do **not** drop legacy ledgers during rollback.

## Guardrails

- Do not edit or replay legacy migration history for v2 adoption.
- Do not modify schema solely to migrate bookkeeping.
- Treat production DB state as source of truth for existing objects.
