# M7.2B clone rehearsal report

## Disposition: NOT RUN — BLOCKED ON SAFE CLONE PROVENANCE

No clone, migration, database write, provider call, deployment, or production inspection was performed for M7.2B.

## Feasibility result

Railway production is a single application service backed by external Neon; it has no Railway database service or volume to clone. This host has no psql, pg_dump/pg_restore, PostgreSQL service, Docker, Podman, Neon CLI, or existing safe clone endpoint. A logical production export/import would handle production data locally and is not an acceptable substitute.

The required route is an ephemeral Neon child branch from the verified production parent at a recorded cut point. The user/environment has not supplied Neon Console/API authority, a project/parent branch identifier, or a pre-existing non-production child endpoint. Actual rehearsal is therefore blocked, not failed.

## Required clone acceptance record

Before any clone write harness runs, capture out-of-band but do not commit: Neon project ID; parent branch ID/name; cut timestamp and LSN or exact current cut; child branch ID/name; child endpoint ID and unique hostname; database/role identity; creation/expiry time; actor; TTL/deletion owner. Treat a branch URL as a secret. A database named neondb alone is not clone proof.

Immediately use a read-only clone connection to verify child hostname differs from PROD and record only: current user/database/version, host allowlist/hash, ledger count/canonical hash, pg_catalog schema fingerprint, relation sizes, and safe aggregate counts. Reject any known PROD hostname before a write-capable rehearsal starts.

## Required database-only rehearsal

1. Do not start V1, Railway, Vercel, workers, webhooks, MCP, or provider runtimes. Remove provider credentials and public ingress.
2. Capture clone baseline catalog/ledger/aggregate fingerprint and attach the expected R0264-R0269 manifest.
3. Pass only TEST_DATABASE_URL plus explicit clone-write opt-in to one dedicated direct-connection executor. Do not use generic V1 startup or Drizzle auto-discovery.
4. Run R0264 through R0269 one stage at a time, fingerprint after each stage, and abort on an unexpected relation/ledger change, timeout, count mismatch, or network/provider attempt.
5. After repair checks, allow normal Drizzle M0200-M0263, then verify full catalog target. Verify post-head attestations do not bypass required work.
6. Retry only explicitly idempotent stages. For a failure test, discard/recreate a child branch from the same recorded parent cut; never reuse a partially mutated clone as the success baseline.
7. Run guarded V2 persistence checks only after schema/data validation, with clone-only fixtures and cleanup/rollback.

## Measurement plan

Use a separate clone monitor connection to record wall duration, pg_locks, pg_stat_activity, pg_blocking_pids, pg_stat_progress_create_index where allowed, relation sizes, lock/statement timeouts, and retry/failure behavior per statement/stage. In an idle clone, these are DDL timings, not production downtime proof. Add clone-only contention tests and label them simulated.

Use nullable-column/backfill/checkpoint stages; add FKs/checks NOT VALID then validate; use CREATE INDEX CONCURRENTLY only outside a transaction-owning migration executor. Clone evidence does not remove the need for a production maintenance/drain plan under live V1 writers.

## Existing harnesses rejected for this milestone

Do not run scripts/runV2CloneChild.mjs or v2/scripts/runP5CloneChild.ps1. They can convert a Railway-provided DATABASE_URL into TEST_DATABASE_URL; in a production Railway context that would still be production. Existing clone guards isolate variable sources but do not establish Neon child-branch provenance.

## Clone recovery

Clone failure recovery is executor stop, evidence preservation, and child-branch deletion/recreation from the recorded parent cut. That proves rehearsal recovery only. Actual production restore/failback requires a separately authorized Neon restore-point runbook naming the restore authority, target timestamp/branch, replay boundary, and provider-side reconciliation.
