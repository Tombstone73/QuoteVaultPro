# M7.5I-C — Multi-Invoice Payment Aggregate

## Disposition

PASS WITH FINDINGS — the dev source now models one real-world Payment as one immutable payment fact with one or more immutable Invoice allocations. It is deployable but has not been live-validated in DEV or connected to a provider in this milestone.

## Canonical model

- `v2_billing_payments` remains the one tender/provider transaction; its existing `invoice_id` is a deterministic compatibility anchor only.
- `v2_billing_payment_allocations` is the authoritative per-Invoice relationship. Migration `0270_v2_payment_allocation_aggregate` removes the historical one-allocation restriction and enforces one allocation per `(payment_id, invoice_id)`.
- Every allocation is positive exact integer cents. Aggregate creation rejects duplicate Invoice IDs, mixed Customers, mixed currencies, void Invoices, over-allocation, and unauthorized principals.
- Old one-Invoice payments are backfilled idempotently. The migration aborts instead of guessing if historic payment/allocation evidence is ambiguous.

## Provider and webhook boundary

- The aggregate checkout path persists a provider-operation `allocation_intent` before Stripe is called.
- Pending provider allocation intent reserves the mutable Invoice balance for a competing aggregate checkout; failed pre-creation operations release that reservation by entering `failed` state.
- One aggregate checkout creates one Stripe PaymentIntent for the server-derived total. Stripe metadata names the provider operation and organization; it does not carry the allocation list.
- A signed provider success materializes one Payment plus all persisted allocations atomically. Provider-event and operation-request identities make retries/replayed webhooks idempotent.
- Portal endpoint: `POST /v2/portal/payments/stripe/payment-intents` accepts a bounded allocation intent and derives organization/customer access from the authenticated portal principal. It never accepts a customer, organization, total, or provider identity from the browser.

## Settlement, lifecycle, and compatibility

- Invoice reads, ledger/history, sales open-balance reads, cancellation blockers, and automatic lifecycle reconciliation use allocation amounts rather than payment compatibility anchors.
- Every affected Invoice is reconciled after aggregate payment materialization. An Order with multiple active Invoices is financially settled only when all are settled.
- Legacy single-Invoice payment endpoints remain supported and persist one allocation through the same aggregate persistence behavior.

## QuickBooks and refunds

- QuickBooks exports one V2 Payment as one QuickBooks Payment with one linked line per Invoice allocation, using one stable `PMT-*` identity.
- Refunds for a multi-Invoice Payment intentionally fail closed. Manual/provider refunds continue only for a Payment with exactly one allocation; allocation-aware reversal/refund evidence is a follow-up requirement.

## Portal behavior

- Customers can select bounded eligible Invoices, enter exact-cent partial allocations, see one total, and prepare one card payment.
- Client feedback prevents obvious invalid quantities and mixed currencies, while the server remains authoritative for balances, scope, eligibility, and provider initiation.
- Payment state updates only after signed Stripe confirmation; the UI does not loop per-Invoice PaymentIntents.

## Validation

- V2 and UI TypeScript checks passed.
- Root TypeScript check passed.
- Focused payment aggregate, portal invoice, QuickBooks queue, and portal aggregate-presentation tests passed.
- V2 import-boundary and migration-integrity checks passed after the append-only migration manifest was refreshed.
- Local Vite production build passed; it emitted the existing chunk-size advisory only.
- No authenticated DEV validation, provider call, production access, deployment, or MAIN action was performed.

## Remaining findings

- P1: implement allocation-aware multi-Invoice refunds/reversals before allowing those refunds.
- P1: perform authenticated DEV and Stripe test-mode end-to-end validation only under separately authorized provider scope.
- P1: complete remaining portal document/profile/product-configuration launch controls.
