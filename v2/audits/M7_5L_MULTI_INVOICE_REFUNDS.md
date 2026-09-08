# M7.5L — Allocation-aware multi-invoice refunds

## Result

`PASS WITH FINDINGS` for the V2 Billing domain. A canonical Refund is now one immutable aggregate with one or more allocation facts tied to immutable Payment allocations. Historical one-invoice Refunds remain valid and are backfilled into append-only evidence without changing historic rows.

## Authority and invariants

- The new `0271_v2_refund_allocation_aggregate` migration drops the obsolete one-allocation-per-Refund constraint and adds `v2_billing_refund_allocation_evidence`.
- Evidence contains the Refund allocation, original Payment allocation, derived Invoice, exact-cent amount, and organization. It is immutable and foreign-key scoped.
- Backfill inserts only deterministically provable old facts. Missing or mismatched historic relationships abort migration rather than guessing.
- The Billing application accepts `{ paymentAllocationId, amount }` entries. It locks payment allocations and Invoices, derives Invoice identity server-side, rejects cross-customer/currency/void facts, caps each allocation at its remaining refundable amount, and uses one idempotent operation request.
- Invoice settlement, finance ledger/history, sales balance reads, customer activity, invoice email/document reads, portal commercial Order balance, and Order lifecycle settlement read allocation evidence rather than the legacy Refund anchor.

## Compatibility and accounting

- The old per-Invoice refund endpoint remains a compatibility adapter and writes the same evidence model.
- `v2_billing_refunds.invoice_id` is retained strictly as a compatibility anchor; it is never used as settlement authority for new aggregate Refunds.
- The current QuickBooks CreditMemo/Disbursement projection safely supports exactly one allocation. Multi-allocation Refunds fail closed before a provider call with `QUICKBOOKS_REFUND_ALLOCATION_EXPORT_UNSUPPORTED`; they remain retryable accounting work until a dedicated allocation-aware QBO projection is implemented.
- No provider calls, database execution, or production mutation occurred for this milestone.

## API and operator boundary

- `POST /v2/organizations/:organizationId/finance/refunds` accepts one bounded set of payment-allocation ids and exact-cent amounts; callers cannot nominate arbitrary Invoice ids.
- Existing Finance invoice controls continue to use the compatibility adapter. A dedicated cross-invoice allocation-selection workspace and Stripe aggregate initiation remain the next bounded UI/provider follow-up; they are not hidden behind a fake “refund all” control.

## Validation

- `tsc -p v2/tsconfig.json --incremental false` passed.
- `tsx v2/tests/infrastructure/refundAllocationAggregate.pure.ts` covers the migration, allocation-lock contract, route boundary, and QBO fail-closed guard.
- Migration integrity manifest refreshed and verified through migration 0271.
