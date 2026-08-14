# V2 provider financial reconciliation

## Verdict

**FINANCIAL ARCHITECTURE MOSTLY PROVEN.** The isolated V2 experiment proves the local recovery boundary after a provider outcome is durably accepted: local payment/refund application is idempotent after restart and cannot cause a second provider action.

## V1 failure intentionally removed

V1 Stripe/EPS flows persist provider/payment state, invoice rollup, and webhook completion in separate commits. A failure between them can leave a stale invoice and confirmation retry may not repair it. V2 instead records a normalized provider-success receipt in `v2_poc_financial_reconciliations` before any local financial effect. No raw provider payload or secret is stored.

## V2 flow

`provider adapter success → recordProviderSuccess (durable PENDING receipt) → reconcileProviderOutcome → existing V2 canonical payment/refund operation → invoice projection → COMPLETED`.

The receipt has organization, invoice, operation, provider, globally unique provider event ID, provider transaction/refund ID, amount/currency, normalized request data, attempts, result, and sanitized error. Replayed event identity with changed invoice/amount/provider object conflicts. The local operation's durable request identity makes a crash after local application but before completion marking safe: recovery replays the same local result and marks the receipt complete.

## Runtime results

- Payment success + injected failure before local finalization: no payment; PENDING receipt; fresh process applies exactly once.
- Refund success + injected failure after local effect/before completion: original payment remains; fresh process replays the existing local refund exactly once and completes receipt.
- Duplicate delivery after recovery: stable receipt replay; no duplicate local effect.
- Two processors racing: PostgreSQL row locking plus invoice advisory lock and local request idempotency produce one payment effect.
- Tenant isolation: outcome recording/reconciliation is organization-scoped Owner/Admin-only; conflicting global `(provider,event)` identity is rejected.
- Invoice balance/status and invoice-derived exposure recover from persisted payment/refund facts.

## Compatibility scorecard

| Area | Existing Tables Used | V2-Private Structures | Runtime Result | Rating | Concern |
|---|---|---|---|---|---|
| Provider event ingestion | payments | financial reconciliations | durable/replay/conflict | GREEN | pre-provider-intent gap remains |
| Payment reconciliation | invoices, payments | requests/reconciliations | restart exact-once | GREEN | completion is retryable two-step |
| Refund reconciliation | invoices, payments | append-only refunds/reconciliations | restart exact-once | GREEN | V1 has no native refund relation |
| Worker concurrency | invoices | reconciliation row + request | one local effect | GREEN | no scheduler included |
| Financial rollup | invoice lines/invoices | none | canonical existing operation | GREEN | V1 projections remain compatibility fields |
| Customer exposure | invoices | none | recovered balance drives exposure | GREEN | unbilled-order component not repeated |
| Tenant isolation | organizations/memberships | scoped receipts | foreign access rejected | GREEN | provider account scope future work |

## Remaining work

This POC intentionally does not solve the earlier gap where a process dies *after a real provider succeeds but before a durable receipt is recorded*. Production needs a durable pre-provider intent with the provider idempotency key, then an adapter query/replay contract. It also needs a scheduler/operator surface for `PERMANENT_FAILURE`, provider-account scoping, and production provider adapter validation. No V1 business service/repository was reused.

## Full-rebuild verdict

**STRONGER.** The major ARCH-011-style stale payment/invoice boundary is materially reduced for the proven receipt-to-local-finalization path. The next highest uncertainty is Quote → Order conversion, not another finance redesign.
