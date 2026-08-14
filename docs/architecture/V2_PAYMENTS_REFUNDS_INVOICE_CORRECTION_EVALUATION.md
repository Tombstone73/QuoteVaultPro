# V2 payments, refunds, invoice correction, and customer exposure

Status: isolated PostgreSQL experiment on the operator-approved disposable clone.

## Executive verdict

**YES, WITH CONTAINED COMPATIBILITY — but incomplete for external-provider recovery.** V2 proves one invoice financial projection derived from invoice-line cents plus append-only payment/refund facts, transactionally serialized per invoice. It deliberately does not copy V1's generic header PATCH, payment deletion, or status-only refunds.

## Clone freshness

The V2-only safety gate accepted only `TEST_DATABASE_URL` with `V2_POSTGRES_INTEGRATION=1`; no alternate database URL was exposed. Read-only preflight confirmed `organizations`, `users`, `user_organizations`, `customers`, `orders`, `order_line_items`, `invoices`, `invoice_line_items`, `payments`, `payment_webhook_events`, and `global_variables`, all required finance columns, and extant invoice lines. No V1 schema was changed.

## Current V1 reconstructed

V1's strongest path is manual payment: advisory lock, transaction, and provider-idempotency uniqueness. However, generic invoice PATCH can set header cents independently of invoice lines (ARCH-013); non-draft invoices are more locked than the intended editable-unpaid rule; provider callbacks refresh rollups separately (ARCH-011); financial authorization is route-inconsistent (ARCH-024); and `current_balance`/credit transactions compete with exposure (ARCH-012). Refunds are a payment-row status, not a partial, parent-linked immutable event.

## V2 model

`PostgresFinancialLifecycleApplication` owns scoped application operations. Invoice lines are financial authority; invoice cents/decimal headers and `amount_paid`/`balance_due` are derived projections maintained in the same locked transaction. Canonical money is integer cents. Existing decimal fields are compatibility projections only.

V2-private tables:

- `v2_poc_financial_requests`: durable request hash/replay/conflict boundary.
- `v2_poc_financial_refunds`: append-only, payment-linked partial/full refund facts.
- `v2_poc_financial_reconciliations`: reserved durable provider/reconciliation seam.

Owner/admin organization membership is the V2 capability boundary for correction, metadata, payment, refund, history, and exposure. No V1 business service or repository is reused.

## Results

- Editable unpaid correction: line values and tax recompute subtotal/total/balance; arbitrary header mutation is not exposed.
- Metadata after payment: PO update preserves paid financial projections.
- Payments: partial/manual/multiple/provider-test payments derive partial or paid state and reject overpayment under transaction lock.
- Paid lock: financial correction rejects after net paid reaches total.
- Refunds: partial and full refunds preserve original payment, restore balance, reload as separate immutable facts, and serialize concurrent over-refund attempts.
- Idempotency: same provider-test event/request replays; conflicting content rejects; a fresh application instance reads/replays safely.
- Tenant isolation: foreign invoice payment/read attempts are not found under the caller's organization.
- Exposure: V2 uses invoice balances as the decision source, not `customers.current_balance` or the legacy credit ledger. This experiment does not yet include the existing unbilled-open-order exposure component.

## Explicit remaining limitation

The deterministic provider adapter is represented by a provider-test identity; this iteration has not yet implemented an external-success/local-finalization outbox processor or failure injection around the provider boundary. `v2_poc_financial_reconciliations` reserves the durable seam, but its processing/retry workflow remains the next required financial hardening step. No real provider was contacted.

## Compatibility scorecard

| Module / Repository | Existing tables used | Translation | Runtime result | Rating | Concern |
|---|---|---|---|---|---|
| Invoice | invoices | cents authority → decimal projections | correction/readback | GREEN | redundant V1 header fields |
| Invoice lines | invoice_line_items | line cents authoritative | correction | GREEN | V1 has no header/line constraint |
| Payments | payments | succeeded rows as payment facts | partial/multiple/concurrent | GREEN | provider callbacks still need outbox |
| Refunds/Reversals | payments + V2 private refunds | append-only parent-linked refunds | partial/full | YELLOW | V1 has no native refund table |
| Provider events | payments + request table | deterministic provider identities | replay/conflict | YELLOW | no external-outbox retry yet |
| Customer exposure | invoices | balance projection | scoped read | YELLOW | unbilled order component not proved |
| Financial idempotency | V2 request table | hash + result | fresh replay/conflict | GREEN | V2-only DDL |
| Financial reconciliation | V2 reconciliation table | reserved durable seam | not processed | YELLOW | required next hardening |

## Full-rebuild recommendation

The full parallel-rebuild thesis is **STRONGER**. V2 can maintain one invoice financial state, safely correct unpaid invoices, lock paid financials while retaining metadata edits, preserve refunds without deleting payments, prevent tested overpayment/over-refund, reject cross-tenant actions, and contain legacy schema in repositories. It is not yet a complete proof of provider-success/local-failure recovery or full customer-exposure parity; those are the recommended next experiment before promotion.
