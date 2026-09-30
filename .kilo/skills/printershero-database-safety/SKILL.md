---
name: printershero-database-safety
description: Safe rules for any change touching PostgreSQL schema, migrations, seeds, or test data in the PrintersHero/QuoteVaultPro repository. This skill should be used when adding or editing SQL under server/db/migrations_v2, touching the Drizzle journal or migration-history integrity manifest, writing a backfill or repair script, or running any command that could write to a database.
metadata:
  category: development
  project: QuoteVaultPro
  status: draft
  verified-against: origin/dev @ 63f19bd39a5c9c799aae3f5335709d346077c96a
---

# PrintersHero Database Safety

The migration stream is manually authored and append-only. Its history is a tamper-evident trust anchor.

> **Verify before trusting.** Every repository fact below was read from
> `origin/dev @ 63f19bd39a5c9c799aae3f5335709d346077c96a`. Numbers change with every migration.
> **Do not copy a count or a hash from this file into a change.** Re-read the live value:
> `server/db/migrations_v2/meta/_journal.json` and `server/db/migrations_v2/meta/_history-integrity.json`.
> Anything not re-verified is `REQUIRES CONFIRMATION`.

## First step — confirm what you are looking at

Before reading any migration or asserting any "highest migration" number:

1. `git rev-parse HEAD` and compare with the commit you were asked to work on.
2. List `server/db/migrations_v2/*.sql` and read the highest tag from the **journal**, not from memory.
3. Note that **journal `idx` and the numeric tag prefix are not equal.** At the audited commit the tag
   `0293_v2_custom_role_archive` has journal `idx` 294. Never derive one from the other.

## Authoritative layout (as verified at the audited commit)

| Path | Role |
| --- | --- |
| `shared/schema.ts` | The single Drizzle schema. There is no `server/db/schema.ts`. |
| `server/db/migrations_v2/` | Canonical migration stream (SQL files + `meta/`). |
| `server/db/migrations_v2/meta/_journal.json` | Drizzle ledger: `idx`, `version`, `when`, `tag`, `breakpoints`. |
| `server/db/migrations_v2/meta/_history-integrity.json` | CI trust anchor: `entryCount`, `immutableThrough`, `canonicalSha256`, and **`unappliedRepairs`**. |
| `drizzle.config.ts` | `out: ./server/db/migrations_v2`, `schema: ./shared/schema.ts`, ledger table `public.__drizzle_migrations_v2`. Throws if `DATABASE_URL` is unset. |
| `server/db/migrations/`, `migrations_BACKUP/`, `migrations__archive_*`, repo-root `migrations__legacy_ignored/` | Legacy. Do not use. |

At the audited commit: 289 SQL files, highest tag `0293_v2_custom_role_archive`, journal 289 entries,
`immutableThrough.idx = 294`. Re-read these; they are stale the moment a migration lands.

### `unappliedRepairs` — read this before editing any recent migration

`_history-integrity.json` records documented repairs to migrations that were **never released**
(each entry has `priorCanonicalSha256`, `tags`, `reason`). At the audited commit three exist, for tags
`0231`/`0232`, `0257`, and `0287`. They show the accepted exception path: an *unreleased* migration
that the DEV database rejected before it committed may be corrected in place, with the prior digest
and reason recorded. **This is not permission to edit a migration that has ever committed anywhere.**
Do not add an entry yourself; that is a human-approved integrity event.

## Hard rules

1. **Never generate. Author by hand.** `npm run db:migrations:v2:generate` deliberately exits 1
   ("Blocked: do not run drizzle-kit generate for v2"). Also avoid `npm run db:push` against any shared database.
2. **Never edit an applied migration.** The integrity check fails with an instruction to create a new
   repair migration instead. See `unappliedRepairs` above for the single narrow exception.
3. **`when` must be strictly increasing.** Drizzle silently skips a migration whose `when` is not greater
   than the max `created_at` already in the ledger. `scripts/check-journal-monotonic.mjs` enforces it.
4. **Append only.** Never insert behind the frontier or reuse an `idx`.
5. **Additive, with physical postconditions.** Domain `*PhysicalPostconditions.ts` modules (for example
   under `v2/infrastructure/fulfillment/`, `billing/`, `production/`) assert real tables, indexes,
   constraints, and triggers. Extend them with the migration. Many migrations also have a
   `v2/tests/persistence/*Migration.contract.test.ts`.
6. **Run the preflight before proposing a change:**
   `npm run db:migrations:v2:preflight` (runs `check-journal` then `check-integrity`).
7. **No startup DDL and no copied POC DDL.**

## Applying migrations

| Path | Mechanism (verified) |
| --- | --- |
| Startup | `server/index.ts` → `server/runMigrations.ts`. Kill switch `DRIZZLE_AUTO_MIGRATE=0`. Session advisory lock `pg_try_advisory_lock` with bounded retry. |
| Deploy | `railway.json` `deploy.preDeployCommand` = `npm run v2:migrations:apply` → `tsx v2/scripts/applyV2Migrations.ts`. |
| DEV reconciliation | `applyV2Migrations.ts` runs `runM77BDevSchemaReconciliation` first **only** when `M77B_DEV_RECONCILIATION=1`. |
| Manual | `db:migrate`, `db:migrate:dotenv`, `db:migrate:verbose`, `db:status`, `v2:migrations:status`. |
| Test DB | `server/tests/setup.ts` runs the stream in `beforeAll` when a safe test database is configured. |

`runMigrations.ts` defines a `RELEASE_CHECKS` array of physical assertions (86 entries at the audited
commit: `column_exists` 34, `table_exists` 16, `constraint_exists` 16, `index_exists` 7,
`enum_value_exists` 6, `row_exists` 3, `trigger_exists` 2, `exact_foreign_key` 1, `column_nullable` 1).
A failing check throws and blocks startup. A migration that changes an already-asserted shape needs a matching update.

`scripts/copy-migrations.mjs` copies the stream to `dist/db/migrations_v2` and logs
`[Build] migrations_v2 packaged: N entries, highest idx = M (tag)`. Its absence in a build log
means the deployed `dist` is stale.

## Test and clone database guards — never weaken

- `server/tests/helpers/safeTestDatabase.ts` reads **only** `TEST_DATABASE_URL` (no `DATABASE_URL` fallback),
  requires it to differ from `DATABASE_URL`/`MIGRATION_DATABASE_URL`/`DIRECT_DATABASE_URL`, requires a
  `postgres:`/`postgresql:` URL naming exactly one database, blocks names matching
  `dev|development|main|prod|production|live|shared|business`, and requires a standalone `test|testing|ci` token.
- `v2/infrastructure/persistence/cloneSafety.ts` gates V2 rehearsals on explicit opt-ins
  (`V2_M0_POSTGRES_INTEGRATION=1`, `V2_POSTGRES_INTEGRATION=1`) and **rejects the run if any other
  database-connection variable is present** (anything matching DATABASE/POSTGRES/NEON/RAILWAY/CONNECTION_STRING/DB_URL/DB_URI,
  `PG*`, or `DB*`), so a rehearsal has exactly one possible target.

## Pre-change checklist

1. HEAD is the commit you were asked to work on; highest tag re-read from the journal.
2. New file is `NNNN_snake_case.sql`, `when` strictly greater than the last entry.
3. Existing migration history is untouched (no edit, no reorder).
4. Relevant `*PhysicalPostconditions` and migration contract test extended.
5. `RELEASE_CHECKS` reviewed for shapes this migration changes.
6. `npm run db:migrations:v2:preflight` and the canonical non-destructive
   `npm run v2:validate` pass. Validation does not apply migrations or prove
   live-database physical postconditions; run those separately on a guarded target.
7. Every test or rehearsal target is a guarded clone, never DEV/PROD.
8. The change is reversible by a forward migration.

## Ownership caution for data changes

A migration that adds or moves a table also moves **ownership**. Before adding a table, read the
owning module in `docs/architecture/v2/V2_MODULE_OWNERSHIP_BOUNDARIES.md` and use
`printershero-architecture-audit`. A table should have exactly one writing module.
Review its entry in the executable ownership map and run `npm run v2:ownership`.
Do not turn a new foreign write into a debt baseline entry merely to pass the
check. Known debt is awaiting removal, not permission; genuine ownership
ambiguities require a human decision before adding another writer.
