# Staff invoice cache contract

The staff invoice hooks in `client/src/hooks/useInvoices.ts` own their React Query cache wiring. API and financial behavior comes from the existing server endpoints. Other hooks and pages can use the same keys, so both the array shapes and the invalidation filters are compatibility contracts.

## Read keys

| Query | Key | Activation and refresh |
| --- | --- | --- |
| List and paged list | `['invoices', filters]` | The legacy list keeps its optional filter slot. The paged list polls every five seconds while a visible row has a queued, processing, or retrying delivery. |
| Detail | `['invoices', id]` | Enabled with an ID. The request bypasses the browser cache and preserves the HTTP error status. |
| Payment history | `['invoicePayments', id]` | Enabled with an ID. The request bypasses the browser cache. |
| Refund requests | `['stripeInvoiceRefundRequests', id]` | Enabled with an ID and the caller's flag. |
| Email queue | `['invoices', 'email-queue', view, page]` | Enabled while open. Polls every five seconds while open with active jobs. |
| Email recipients | `['invoices', id, 'email-recipients']` | Enabled with an ID and the caller's flag. |
| Email draft | `['invoices', id, 'email-draft']` | Enabled with an ID and the caller's flag. Always refetches on mount with a stale time of zero. |
| Reminder history | `['invoiceReminderHistory', id]` | Enabled with an ID. |

## Ordered invalidations

Every invalidation uses React Query's default partial matching and refetch behavior. The calls are issued in the listed order without awaiting them. Each row uses `invoices` for `['invoices']`, `detail(id)` for `['invoices', id]`, `payments(id)` for `['invoicePayments', id]`, and `summary` for `['/api/operational-summary']`. Other single-element keys are shown by their literal value.

| Mutation | Ordered targets |
| --- | --- |
| Cancel email queue jobs | invoices, on settlement after either success or failure |
| Manual payment | `orders`, invoices, detail(id), payments(id), summary |
| Customer batch payment | `orders`, invoices, `payments`, `/api/customers/<customerId>/transactions`, then detail(id) and payments(id) for each input ID in order, then summary, `accounts-receivable-report`, `customerFinancialExposure` |
| Void invoice payment, initiate Stripe refund | `orders`, invoices, detail(id), payments(id) |
| Recover Stripe refund | `orders`, invoices, detail(id), payments(id), `['stripeInvoiceRefundRequests', id]`, summary |
| Create or delete invoice | `orders`, invoices |
| Create Order invoice | `orders`, invoices, `['invoices', { orderId }]` |
| Update invoice or refresh invoice status | `orders`, invoices, detail(id) |
| Retry QuickBooks sync | invoices, detail(id) |
| Queue QuickBooks sync | invoices, detail(id), summary, summary |
| Approve for accounting | invoices, detail(id) for each input ID in order, `quickbooksSyncQueue` |
| Apply invoice-scoped payment | `orders`, invoices, detail(id), summary |
| Mark sent / bulk mark sent | invoices, detail(id) for each input ID in order, summary, `/api/timeline` |
| Send invoice | invoices, detail(id), `['invoices', 'email-queue']`, summary |
| Resolve delivery review | invoices, `['invoices', 'email-queue']` |
| Apply or delete legacy payment | invoices, detail(id) |
| Send reminder | invoices, detail(id), `['invoiceReminderHistory', id]` |
| Batch send | invoices, summary |

All mutations in the table except cancellation refresh on success. Failed requests still propagate the existing endpoint-specific errors. Invoice send first marks the matching row as queued in each `invoices` cache with a non-null object in the second key slot. It handles both legacy arrays and paged lists and leaves detail and queue data to refetch. The EPS hosted-result hook also refreshes the existing Order projection and remains outside the staff invoice hook.

The hook tests exercise the configured callback and polling behavior with mocked HTTP and a local QueryClient. They cover matching, call order, counts, and the immediate send cache write. They do not measure browser scheduling, actual requests during an active refetch, or provider settlement.
