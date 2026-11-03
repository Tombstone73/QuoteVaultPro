# Grouped payment history

## Canonical identities

- Manual multi-invoice payments and grouped Stripe payments already have a `customer_payment_batches` receipt and `payments.customer_payment_batch_id` invoice allocations.
- Customer advances are already durable receipts in `customer_account_credits` (`customer_advance`), linked through credit applications to their internal invoice settlement rows. Applying existing funds is not another cash receipt. Courtesy/issued credits remain distinct from cash receipts.
- Historical invoice-only payments remain independent. Matching dates, amounts, freeform references, names, or provider strings do not prove a common original receipt. No parents are backfilled or invented.
- Tenant and canonical customer ownership must agree before a batch/advance can group allocations. Unverifiable batch allocations remain separate with a review notice. Source records are never repaired by this display.

## Display/read behavior

`paymentReceiptHistoryService` provides a shared read-only projection for Customer Transactions and global Payments. PostgreSQL groups once before search and pagination and returns rows/counts/totals from one statement snapshot. Searching an invoice retains the full receipt and all its allocations.

Both screens use `PaymentReceiptDetails`, a compact native keyboard-operable disclosure with canonical invoice links, statuses, allocated funds, and any verified unapplied remainder. Refunds/voids are retained, never presented as newly available cash. A receipt containing refunds remains discoverable with the customer Refunds filter. Conflicting allocation totals show an unknown remainder with a review notice.

The immutable staff payment audit may separately prove tendered money and returned change. Such values are used only when the audit identifies this exact tenant/batch and reconciles to the retained batch amount. Returned change is not unapplied funds. Missing or malformed audits never cause reconstructed amounts.

The global summary now explicitly says **Payment History Entries** and **Net Receipts**. Allocations are not additional receipt totals. Customer financial summaries and dashboard collection calculations retain their existing canonical contracts. Net receipt history can differ from gross dashboard collections, especially for refunds and held advances.

No migrations, payment writers, ownership records, posting dates, invoice balances, processor calls, QuickBooks sync, or historical accounting records changed.

## Validation

- Scoped TypeScript, 8192 MB heap, changed runtime/test/fixture files only.
- Focused frontend tests cover both actual screens and the shared disclosure, plus the existing multi-invoice payment dialog and URL/filter contracts.
- Focused allocation, canonical batch, invoice rollup, grouped Stripe finalization/refund, and payment-list tests.
- Real repository-owned disposable PostgreSQL: $500 Cash App receipt allocated $200/$175/$125; single payments; partial/unapplied balances; amount/date/customer/method/reference/invoice search; whole-group pagination; refunds/voids; settled Stripe versus pending attempts; ambiguous history; customer and tenant isolation; advances/application reversal; audited change and malformed audits. The actual customer and global routes are exercised. Before/after reads confirm source payments, batches, invoices, and audits are unchanged.
- Local Chrome at 100% zoom, 1440×1000: actual Customer Transactions and Payments pages; collapsed/expanded groups, keyboard toggling/focus, invoice URLs, search, light/dark screenshots. Browser API data is synthetic/mocked; PostgreSQL evidence comes from the separate integration tests.
- One obsolete finance test assertion was narrowed from all dashboard “This Week” text to the specific Payments `datePreset=this-week` URL, preserving the existing unrelated dashboard period filter.

Browser reproduction: `node e2e/local-payment-receipts/verify.mjs`.

## Remaining acceptance

DEV/MAIN live behavior and production-scale query performance remain unverified. Historical receipts without authoritative parent identity remain separate. The disposable database is stopped and removed after validation.
