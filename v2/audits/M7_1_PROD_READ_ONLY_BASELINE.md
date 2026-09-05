# M7.1 production read-only baseline

**Disposition: BLOCKED.**  This is a factual, no-write baseline record, not a
cutover approval.  M7.1A ran on 2026-09-04 using clean `dev` /
`origin/dev` source `d1c25a77104839d7831feb272945cb66d0393003`, which follows
the Post-M6 starting baseline `e77808b37883051c05a44e33328f923fd99bf179`.

## M7.1A production provenance update

Read-only Railway metadata and a direct, explicitly read-only PostgreSQL
session positively identify the target as Railway project `PrintersHero-
PRODUCTION`, environment `production`, service `PrintersHero-PRODUCTION`.
The service has one running replica, serves `api.printershero.com` on port
8080, and its active deployment is from `main` commit `1326ad1b1bda70e478adc44b3b7ee3ccdf7e5102`.

The application connection resolves to Neon host
`ep-rough-lake-aem3jtto-pooler.c-2.us-east-2.aws.neon.tech`, database
`neondb`, PostgreSQL 17.  The service exposes `DATABASE_URL`, production
Stripe, QuickBooks, Google, Supabase and application-origin variable names;
values were never retrieved or recorded.  This is independently corroborated
by `https://api.printershero.com/api/health`, which reports production and the
`www.printershero.com` origin.

The live production API is V1, not V2: its `/api/health` is valid V1 JSON,
whereas `/health`, `/ready`, and `/version` resolve to V1 frontend HTML.  DEV
V2 remains separately healthy at `api-dev.printershero.com` on `d1c25a77`.

## Safety result

Production application credentials were used only for PostgreSQL catalog and
identity reads after an explicit `REPEATABLE READ READ ONLY` transaction and
`transaction_read_only=on` proof; every session rolled back and closed.  No
business-data row was output.  No provider call, email, queue claim, migration,
webhook replay, or deployment was performed.

The target is now positively identified and the application identity was used
only in verified `REPEATABLE READ READ ONLY` metadata sessions with rollback.
However, M7.1 remains blocked because the dedicated audit-login password could
not be stored safely for reuse or used to prove its own connection boundary.

## Existing tooling assessment

| Path | Safe use | M7.1 production result |
| --- | --- | --- |
| `scripts/db/auditPhysicalSchema.ts` | Disposable DEV/CI `TEST_DATABASE_URL`; `BEGIN READ ONLY`, verifies `SHOW transaction_read_only`, catalog-only reads, rollback/end | Do not repurpose: it has no production identity allowlist. |
| `scripts/audit-migration-integrity-0109-0114.ts` | Historical/local inspection | Not a production gate: accepts `DATABASE_URL`, identifies after connect, and does not prove `transaction_read_only`. |
| `v2/scripts/devHistoricalDataHygienePolicy.ts` | Proven DEV inventory primitive: repeatable-read/read-only verification and guaranteed rollback/release | Correctly hard-gated to `PrintersHero-DEV / Development`; it must remain DEV-only. |

## Migration and schema baseline

Production migration journal, highest migration, duplicate/gap state, table
occupancy, extensions, and V2 schema compatibility are **not observed**.  The
Post-M6 reports establish only DEV evidence; they cannot be projected onto
production.

The next authorized production audit tool must accept only a distinct audit
role/URL with independently verified production provenance, redact identity
output, reject ambiguous scope before business reads, execute `BEGIN
TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`, verify
`transaction_read_only = on`, allow only bounded `SELECT`/catalog queries, and
always roll back, release, and close on both success and failure.

## Production service identity observations

Unauthenticated GET-only discovery found `www.printershero.com` on Vercel and
`api.printershero.com/api/health` on the verified Railway V1 backend.  The
backend's root `/health`, `/ready`, and `/version` paths return frontend HTML,
not V2 probes.  Production MCP root returns the default nginx page while its
`/health` reports version `1.0.0`; DEV MCP `/health` returns 502.  These checks
do not establish MCP process/tool topology, and no mutation endpoint was
contacted.

## DEV comparison baseline

Post-M6 DEV is the sole comparable evidence: its final validation records the
same source/deployed SHA, healthy/ready DEV service, and zero database/provider
mutations by its read-only inventory.  It records retained history including
ambiguous delivery attempts, pending financial outbox entries, historical
ProductVersions, compatibility fields, and routing fixtures.  PROD state shapes
remain unknown rather than assumed absent or corrupt.

## Required unblock

An audit role named `printershero_m7_audit` was created with a 2026-10-04 UTC
expiry, login, connection limit one, no superuser/role/database/replication/
BYPASSRLS/inheritance privileges, `default_transaction_read_only=on`, and an
explicit 46-table operational/financial/migration/audit SELECT allowlist.
It has no schema/database CREATE, INSERT, UPDATE, DELETE, or OAuth-table
SELECT privilege according to catalog checks.  Its generated password was not
safely persisted by the local Railway-run context, so it must be reset once by
a production database administrator and delivered through an approved
out-of-band secret channel before the dedicated-role connection proof and M7.1
business inventory can run.  Do not use a generic application `DATABASE_URL`.
