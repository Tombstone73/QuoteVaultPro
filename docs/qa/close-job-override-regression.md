# Close Job Override regression — isolated verification

## Confirmed defects and correction

- The Order shortcut acquired the parent before its physical lines. Canonical
  production updates acquire a line before updating the parent. A controlled
  PostgreSQL interleaving reproduced HTTP 500 / `40P01` with the old shortcut.
  Both administrative production and fulfillment reconciliation now lock the
  tenant's lines in sorted order before the parent. Transaction-local lock and
  statement limits are 3 and 15 seconds; timeout/deadlock failures return a
  sanitized retryable rollback response. No automatic retry is performed.
- Production configuration and bootstrap route resolution used the global pool
  while holding a transaction connection. Reserving all other pool connections
  reproduced a request that could finish only after another connection became
  available. Those reads now use the current transaction, including the existing
  shared line-workflow route resolver.
- A completed job with a real `station_id` can be returned by canonical routing
  instead of a new administrative owner. The old loop retried that terminal
  result, reaching 17 bootstrap calls (one successful plus 16 without progress)
  before `ORDER_PRODUCTION_HANDOFF_INCOMPLETE`. This now fails immediately with
  `PRODUCTION_BOOTSTRAP_REVIEW_REQUIRED`, preserves terminal history, and rolls
  back the attempt. It does not fabricate another job or completion quantity.
- Batch completion repeated the parent obligation scan and unchanged-owner
  preflight queries. The batch now reuses its locked owner snapshot, checks run
  ownership in one preflight, and performs the same canonical parent handoff
  check once after all transitions. Ordinary job/Combined Run paths retain their
  checks. No proof, credit, quantity, permission or audit gate was removed.
- The dialog awaited every projection refetch after successful commits, so slow
  reads could keep it spinning after completion. Canonical success is now
  acknowledged immediately while shared Order, production, fulfillment and
  customer projections refresh. Requests are bounded, success envelopes checked,
  concurrent clicks guarded, and uncertain results require a fresh live preview.

## Transaction boundaries

Production completion and historical fulfillment remain the existing two
canonical operations, each transactional and idempotent. A production failure
rolls back its entire batch. If production commits and the subsequent fulfillment
operation fails, the UI explicitly identifies that committed production and
requires fresh preview; it never claims the entire two-request flow rolled back.
This release does not introduce a second ledger or redefine those boundaries.

## Measurements

Three synthetic physical lines, isolated loopback PostgreSQL, real Express
route and canonical services. Median of three production HTTP requests; SQL
counts include preview, transaction and post-commit billing projection, but
exclude fixture creation. No artificial network delay was inserted.

| Case | Before median | After median | Before SQL | After SQL |
| --- | ---: | ---: | ---: | ---: |
| Three existing owners | 266 ms | 204 ms | 131 | 123 |
| One existing owner, two bootstrap lines | 295 ms | 283 ms | 191 | 183 |

Before samples: existing 926/266/242 ms; bootstrap 295/257/368 ms. After samples:
existing 215/204/193 ms; bootstrap 283/305/265 ms. Cold-start/machine variance is
visible; these values do not predict hosted latency. Bootstrap remains query
heavy. The important liveness regressions also have deterministic lock/pool tests.

The terminal-history reproduction took 1,011 ms and 17 bootstrap calls before
the no-progress check; the corrected request took 140 ms and stops on the first
terminal bootstrap. The before request was cold and the after request warm, so
this is diagnostic evidence, not a throughput benchmark.

`[OrderProductionOverrideTiming]` records bounded, fixed-name aggregate stages:
preview, workflow locks, bootstrap, job completion, canonical handoff, transaction,
and billing projection. Counts/durations and safe identifiers only; no SQL,
customer contents, reconciliation notes or credentials. Transaction includes its
sub-stages, so durations must not be added together.

Representative corrected server-timed samples (not the medians above):

| Stage | Three existing owners | Two bootstrap lines |
| --- | ---: | ---: |
| Preview | 26 ms | 20 ms |
| Workflow/parent lock acquisition | 7 ms | 9 ms |
| Bootstrap | — | 67 ms |
| Canonical job completion, three calls | 103 ms | 112 ms |
| Final handoff | 7 ms | 8 ms |
| Whole transaction | 143 ms | 225 ms |
| Billing projection | 7 ms | 6 ms |

## Validation and limits

- 13 real PostgreSQL cases: active/missing owners, mixed completed lines,
  acknowledgement, terminal-history conflict, concurrent production/duplicates,
  pool contention, Combined Runs, bounded lock wait, injected final-handoff
  rollback, operational reconciliation/readback, financial preservation,
  tenant/role isolation and credit release.
- 15 existing focused PostgreSQL production-integrity cases passed, preserving
  monotonic Combined Run quantities and canonical managed-station handoffs.
- 21 focused server unit/contract tests and 14 focused frontend tests passed.
  Frontend coverage includes stalled refetch, failed second stage, bounded
  unknown-outcome recovery, fresh preview, response validation and no silent retry.
- Scoped TypeScript: 18 changed/new roots, 8192 MB heap, zero diagnostics.
  No full-codebase check, new migration or broad suite.

Order 20881 was neither queried nor modified: this environment has no authorized
deployed database/Railway diagnostic credentials. Its exact production lock graph
and terminal-job history remain unverified. The isolated failures are confirmed
code paths, not a claim to have recovered that incident's logs. No actual Orders,
Invoices, payments, shipments, worker controls or MAIN records were changed.
Browser/live acceptance was not performed for this repair; frontend evidence is
component-level and database evidence is actual isolated PostgreSQL readback.
