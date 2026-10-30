# Isolated PostgreSQL verification of inbound email intake

## Safe repeatable Windows run

From the repository root, with Node dependencies already installed:

```powershell
# First use: fetch the pinned official portable PostgreSQL 16.4 archive.
pwsh -NoProfile -File scripts/qa/test-inbound-postgres.ps1 -DownloadRuntime

# Subsequent runs reuse only the runtime binaries, never a database.
pwsh -NoProfile -File scripts/qa/test-inbound-postgres.ps1

# Alternatively, supply a complete existing PostgreSQL 16+ installation.
pwsh -NoProfile -File scripts/qa/test-inbound-postgres.ps1 -PgBin 'C:\path\to\pgsql\bin'
```

The [official Windows download page](https://www.postgresql.org/download/windows/)
provides portable binary archives through EDB. The optional download uses a fixed
HTTPS URL and a pinned SHA-256 measured for the tested archive. It extracts only
bin/lib/share inside `node_modules/.cache/inbound-pg-validation/runtime`. There is
no installer, service registration, PATH change, paid resource or system setting.
The machine's existing PostgreSQL 18 command tools were incomplete: initdb could
not find share/postgres.bki. A complete portable runtime avoids that failure.

The runner ignores application database URLs. It initializes a new cluster with
synthetic test admin, binds only 127.0.0.1 (default port 55481), checks the exact
server data directory, database name, address, version and ownership marker before
creating/loading the test database. Jest verifies identity again before migration.
Another service using that port causes startup failure; it is never reused.
Use `-Port` to select another unused local port. Loopback connections and child
process execution must be permitted by the execution environment.

The database is always `printershero_inbound_test`, inside the repository-owned
cache data directory. No shared DEV/MAIN connection or customer data is needed.
Trust authentication is limited to this short-lived synthetic loopback server.
The finally block stops the server and removes only its verified, marked data
directory, even when a test fails. Logs and portable binaries remain ignored.
An existing cluster causes Run to fail closed. If the **runner itself** was killed:

```powershell
pwsh -NoProfile -File scripts/qa/test-inbound-postgres.ps1 -Action Cleanup
```

Cleanup verifies the ownership marker and exact repository path, stops that
cluster, and refuses deletion if it cannot establish safe stopped state. Never
point these tools at an application database or reuse them for shared migrations.

## Canonical migration verification

V2's 0000 baseline is comment-only; it cannot build an empty database. The test
foundation generator builds an empty synthetic prerequisite from the current ORM:
tables created by V2 and columns/types added unconditionally by V2 are left for
their actual migrations. Stations retain the existing ORM varchar identifier
contract and its migration-only default/link. Unique indexes precede FK creation.
A synthetic organization exists before migrations so station seeding and release
data checks run normally.

This foundation is a test fixture, **not a production schema snapshot, deployment
bootstrap or historical migration replacement**. It does not write a ledger or
declare migrations applied. Migration journal monotonicity and protected integrity
checks run first. The unchanged `runMigrations()` executes the complete journal
through 0241, including its advisory lock and all 80 release checks. Test setup
then verifies every one of the 235 journal entries by actual ledger hash and
timestamp. No historical migration is edited, skipped or manually stamped.

The test-only Jest mapping uses pg/node-postgres in place of Neon's WebSocket
transport, including the migrator mapping. Application services, generated SQL,
transactions and PostgreSQL locks remain real. Production driver configuration is
unchanged. The existing projection-only local Jest configuration is untouched.

## Findings corrected

1. Drizzle's single-table SELECT projection removed interpolated column qualifiers
   inside correlated queue SQL. Parent linkage produced ambiguous `id` errors;
   Order existence checks could lose the intended tenant correlation. Explicit SQL
   identifiers retain both alias and outer-record tenant scope. Real queue reads,
   counts, merged parent context and foreign-tenant linkage tests cover the fix.
2. Evidence fingerprints are `v1:` plus 64 hex characters: 67 characters. Migration
   0240's varchar(64) rejected durable scheduling. Additive migration 0241 widens
   the column to varchar(128); the schema agrees. Full identity, unique index and
   prior reviewed coverage are preserved. Migration 0240 remains immutable.
3. One existing proof-gate fixture used a nonexistent proof ID. It now persists a
   synthetic attachment and approved proof version, retaining the FK and workflow
   assertion. Its cancellation timestamp fixture also matches the string contract.

## Validation and its limits

Verified on 2026-10-29 with PostgreSQL 16.4:

- **56 real PostgreSQL cases passed**: all 27 previously blocked Quote
  routing/conversion cases and 29 focused inbound cases.
- All **235** canonical ledger hashes/timestamps and **80** release checks passed.
- **63** focused mocked regression cases passed separately. They supplement the
  real database execution and are not counted as PostgreSQL coverage.
- Scoped TypeScript checks passed for the two production inputs and six changed
  test/setup inputs (eight total); no full-repository TypeScript/build was needed.
- Fresh-cluster setup and automatic shutdown/deletion completed successfully.
  Protected migration integrity and journal ordering passed.

The database cases exercise competing connections and
SKIP LOCKED, duplicate scheduling and initial drafts, lease expiration, bounded
retry/backoff/manual retry, stale worker publication rejection, evidence changes
against parsing/approval/conversion, preservation of staff edits, legacy fail-closed
approval, versioned dismissal, queue counts/filters, canonical Quote conversion,
linked and dismissed reopening, tenant isolation and multi-record rollback.

Concurrency barriers inspect pg_locks or pause the stub provider at an explicit
promise boundary. They do not rely on arbitrary sleeps. Lease time is advanced by
changing only synthetic job deadlines, avoiding a five-minute wait. One case starts
the actual worker in a child process, waits for its stub provider boundary, kills
the process, verifies its durable claim survives, expires that lease, and starts a
new worker that creates exactly one review draft. Another case reuses a parse
persisted before a simulated crash. Database decisions and readbacks are real;
AI responses and attachment reads are stubbed, and no Gmail/customer contact,
production Order, label purchase or financial transaction occurs.

These results establish local PostgreSQL behavior with this synthetic foundation.
They do not prove deployed Neon transport behavior, shared schema readiness,
provider accuracy, real attachment downloads or deployment wiring. No shared
migration, data repair, mailbox activation, push or deployment is part of the run.

Automatic draft preparation remains implemented and **disabled by default**.
Remaining rollout work: apply/review migrations 0240 **and 0241** in the intended
environment, interrupted-import recovery, Gmail acknowledgement/read/label policy,
legacy evidence/linkage reconciliation and queue-volume assessment, and DEV
acceptance with synthetic evidence and human approval. The complete email-intake
workflow is not ready for mailbox rollout on the strength of database tests alone.
