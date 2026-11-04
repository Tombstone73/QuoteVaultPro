# Production integrity P1 correction

## Baseline and scope

DEV and MAIN both resolved to `803141280a0a4325a71621f8efb09f40ae8c6a9f`
on 2026-11-04. All three defective paths remained. This release changes two
production implementation files plus focused validation; it targets DEV only.
No historical repair, backfill, production record update or new migration runs.

## Confirmed causes and correction

1. Combined Run outcome reads were unlocked. A deterministic real PostgreSQL
   gate reproduced 50 confirmed pieces overwritten by 20, and simultaneous
   duplicate requests produced two outcome events. The run row is now locked
   before deriving mutable state, followed by member and line locks in stable
   line/member order. Quantities and idempotency are checked after the locks.
   Sheet-progress and lifecycle-completion entry points acquire the same run
   lock before deriving their outcomes. Confirmed legacy completed quantities
   also remain authoritative when successfulQuantity was not initialized.
2. Generic completion marked Design/Prepress owners done and only afterward
   logged a warning, leaving their line workflow unchanged. The canonical
   generic completion operation now rejects managed Design/Prepress/Proofing
   jobs before timer, job, material or history mutations. It directs staff to
   Complete Design, Complete Prepress / Send to Print, or Proofing approval.
   Legacy Prepress step ownership is recognized through the existing helper.
3. Combined Run handoff inspected active jobs only; an unfinished physical
   sibling with no job was invisible. It now delegates to the existing
   markOrderReadyForFulfillmentIfProductionComplete operation, preserving
   canonical production obligations, bootstrap protection and terminal-parent
   guards. This also removes the duplicated now()::text expression, which
   failed against the timestamp column in the migrated PostgreSQL test schema.

No routing engine, proof policy, quantity limit, shipping-quantity gate,
permission model, or financial policy is replaced.

## Validation and evidence boundaries

15 focused real PostgreSQL tests passed using the existing verified loopback disposable
cluster and all 244 immutable canonical migrations. No service/database mocks
are used for the production operations or concurrency decisions. Row-lock
waiters are observed through pg_stat_activity to make the concurrency
reproduction deterministic, rather than relying on simultaneous timers.

Coverage includes decreasing and increasing concurrent outcomes, duplicate
retries and audit counts, quantity bounds, confirmed damage, legacy quantities,
transaction rollback, unsupported generic completion, legacy step ownership,
canonical Prepress Send to Print, final-file metadata identity, unfinished and
completed siblings, active owners, complete-as-planned retries, unique
Fulfillment ownership, and tenant isolation. The Prepress fixture contains
synthetic final-file metadata; no remote object-storage read or physical print
is claimed.

95 existing focused regression tests passed across 13 suites covering Combined Runs, canonical ownership,
completion routes, Order production policy and fulfillment quantity gates.
Pure/stubbed suites that load the database module use a deliberately
non-connectable loopback configuration; real persistence assertions use only
the verified disposable PostgreSQL cluster.

Scoped TypeScript passed with zero diagnostics across three changed/new roots,
using an 8192 MB heap. No broad
repository suite or full-codebase TypeScript check is required.

DEV deployment and real operator behavior remain unverified. MAIN is not
promoted by this task. Deployable but not yet live-validated.
