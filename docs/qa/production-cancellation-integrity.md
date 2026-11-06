# Production cancellation integrity

## Baseline and confirmed findings

Implemented on the normal DEV branch `codex/inbound-order-workflow`, based on
`278b1ab452bc47f7cef93cd0421307df790b9563`. The recent Close Job repair
`e478d34ba599c90ea581643c92b276431c6291b4` is preserved. No migration is needed.

The supplied MAIN diagnostic for Order 20779 reports active quantities 2/4/2,
two canceled jobs, one queued job, eight remaining production/fulfillment units,
and two missing production owners. This task did not access or change that live
Order. Its exact record-level historical cause remains unconfirmed.

Confirmed source defects:

1. Generic job-status cancellation retired an owner without checking the retained
   line's canonical production obligation or arranging a successor.
2. Required-owner workflow transitions only warned when routing returned zero or
   multiple active owners. A failed route could therefore commit an ownerless
   workflow state.
3. Canonical line cancellation used the generic terminal completion helper, which
   recorded the retired job as `done` instead of `canceled`.
4. The shared Open-list/sidebar predicate excluded cosmetic Complete labels even
   when the Order's canonical `state` was `open`.

Historical qualification: `ba46e3298` introduced `corrective_line_removal`. Both
that original implementation and the current baseline cancel the commercial line
and job in one database transaction. Its event name alone does not establish why
the supplied historical lines are now active. Later edits/events must be examined
before attributing the entire mismatch to that endpoint.

## Cancellation and ownership path audit

| Entry point | Authority and transaction | Effects, protections, retry |
| --- | --- | --- |
| `PATCH /api/production/jobs/:jobId/status`, canceled | Existing authenticated internal-staff permission; `updateProductionJobStatusWorkflow` in caller transaction | Locks tenant-owned line then job; reads canonical fulfillment/production projection. Blocks active run membership. For retained unfinished production, retains one valid owner or calls existing router for the same station/step; otherwise rolls everything back. Stops timer, preserves canceled row, reason, event and audit. Repeated request against the already canceled row returns existing state without another successor. |
| Order **Cancel Work & Remove Line**, `/api/order-line-items/:id/corrective-remove` | Existing Owner/Admin check; one transaction | Locks Order lines in canonical sorted order; rechecks run/owner state. Cancels commercial line and calls canonical job cancellation, without replacement. Preserves file/history associations, rejects residual active owners, recalculates Order totals and synchronizes editable Invoice snapshots through existing financial services. Successful replay is a no-op. Paid history retains the existing adjustment/audit policy. |
| Ordinary `DELETE /api/order-line-items/:id` | Existing authorized canonical Order repository/removal operations | Active ownership still blocks ordinary deletion and offers the dedicated corrective action. Historical dependencies preserve records rather than erasing operational evidence. No new deletion path or bypass. |
| Line workflow/status cancellation | Existing route permissions and `transitionLineItemWorkflowState` transaction | Locks line; blocks active Combined Run membership; retires owner as **canceled**, not produced. Residual ownership causes rollback. Required-owner states now require exactly one owner after canonical routing. |
| Whole Order cancellation | Existing `orderCancellationService` | Intentional cancellation of commercial obligations, with run, shipment and Invoice/payment policy checks. Cancels related operational records transactionally. No replacement work is invented; this path is unchanged. |
| Combined Run cancel / return member / return run / outcome | Existing run authorization and `productionRunService` transactions | Run/member locks and canonical return transitions remain authoritative. Unstarted cancellation restores Prepress-origin ownership or rolls back; started/partial run cancellation remains blocked. Partial outcomes retain remaining work; run cancellation is replay-safe. Standalone cancellation cannot remove active run ownership. No membership-history deletion introduced. |
| Station reassignment / Return for Correction | Existing permissioned canonical transitions and `transitionToStation` | Uses shared line serialization and existing station resolution, proof/credit checks and history events. Cancellation racing with reassignment cannot commit two owners or no owner. Existing destination-record reuse semantics are unchanged. |
| Production bypass | Existing authorized canonical bypass contract | A deliberately bypassed physical line has no remaining production obligation; its old job can be retired without replacement. This does not authorize actual production completion. |
| Administrative completion / Close Job Override | Existing Owner/Admin preview, acknowledgement, reason and canonical override transaction | No automatic fallback to administrative completion. Production bootstrap, terminal-history review, quantity/fulfillment gates and financial safeguards remain intact. Recent Close Job PostgreSQL regressions pass. |
| Status-pill assignment / lifecycle transition | Existing pill service versus canonical workflow services | Pill assignment is informational grouping, not physical completion. Existing In Production scheduling behavior is preserved. Complete is identified as “label only”; actual lifecycle changes keep their canonical validation and side effects. |

## Atomicity and deliberate limitations

- Cancellation uses the existing shared line lock before authoritative ownership
  reads. Job changes, routing, timers, events and parent synchronization share the
  caller's transaction. Cancellation lock/statement bounds are 3/15 seconds.
- Required-owner transitions now fail closed instead of logging and continuing.
- Existing PostgreSQL constraints reject duplicate active owners. Tests also
  preserve mixed active and terminal history without deleting it.
- The current unique station identity includes terminal station rows. The
  canonical router will not create a new same-station row by rewriting canceled
  history. Such cancellation is rejected and rolled back; use canonical Return
  for Correction for retained work. A legacy null-station-ID owner can receive a
  distinct canonical queued successor. No alternative ownership model or schema
  change was introduced.
- A replay of a historical canceled job does not automatically repair its line.
- No invoice/payment changes occur for cancellation that retains the line.
  Actual commercial removal continues existing canonical invoice synchronization
  and immutable paid-history adjustment policy.
- Parent synchronization uses the existing operational-child service. A terminal
  or inconsistent parent requiring historical review is not silently reopened.
- HTTP failures are not automatically replayed. Staff must refresh authoritative
  state before retrying an uncertain request.

## Filters and labels

The server's Open list and sidebar share `state = open` plus tenant scope.
Complete label text/catalog key no longer hides an open Order. Production
Complete, Closed and Canceled remain separate canonical state filters. Search
and pagination are applied server-side; explicit customer, date, priority and
status-label filters remain effective.

The existing temporary proof/production UI filters still apply to loaded rows
with explanatory UI. This patch does not redesign those filters or alter stored
Order state. A cosmetic Complete pill remains assignable under existing policy,
but is visibly identified as **Complete (label only)**, with a workflow disclaimer.

The corrective-removal dialog distinguishes commercial removal from retaining
work. It explains that no replacement will be created, history/artwork is kept,
and Return for Correction is the alternative. A rejected request leaves its
reason and dialog intact, with an inline accessible error.

## Historical diagnostic and any future repair

The existing Owner-only read-only consistent-snapshot diagnostic already combines
`TERMINAL_HISTORY_WITH_REMAINING_OBLIGATION`, resolved active owners, canonical
quantity projections, bootstrap counts, run membership, audits and parent state.
Terminal history by itself is not an orphan: a valid replacement can coexist with
that informational finding. Regression coverage confirms this distinction.

No diagnostic writer, repair worker, backfill or live repair was added.

Order 20779 still needs separate authorized MAIN record inspection before a
repair can be proposed. A future exact preview must identify tenant/Order/line/job
IDs, relevant later edits and audits, whether each 2-unit line is genuinely a
duplicate or still owed, run/file/financial consequences and the canonical
transition proposed. Removing a genuine duplicate and routing still-owed work
are different decisions. Any live mutation requires separate explicit Owner
authorization. Do not fabricate produced quantities or delete canceled history.

## Focused validation

- Scoped TypeScript: 15 changed TS/TSX roots; 8192 MB heap. No full-codebase check.
- Focused server/shared contracts: 99 passing tests. Two stale source assertions
  were aligned with existing tenant-keyed badge queries, and terminal routing
  fixtures now explicitly specify historical dependencies. No business rule was
  changed to satisfy them.
- Focused client tests: 17 passing tests, including cosmetic Complete versus
  actual lifecycle, optimistic assignment rollback and canonical closed display.
- Real isolated PostgreSQL: 19 cancellation/filter/financial cases, plus 15
  existing production-integrity and 24 recent Close Job regressions. Synthetic
  schema/data only, canonical migrations, loopback-owned disposable cluster.
- Cancellation cases include replacement, unavailable/failed routing rollback,
  caller transaction rollback, duplicate concurrent submissions, both cancellation
  versus reassignment lock orders, run membership, true line removal, retained
  artwork/history, editable Invoice snapshot synchronization, unchanged paid
  history, proof/bypass guards, tenant and permission boundaries, diagnostic
  classification, actual status-label assignment, Open search and pagination.
- Browser: actual `OrderStatusPillSelector` and `OrderLineItemsSection`, synthetic
  local HTTP only, normal zoom, light/dark, explicit reason, disabled confirmation,
  successful opening of corrective workflow and visible rejection with retained
  reason. This is not deployed API/database/browser readback.
- `git diff --check` and protected migration-history integrity check.

Reproduce PostgreSQL with
`scripts/qa/test-inbound-postgres.ps1 -TestPaths @('server/tests/productionCancellationIntegrity.postgres.integration.ts','server/tests/productionIntegrity.postgres.integration.ts','server/tests/closeJobOverrideRegression.postgres.integration.ts')`.
Browser fixture entry: `e2e/local-production-cancellation/fixture.tsx`, served by
the existing local workflow fixture server. It blocks external and unsupported
mutation requests.

## Release boundary

DEV code only. MAIN, live Order 20779, other business records, the AI Gateway
worktree, and PrintersHero-Prepress repository remain untouched. No migration,
worker activation or historical repair. Auto-deployment is not observed here;
operator DEV/MAIN acceptance remains outstanding.
