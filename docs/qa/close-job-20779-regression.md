# Close Job Override: stale parent and mixed ownership

## Confirmed code defect

The original `complete-production` route returned HTTP 200, `alreadyCompleted:
true`, and zero completed jobs whenever `orders.state` was `production_complete`.
It did so before checking the canonical line obligations. A historical parent
could therefore display Complete while the preview correctly showed remaining
production and two unowned lines. The following fulfillment operation rejected
unfinished production; the first response had not completed it.

A disposable PostgreSQL fixture with one active owner and two missing owners
reproduced that exact false-success response against the original HEAD route.
The corrected route completes all three lines using the existing routing,
completion, prerequisite bypass audit, and parent handoff operations. This is a
confirmed code defect, not a claim about the actual state of Order 20779.

## Actual Order 20779: disposition D, outcome unknown

No live Order records were inspected or modified. Chrome inventory was
available, but binding/opening its authenticated MAIN tabs failed in browser
control. No hosted database or Railway diagnostic credentials were available.
The historical submission's commit, rollback, request lifetime, exact unowned
lines, and audit history cannot be established from the operator report alone.
Closing the dialog establishes neither rollback nor successful completion.

Before any deliberate retry, the tenant Owner should open MAIN Order **20779**,
confirm **OTB Graphics**, and use the existing **Order diagnostic** / **Copy
diagnostic** action. That existing endpoint supplies a consistent read-only
snapshot of canonical quantities, owners, terminal history, run memberships,
fulfillment and audits. Do not submit another override to obtain diagnostics.
Correlate any available request/timing logs with that snapshot. No business-data
repair or automatic retry is included in this release.

## Safety and compatibility

- Workflow line locks still precede the parent lock. The canonical preview is
  now re-read through the transaction connection after those locks, retaining
  the 3-second lock and 15-second statement limits and sanitized timing logs.
- Recovery is restricted to the existing explicit administrative override and
  recognized stale readiness statuses on open/production-complete parents.
  Closed, canceled, and operationally complete historical parents are not
  resurrected. Missing-owner acknowledgement remains mandatory.
- The preview shows the actual ordered line numbers, descriptions, quantities,
  and absence of active ownership. Terminal history remains intact; a terminal
  station owner that prevents canonical bootstrap still fails closed for review.
- Confirmation tokens bind the reviewed quantities, owners and prerequisite
  decisions. Execution rechecks them under locks. The production response gives
  the committed continuation token for the separate fulfillment operation.
  Older callers without tokens retain canonical locked validation; updated
  callers send tokens. No schema or migration is required.
- Production and fulfillment remain **two existing transactions**. A first-stage
  failure rolls back parent recovery, new owners, completion and audit together.
  A second-stage failure rolls back fulfillment allocations and retains any
  prior committed production, which the UI explains.
- A transport interruption triggers only a bounded read-only preview check.
  A confirmed completed canonical state is reported as such, without claiming
  which request committed it. Otherwise the UI reports uncertainty, preserves
  the reason/note, and requires deliberate review before retrying. Duplicate
  submissions remain locked/idempotent; no request is automatically replayed.
- Existing production ownership, Combined Runs, proof/credit gates, financial
  records and shipment/billing behavior are preserved. No historical repair,
  migration, routing change, worker activation, or external service call added.

## Focused validation

- Scoped TypeScript: nine changed sources/tests/fixtures, 8192 MB heap, zero diagnostics.
- 24 PostgreSQL tests passed against the owned, disposable loopback cluster.
  The original HEAD route failed the new stale-parent regression with false
  success; the corrected route passed it and the concurrency/rollback cases.
- 24 focused frontend tests and 20 server unit/contract tests passed. The
  existing fulfillment unit doubles were updated for the transaction-bound
  reads and current database module exports; no business contract was mocked
  in the real PostgreSQL suite.
- Local in-app browser at normal zoom: light/dark dialog rendering, actual
  affected-line details, acknowledgement gating, success, retained failed-save
  note, visible/focused error, and lost-response readback without mutation replay.
  Browser business responses were mocked. No deployment was inspected.
- Migration-history integrity and scoped `git diff --check` passed; no migration
  files changed. Concurrent inbound audit edits were excluded from this release.

See `server/tests/closeJobOverrideRegression.postgres.integration.ts` for real
PostgreSQL coverage of stale parents, mixed/terminal history, missing owners,
single-line bootstrap, locked stale previews, concurrent reviewed requests,
bounded contention, rollback, financial preservation and tenant/role boundaries.
Component coverage exercises acknowledgement, exact preview forwarding,
duplicate clicks, retained notes, outcome reconciliation and query invalidation.

`e2e/local-close-job/fixture.tsx` renders the real dialog and theme styles with
explicitly mocked business APIs. Start it through the existing
`e2e/local-inbound-workflow/server.mjs` helper with that entrypoint. It supports
success, rejected ownership and a lost response after synthetic commit. It
cannot read or mutate a deployed Order; all nonlocal/business requests fail.
Browser checks establish UI behavior only. PostgreSQL tests establish isolated
persistence/rollback behavior. Neither establishes DEV or MAIN acceptance, or
the outcome of the original Order 20779 attempt.
