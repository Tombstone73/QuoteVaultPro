# M7.2A migration risk map

**Disposition:** reconciliation-only. This is a planning input, not authorization to execute DDL, migrations, worker changes, or a deployment.

## Live-work inputs

| Relation | Estimated rows | Total size | Operational interpretation |
| --- | ---: | ---: | --- |
| orders | 339 | 0.89 MiB | aggregate count is 350, including 191 in_production; live authority handoff required |
| order_line_items | 486 | 5.31 MiB | live production-line relationships; compatibility/foreign-key changes require reconciliation |
| production_jobs | 418 | 0.58 MiB | aggregate count is 478, including 320 queued; do not alter under active V1 worker authority |
| invoices | 240 | 0.93 MiB | aggregate count is 257; financial invariants/provider state require preservation |
| payments | 24 | 0.27 MiB | populated local financial/provider state; no replay or provider reconciliation in a schema step |
| v2_operation_requests | unanalysed empty | 0.04 MiB | catalog exists but no recorded workload in M7.1 snapshot |
| v2_outbox_messages | unanalysed empty | 0.04 MiB | catalog exists but no recorded workload in M7.1 snapshot |

pg_class estimates intentionally differ from exact aggregate M7.1 counts. Use exact clone measurements before a future maintenance plan.

## Migration/reconciliation risk classification

| Range / future step | Affected area | Risk | Reuse decision / rationale |
| --- | --- | --- | --- |
| M0180-M0184 | existing V2 foundation and permission schema | LOW LOCK RISK for inspection only | already present and hash-aligned; do not replay because ledger records them |
| M0185-M0186 | permission functions, deferred triggers, authority revision state | REQUIRES DATA RECONCILIATION FIRST | content-divergent ledger hashes; preserve and prove equivalence before any replacement |
| M0187-M0191 | live products/customer contacts plus missing sales tables | HIGH LOCK RISK; REQUIRES DATA RECONCILIATION FIRST | normal indexes/legacy unique constraints and new tenant FKs can block live writers; chain is journal-skipped |
| M0192 | missing V2 audit table and permission seed changes | BOUNDED LOCK RISK plus compatibility risk | create/audit state must be forward-only/idempotent; current SQL is journal-skipped |
| M0193-M0195 | missing routing/billing tables; product_types and sales linkage | HIGH LOCK RISK; REQUIRES MAINTENANCE WINDOW | dependent tables/FKs plus product type alterations; prerequisites absent |
| M0196 | template-derived permission-set data update | REQUIRES DATA RECONCILIATION FIRST | data mutation must not be blindly replayed against a divergent permission history |
| M0197-M0199 | missing artwork/proof tables, triggers, grants | BOUNDED LOCK RISK; REQUIRES DATA RECONCILIATION FIRST | new domains are absent, but legacy artwork/proof state is populated and requires mapping |
| M0200-M0263 | dependent proof, prepress, production, finance, fulfillment and other V2 domains | UNSAFE AS WRITTEN | auto-migrator would target this range despite absent M0185-M0199 prerequisites |

## Operations that prohibit ordinary replay

- The current runner skips any migration at or below the M0199 ledger timestamp, then may start M0200+ before release checks.
- Repository history includes UPDATE/backfill, seed, trigger, constraint drop/recreate, and destructive duplicate-cleanup operations. Recorded historical migrations are not safe idempotent repair commands.
- The chain uses ordinary indexes and ALTER TABLE operations, not a blanket concurrent/online strategy. No table lock duration can be inferred from the current small metadata sizes alone.
- M0187/M0195 touch live V1 product/customer-contact paths; later migrations touch proof, production, invoice/payment, and delivery state. V1 retains current authority and must not race a future reconciliation.

## Runtime migration authority

V1 startup calls runMigrations before routes/workers. Unless DRIZZLE_AUTO_MIGRATE is exactly 0 or false, source defaults to auto-migration and selects MIGRATION_DATABASE_URL, then DIRECT_DATABASE_URL, then DATABASE_URL. It packages migrations into dist, uses bounded advisory lock 928372001 (120 seconds default in production), and blocks startup after migration/release-check failure. The source permits pooled Neon URLs, for which its own comments warn the lock may be stale.

V2 source also has deployment migration expectations, but no production V2 process/deployment is proven. Actual production env gates, packaged migration journal fingerprint, process command, lock holder, and startup logs are UNKNOWN. A later, authorized runbook should freeze auto-migration before any production deployment; this milestone does not change it.

## Required preconditions for M7.2B planning

1. Schema-only clone from the actual production physical state, not a presumed M0199 state.
2. Reconciliation design that is forward-only, idempotent, ordered, and separately reviewed for every DDL/data step.
3. Per-step lock_timeout, statement_timeout, maintenance-window, index/constraint strategy, and rollback/abort criteria.
4. Explicit V1 in-flight-work and writer shutdown/handoff design for orders, queued production jobs, finance, proof/artwork, and email exceptions.
5. Read-only proof of deployment artifact journal, selected migration database, gates, and MCP authority before any cutover action.

## Scope ledger

Production DDL/migrations: none. Application/business-data mutations: none. Provider writes: none. The only production mutation in M7.2A was the ephemeral audit-role password rotation used to gather catalog metadata.
