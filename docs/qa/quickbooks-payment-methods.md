# QuickBooks Sync Console payment methods

## Scope

The console keeps each existing payment allocation's sync ID and amount. The Payment Method column follows the canonical receipt header when linked to a valid, same-tenant, same-customer receipt. No payment, receipt, invoice, allocation, or QuickBooks posting behavior changes.

- Standalone payments use their recorded method.
- Missing/unrecognized methods and ambiguous receipt headers show Unknown. A single allocation method is not treated as evidence of a missing receipt-header method.
- Multiple distinct recorded allocation methods under a missing receipt header show Multiple, with keyboard-accessible details. An explicit receipt-header method remains authoritative.
- References use the recorded receipt reference, then the payment's reference/transaction identifiers. No invoice status or processor is used to infer a method.
- ACH includes the existing `ach` and `bank_transfer` identifiers. Other includes the existing `other` and `wire` identifiers; Wire remains labeled Wire in the table.
- Method filters apply before pagination and combine with existing search/status/type/eligibility/error filters. A specific method excludes invoice rows; All Methods preserves the existing invoice/payment list.
- Selection remains tied to original payment IDs across pages and filters. Organization/user changes clear it, and query caches include the organization.

## Focused validation

- 11 frontend tests: rendered methods/references/details, combined filters, paging reset, selection, existing console behavior and preferences.
- 40 backend/shared tests: filter normalization, canonical labels, existing selected-sync and Admin/Owner contracts.
- 16 real isolated PostgreSQL tests: actual route and query, all methods, receipt allocations, mixed/unknown history, full-dataset paging/search/status filtering, mismatched customer/tenant linkage, and unchanged accounting/audit readback. The list performs two batched SQL queries.
- Scoped TypeScript with an 8192 MB heap; no full-repository TypeScript run.
- Actual console and Radix controls checked in a local browser at normal zoom, light/dark themes and a 760-pixel viewport. API responses were synthetic; this was not a live QuickBooks or deployed DEV check.

No migration, remote database repair, payment posting, or QuickBooks transmission is required or performed by this change. Deployed DEV acceptance remains outstanding.
