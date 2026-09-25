# Invoice payment eligibility and billing ownership

## Policy

Customer single-invoice, guest, and grouped Stripe checkout require the existing
version-specific accounting approval. The existing canonical `legacy_synced`
exception is retained. Positive balance, tenant/customer scope, and existing
void/import/historical restrictions still apply. Portal list/detail and guest
pages consume the server's `paymentEligibility` projection; unapproved invoices
remain visible with an “Awaiting approval” state.

Authorized staff collection retains its existing financial eligibility policy.
This change does not introduce a staff approval override or alter allocations.

An arbitrary payment row, `appliedAt` default, or PaymentIntent reference is not
evidence that money moved. Successful/captured/refunded ledger state, payment
timestamps, allocated batch/credit entries, credit/refund records, existing
delivery checkpoints, accounting approval history, and QuickBooks/import history
continue to protect billing ownership. Automatic Order-created invoice markers
alone do not protect ownership.

## Session safety

Intent creation/reuse and billing-context changes share ordered, tenant-scoped
invoice advisory locks. Before a billing context or approval-invalidating version
change commits, `retireInvoicePaymentSessions` verifies outstanding intents in
their persisted Stripe account. Only unfunded `requires_payment_method`,
`requires_confirmation`, or `requires_action` intents are canceled. Already
canceled intents can be retired locally. Processing, authorization, captured
money, identity mismatches, missing initialization evidence, and provider errors
stop the edit with a specific conflict. Stripe calls have bounded timeouts.

The service cancels at Stripe before marking attempts/batches canceled. It never
refunds or deletes financial history. If Stripe cancellation succeeds but the
database transaction rolls back, the old intent stays safely canceled; checkout
checks its state before replacement. Owner transitions also revoke old guest
links. Order and Invoice owner updates remain in the same transaction.

Customer submission rechecks current eligibility before Stripe.js confirmation.
Cancellation during a concurrent edit closes the subsequent confirmation race:
either cancellation wins, or payment has started and the edit is refused.
Signed webhooks still reconcile money already received; an ineligible browser
confirmation cannot suppress legitimate processor reconciliation.

## Read-only MAIN observation, 2026-09-25

Starting source: `main`, `b9fec78c5`, clean working tree.

Invoice 20544 (`f3f14ee1-82f6-411c-bb6e-d937ddd7479f`) displayed total $250,
paid $0, remaining $250, Unpaid, Not sent, Approval Required, and Not Synced.
Its Payment History displayed one $250 Stripe card row, Pending, created by
Dale Hensley. The timeline displayed a portal PaymentIntent creation at 3:24 PM
and a misleading “Payment ... applied” entry at the same time.

The old Order guard queried any invoice payment row with no status predicate and
passed `paymentExists: !!payment`. The visible pending row is sufficient to
trigger the reported “has payment history” error, despite the zero-paid rollup.

Direct database/provider inspection was not completed. The exact payment row ID,
PaymentIntent ID/current provider status, and any records not exposed in the UI
(allocations, credits, refunds, attempt/session records) remain unverified.
No MAIN data or live Stripe objects were changed. Existing live secrets were not
canceled during source development; live correction remains a separate action.

## Validation boundary

Focused tests use mocked persistence/Stripe plus rendered React components.
They cover applied versus incomplete evidence, transactional owner rollback,
provider cancellation races, grouped membership approval, stale customer calls,
and preserved mobile diagnostics. No live payment or database test is implied.
No schema migration is required.

Production build passed. TypeScript retained the same 246 baseline diagnostics,
with no new diagnostic identities. Focused coverage: 148 server tests and 34
client tests passed. The database-backed customer identity/merge suite could not
run because no dedicated test database was configured; an inert loopback URL
refused the connection. DEV, MAIN behavior, physical iPhone, and real Stripe
cancellation/confirmation were not validated by this source task.
