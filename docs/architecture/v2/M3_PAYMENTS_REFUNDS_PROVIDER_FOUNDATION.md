# M3 Payments / Refunds / Provider Recovery Foundation

## Ownership and immutable facts

Billing owns Payments, Payment allocations, Refunds, Refund allocations, provider financial operations, and provider event identity. Sales and Fulfillment do not receive settlement fields or transitions. A successful Payment and a successful Refund are independent append-only facts; a Refund never reduces or replaces the original Payment.

The 0207 schema records integer-cent amounts and ISO currency only. One successful Payment allocates its full amount to its Invoice. One successful Refund allocates its full amount against its original Payment. PostgreSQL constraints, tenant-scoped foreign keys, and immutable-history triggers reject updates/deletes and retain history with `RESTRICT` references.

## Settlement and concurrency

Settlement is derived at transaction time as `issued invoice gross - payment allocations + refunds`; it is not a mutable Invoice field or Invoice lifecycle state. The current policy rejects a Payment exceeding collectible balance and a Refund exceeding the original Payment less prior refunds. Each financial command locks the issued Invoice first, then locks its financial records where needed. This serializes payment/payment and payment/refund decisions for an Invoice and extends the prior Billing ordering: Sales Order -> Invoice for issuance; Invoice -> financial records for settlement.

## Idempotency, audit, and outbox

Manual Payment, Refund, and provider-operation initiation use the existing M0 operation-request reservation. Matching request/payload replays the canonical result; a mismatched payload is rejected. Each successful manual fact records shared V2 Audit and a transactional durable outbox signal, then completes the operation request. Failure hooks on the persistence runner are reserved for transaction rollback rehearsals; coupled writes share one PostgreSQL transaction.

## Provider recovery seam

Provider activity is not a Payment. `v2_billing_provider_financial_operations` carries the local request identity, provider idempotency key, intended amount, provider transaction identity when known, and `pending | succeeded | failed | uncertain` reconciliation state. Initiation is deliberately marked `uncertain`: a timeout is neither a failed charge nor a confirmed payment. A later trusted provider adapter can correlate and confirm it.

Provider event IDs and provider transaction identities are organization/provider scoped. Payment callback and reconciliation evidence converge through `ProviderPaymentReconciler` into the same `confirmProviderPayment` operation; the equivalent `ProviderRefundReconciler` resolves only the original Refund operation. Unknown evidence is retryable and failed evidence cannot create a Payment or Refund. No provider credential, PAN, CVV/CVC, raw webhook payload, or other payment-card data is retained; the persisted provider values are correlation identifiers and idempotency keys only.

Two reconciliation executions may both observe a successful provider result for one uncertain operation. PostgreSQL's Invoice-first financial lock order then serializes canonical confirmation; the waiting worker observes the committed Payment and completes without emitting a second financial fact, Audit business fact, or business outbox fact.

An `unknown` provider status leaves the original operation `uncertain`, creates neither a Payment nor a failure fact, and remains retryable without resubmitting a charge. A later success for that same operation materializes one canonical Payment. A definitive `failed` status terminally marks the original operation failed and creates no successful Payment fact.

Canonical provider Payment confirmation is one PostgreSQL transaction: provider Payment, allocation, reconciliation state, Audit, outbox, and M0 completion either commit together or roll back together. A failed confirmation remains unresolved and retryable; retrying the same legitimate confirmation then creates exactly one canonical success.

Provider Refund confirmation follows the same canonical transaction. A successful provider Refund is a new immutable Refund fact with one allocation against the original Payment; it never mutates that Payment or the issued Invoice checkpoint. Repeated provider Refund evidence converges to that one Refund, one success Audit, and one business outbox fact. Refund reconciliation checks the original refund operation; callback/reconciliation and two reconciliation-worker executions use PostgreSQL's Invoice-first lock order and converge to one Refund result. An `unknown` result remains retryable without creating a Refund or consuming refundable value; a later success on that same operation creates one Refund, while a definitive failed result creates no successful Refund fact. Failure injection proves the Refund, allocation, Audit, outbox, provider-resolution state, and M0 completion share that transaction: a rollback leaves the operation uncertain and retryable, with the original Payment and issued checkpoint unchanged; a later same-request retry creates exactly one successful Refund result.

Distinct provider Refund operations also serialize through the Invoice-first financial lock order before evaluating the original Payment's refundable amount. A losing over-refund request rolls back without a Refund, allocation, success Audit, success outbox, or M0 completion; the original Payment remains immutable.

Distinct provider Refund event IDs may describe one provider Refund transaction. Both evidence records are retained, while canonical Refund materialization converges through the shared provider operation and transaction identity to one immutable Refund, Audit, and business outbox fact.

## Boundaries and deferrals

The issued Invoice checkpoint, Sales Order, and Fulfillment handoffs remain unchanged. Invoice number allocation is not required because financial records attach to the canonical Invoice ID. Void remains undefined; a future Void policy must consider successful payments and refundability. Credit memos, rebills, arbitrary adjustments, accounting/QuickBooks sync, real provider SDK/network integration, webhook transport, reconciliation-worker scheduling/lease management, and Delivery/PDF remain deferred.

## Authenticated UI and HTTP integration

The authenticated V2 UI exposes an Invoice settlement workspace and a global Payments ledger. Both are projections of immutable PostgreSQL facts: Invoice gross, paid, refunded, collectible balance, chronological Payment/Refund history, and per-event balance-after values are calculated in the server-side read model. React receives integer-cent values for display only and never calculates or persists financial truth.

`GET /v2/organizations/:organizationId/finance/overview`, `.../ledger`, and `.../invoices/:invoiceId` require the separate `payment.view` capability introduced by additive migration 0208. `POST .../payments` remains governed by `payment.record`, while `POST .../refunds` remains governed by `refund.issue`; all three routes use the trusted host principal, organization scope, CSRF middleware, and the existing M0 business-request identity. The route accepts only exact positive integer cents and approved manual methods (`cash`, `check`, `external`). It accepts no card data, provider credentials, PAN, CVV/CVC, or fabricated provider result.

The mutation routes delegate to `BillingPaymentsApplicationService`, so Invoice-first locks, amount/currency checks, M0 replay, Audit, outbox, and PostgreSQL transaction atomicity remain the correctness authority. A manual Refund targets an existing Payment and produces a separate Refund fact; it cannot rewrite the Payment or issued Invoice checkpoint. The finance grids keep sort/order/width preferences only in browser-local storage; preferences contain no financial data and are not a cross-device persistence claim.

## Validation evidence

The guarded PostgreSQL clone rehearsal has 507 assertions. It retains the 47-assertion Billing lifecycle proof (exact cents, manual settlement, M0 replay, immutable Payment history, authority/tenant isolation, and no Fulfillment mutation) and proves canonical Payment and Refund confirmation, duplicate event and transaction convergence, callback/reconciliation and two-worker lock-wait convergence, `unknown -> success` and terminal failure recovery, collectible/refundable-limit serialization, exactly-once Audit/outbox effects, tenant-scoped correlation, and four failure-injection boundaries for each provider confirmation. At every rollback boundary, financial facts, allocations, Audit, outbox, provider-success state, and M0 completion disappear together; the same legitimate request can then retry to one canonical success. The clone-backed billing browser regression additionally proves CSRF rejection, issued Invoice navigation, capability bootstrap, manual Payment and Refund UI/API flow, history/settlement refresh, and ledger navigation.
