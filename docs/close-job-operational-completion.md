# Close Job Override operational completion

## Status decision

V1 lifecycle states are `open`, `production_complete`, `closed`, and `canceled`.
The existing operational completion action already uses `production_complete`
with routing cleared (or `invoicing` when appropriate). Its old legacy status
projection incorrectly remained `ready_for_shipment`. `completed` is also the
legacy projection of financially closed Orders and is treated as terminal by
legacy edit/transition code. Neither is an accurate unpaid operational label.

This change retains the existing lifecycle and adds the persisted status
projection `operationally_complete`. A successful administrative reconciliation
has `state=production_complete`, `status=operationally_complete`,
`canonicalState=completed`, and no fulfillment routing. Final `state=closed`
continues through the existing invoice settlement policy. No enum/constraint or
schema migration is required: these columns are unconstrained varchar columns.

The existing administrative fulfillment ledger consumes remaining quantities.
The compatibility fulfillment status remains `delivered`; the administrative
event and ledger distinguish this from physical evidence. No shipment, pickup
receipt, carrier event, or payment is created. Remaining fulfillment station
owners are retired with their IDs recorded in the administrative event.

## 20492 code trace

The reported symptom follows directly from the previous reconciliation:
it cleared canonical remaining fulfillment through the administrative ledger,
set fulfillment to delivered, and cleared routing, but never updated Order
status. Auto-close then declined financial closure when invoices were unpaid.
Its zero-remaining early return also prevented a retry from fixing the parent.
Production completion writers could later project ready-for-shipment again.

The corrected reconciliation updates the parent and ledger in one transaction,
repairs a zero-remaining stale parent, and avoids duplicate events on retry.
Production writers preserve operational completion. Physical fulfillment also
projects operational completion before downstream financial closure is assessed.
This is a code/fixture regression analysis, not a live inspection of 20492.

## Consumers audited

| Consumer | Result |
| --- | --- |
| Production and bootstrap | Existing line ownership/bootstrap/material/run completion remains authoritative; active owners/runs block fulfillment reconciliation. |
| Fulfillment | Canonical quantities are actually consumed; zero remaining and retired station owners remove actionable work. |
| Order Detail and Orders list | Operationally Complete takes precedence over an old operational pill. |
| Dashboard | Persisted status and workflow category reflect completion; actionable due predicates exclude the new status. |
| Portal | Administrative operational completion displays Completed before physical delivery labels. |
| Reports/workflow | Legacy category mapping recognizes the new status; generic transitions cannot override canonical completion. |
| Invoice lists | Existing Fulfillment Complete projection still works from the unchanged lifecycle/fulfillment fields. |
| Finance/QuickBooks | No invoice, tax, payment, approval, send, or QuickBooks mutation is introduced. |
| Automations | Financial auto-close remains downstream; historical repair suppresses all auto-close/billing callbacks. |

## Explicit historical repair

Use `scripts/reconcile-close-job-operational-completion.ts` with the intended
environment's `DATABASE_URL` and `ORGANIZATION_ID`. `ORDER_ID` is an optional
UUID scope for dry runs and is mandatory for apply. Public numbers are display
data, not mutation identifiers.

```powershell
# Read only, database-enforced REPEATABLE READ snapshot:
npx tsx scripts/reconcile-close-job-operational-completion.ts

# Separate, explicitly authorized action after reviewing one ORDER_ID:
npx tsx scripts/reconcile-close-job-operational-completion.ts --apply
```

Discovery requires the durable `FULFILLMENT_HISTORICAL_RECONCILED` event with
administrative source and explicit no-physical-evidence/no-billing flags, plus
the matching Order audit type in the same organization and Order. A status,
age, invoice state, or production-only partial override is never proof.

Dry runs report Order number/state/status, evidence IDs, production and
fulfillment remaining, fulfillment type/status, proposed operational status,
invoice status/balance (informational), active owners, candidate/safety flags,
and blockers. Correct Orders are reported as unchanged. Rows lacking one side
of the evidence pair are blocked; an explicit ORDER_ID can inspect such a row.

Reopened/canceled parents, active production owners or combined runs, missing
line projections, or line edits after override evidence require manual review.
The timestamp gate deliberately rejects ambiguous clerical edits too. Missing
production may be repaired only through the existing historical production
repair and its original-actor, ownership, bootstrap, and combined-run gates.

Apply locks the parent and its lines, re-inspects the evidence and obligations,
then reuses production repair and the corrected fulfillment service within one
transaction. A failure rolls the whole repair back. A second application to a
correct Order performs no state changes or inserts. Closed Orders stay closed;
the repair does not independently trigger financial closure or automation.
The older fulfillment backfill entry point delegates to this same guarded path.

No live dry run or live repair was performed for this milestone. MAIN data was
not touched. Candidate counts and the current live state of 20492 remain unknown.
Concurrency is covered by transaction/locking design and fixture retry tests;
real PostgreSQL contention has not been rehearsed.

## Milestone validation

- Production build: passed; existing bundle-size warnings remain.
- TypeScript: 248 diagnostics, compared with 249 at the starting commit.
  No new diagnostic messages; the refactored reconciliation return removed its
  existing spread-type diagnostic. Unrelated baseline errors were not changed.
- Automated tests: 135 focused server tests, 11 client tests, and six additional
  production-completion/run contract tests passed (152 distinct tests).
- Broader fulfillment-method suite: two failures reproduce using the service
  from starting commit `57e1a4a55`; its old mocks lack `listLineEligibility`.
- Local validation: in-memory service/ledger workflows and jsdom status
  rendering; no real PostgreSQL workflow or live browser validation. The CLI's
  apply-without-ORDER_ID guard was exercised without connecting to a database.
- Migration preflight: all 208 protected migrations unchanged; no new migration.
- DEV/MAIN validation: not performed. Live historical candidates: unknown.
