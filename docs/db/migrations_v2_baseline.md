# Migrations v2 Baseline

## Why lineage was reset

Dev and Prod schema state are aligned, but migration bookkeeping is not reliable across environments (including cloned DBs with empty Drizzle ledger state). To avoid replaying legacy history and to keep future deploys deterministic, we start a new canonical migration lineage:

- Source folder: `server/db/migrations_v2`
- Ledger table: `public.__drizzle_migrations_v2`
- Baseline tag: `0000_baseline`

This reset is **bookkeeping only**. It does not change schema.

## Baseline migration characteristics

`server/db/migrations_v2/0000_baseline.sql` is comment-only and contains no DDL.

## Baseline dev/prod ledgers

Baseline SQL is applied separately by ops (as provided outside this doc). In this repo, you can initialize ledger bookkeeping with:

```bash
npm run db:migrations:v2:init-baseline
```

This is idempotent and safe to run multiple times.

## Future migrations (v2 only)

All new migrations must be created in `server/db/migrations_v2`.

Use:

```bash
npm run db:migrate
```

`db:migrate` now uses `drizzle.config.ts`, which points to v2 (`out: ./server/db/migrations_v2` and `table: __drizzle_migrations_v2`).

## Deployment/build behavior

Build copy now packages v2 migrations for runtime:

- `server/db/migrations_v2` -> `dist/db/migrations`

## Hard rule

Never run legacy v1 migrations against production.
