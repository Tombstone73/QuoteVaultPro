# Shipment save acknowledgement and operational completion

## Source defects confirmed

The shipment editor verified saves with a value-based shipping-context readback,
but calculated dirty state with raw `JSON.stringify` on that context. PostgreSQL
JSONB can return different key ordering, leaving a verified save apparently dirty.
The tests now reproduce that with immutable query responses and reordered keys.
The dirty check uses the shared schema's canonical trimmed values. It retains
real edit differences, validation, save failures, retry identity and readback checks.

Refetching an immutable shipment also replaced the `orders` array and restarted
the linked-order loading effect after every autosave. A dispatch waiting for a
save could then encounter temporarily unavailable allocation readiness. That
effect now follows linked Order IDs and shipment status, not array identity.

Draft mutation responses update the shipment query cache, retaining existing
projection fields and rejecting older revisions. The editor adopts changed
carrier fields only where the operator has not edited them. Existing label
purchase, verified box mapping, void, retirement and external-cancellation
readbacks also update the draft's revision identity. Label purchase still leaves
the shipment DRAFT; sample labels and unresolved purchases remain nondispatchable.

The form is keyed by shipment ID. Unmounted save continuations cannot initiate a
dispatch, clear another record's save state, or recursively save the next record.
Mark as shipped can wait for an in-flight save; a synchronous request guard
prevents double-click initiation while waiting. New edits during a save still
require a later serialized save. Failed/unverified saves remain visibly failed,
with existing retry behavior and documents/actions blocked as appropriate.

## Production → fulfillment → operational completion

1. Canonical production completion finishes actual production work and routes
   its owner to Fulfillment. Production progress is not fabricated by shipping.
2. Staff confirm ready quantities, allocate packages or a pickup handoff, and save
   the reviewed draft. Draft allocations and purchased labels fulfill no quantity.
3. Mark shipped saves/verifies the latest draft and executes the existing guarded
   shipment operation. Pickup uses the existing quantity-aware immutable handoff.
4. Both physical mutation transactions now invoke the same narrow repository
   operational reconciler, before downstream billing. It locks the tenant-scoped
   parent and lines, reads canonical net shipment/pickup/administrative quantities,
   and excludes cancelled, bundle-summary and service-only obligations.
5. Partial fulfillment stays operationally active. When all required quantities
   are resolved, production quantity and active production/run checks must also
   pass. A real conflict raises a specific error and rolls back the terminal
   mutation; it does not silently complete unfinished production tasks.
6. Successful completion sets the existing `operationally_complete` projection,
   canonical `completed`, and removes Fulfillment routing. The lifecycle remains
   `production_complete`, unless already financially closed. A durable completion
   event is written once. Existing queue/Production Overview projections hide
   resolved work using these same net quantities. Fulfillment ownership/history
   is retained so a supported reversal can make remaining work visible again.

The reconciler is also reused by the existing Order auto-close service. That
service still requires settlement of every applicable invoice before changing
the lifecycle to `closed`. No new paid flags, payments, allocation engine,
invoice operation, carrier request, migration, or financial bypass was introduced.
Unpaid invoices remain unpaid. Existing fulfillment billing policy still invokes
canonical invoice creation/reuse after the physical transaction; existing invoice
identity/idempotency, no auto-send/no auto-payment behavior and accounting rules
remain unchanged. A downstream billing failure cannot undo physical completion.

Parent-before-line locking now also participates in pickup and terminal-reversal
writers. Reversal projection is re-read under those locks before updating status,
rather than writing a pre-transaction stale projection. Physical source evidence
is never deleted. Supported corrections restore net remaining quantities, the
ready canonical state and active visibility without changing posted invoices or
payments. The existing reversal protocol records immutable correction evidence
first and retries its derived projection on an idempotency replay; its crash
recovery and actual database concurrency still require PostgreSQL verification.

## What invoice-page Close Job does

The button is the existing Owner/Admin **Close Job Override**, not a payment.
It obtains a live eligibility preview, may explicitly complete/bypass production
or bootstrap missing production ownership with confirmation, and administratively
resolves remaining fulfillment obligations with an audit reason. It creates no
physical handoff evidence. Production completion can recompute billing readiness;
the historical fulfillment override suppresses terminal invoice automation and
does not finalize/send an invoice, mark one paid, or settle a balance. It can
run the existing paid-order closure check afterward. That final `closed` state
retains its existing terminal edit restrictions; operational completion alone
does not bypass financial rules or replace the explicit reopening policy.

**Close Job is no longer needed for normal, fully recorded shipment/pickup
completion.** It remains an explicit administrative exception for historical or
missing operational evidence, with its original permission and confirmation gates.
It must not be automatically invoked to hide unfinished production.

## Validation and limits

- 55 frontend tests passed, including immutable/reordered JSON readback, newer
  edits, dispatch waiting/deduplication, failures/retries, record switching,
  mocked carrier updates, cache revision ordering and document prerequisites.
- 126 server fixture/mocked/source-contract tests passed, including actual
  repository shipment/pickup mutations against a serialized in-memory adapter,
  mixed totals, cancelled quantities, partial fulfillment, idempotency, rollback,
  production conflicts, tenant boundaries, operational and financial closure,
  reversal from operational/closed states, board visibility and unchanged money.
- Scoped TypeScript passed on the five changed production files with an 8 GB heap.
- Broader regression runs found five pre-existing mismatches outside this change:
  one static legacy child-tenant predicate assertion, two obsolete method-change
  query mocks, one other method-change query mock in historical search, and an
  assertion expecting two QuickBooks auto-close wiring references where both
  baseline and current source have one. Those unrelated expectations were not
  loosened or removed. The method-guard source is identical to baseline.
- No configured `TEST_DATABASE_URL`, `DATABASE_URL`, or DEV QA login was available.
  These tests do not establish PostgreSQL lock/concurrency behavior, actual
  persisted database results, browser acceptance, carrier integration, or deployed
  DEV/MAIN behavior. No labels were bought, notifications sent, real jobs edited,
  or financial transactions executed. No historical data was backfilled.
