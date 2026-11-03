# Payment entry reconciliation

## Contracts

The existing customer payment batch is the retained receipt; its payment rows are invoice allocations. No ledger, migration, refund writer, or historical accounting record is added or repaired.

The dialog uses the shared canonical allocator for immediate exact-cent previews, including original due/issue dates for oldest-first ordering. Custom edits survive preview refreshes. Posting waits for a current server preview and retains the existing explicit confirmation, now including customer, received amount, method, date/time, reference, every eligible invoice allocation, applied total, remaining balance, and change.

This canonical payment flow supports returning change, not retaining excess as credit. Staff must explicitly choose to return excess; otherwise posting is disabled. Holding funds uses the existing Customer Advance operation. Example: $500 received, $475 allocated, $25 returned; batch retained amount is $475, audit records $500 tendered/$25 change, no credit is created.

The new optional expected-allocation snapshot is passed through the existing route and canonical writer. Under existing locks, changed balances or allocation ordering reject before financial writes. Existing callers without the snapshot retain their contracts. Same-key replay returns the original posting. The existing grouped QuickBooks synchronization hold remains unchanged; this release does not enable grouped accounting sync.

## History

Earlier grouped history remains intact. Canonical Stripe refunds with a verified original payment ID, same tenant/invoice/provider, and nonconflicting batch association now appear under that original receipt. Refunds are not additional original receipts or new unapplied cash. Refund-date filters preserve the whole group. Invoice counts count distinct invoices. Unverified historical references remain separate. Both history screens show receipt date/time.

## Validation

- Scoped TypeScript with 8192 MB heap; changed runtime/test/fixture files only.
- Focused dialog/helper/disclosure/finance component tests: live totals, malformed currency, explicit excess choice, rich confirmation/cancel, card configuration safeguards, failed posting with retained custom fields and stable retry key.
- Canonical allocation, batch, and Stripe reconciliation contract regressions.
- Disposable local PostgreSQL, actual route → canonical writer → fresh database/history readback: exact single payment, multi-invoice/change, oldest-first exact cents, custom/zero allocations, stale balances, changed allocation order, invalid/empty snapshots, same-key retries, date/reference/notes, existing QuickBooks hold, customer/tenant boundaries, verified partial refunds and invalid foreign/invoice references. Existing read-only grouped-history regressions also pass, including advances, reversals, ambiguous history, no writes, and whole-group search/pagination.
- Local Chrome, 100% zoom, 1440×1000, light/dark: actual payment dialog, partial/custom/change totals, explicit excess handling, confirmation cancellation, failed post with retained fields, same-key retry. Actual customer/global history screens retain keyboard disclosures, invoice links and whole-group search.
- Browser API and persistence are mocked fixtures. Database posting/readback is separately proved by real isolated PostgreSQL tests. No remote customer/accounting data or provider mutation is used.

Browser commands: `node e2e/local-payment-receipts/verify-entry.mjs` and `node e2e/local-payment-receipts/verify.mjs`.

## Remaining acceptance

DEV/MAIN live behavior, deployed date/time presentation, real gateway delivery, QuickBooks accounting review, and production-scale query performance are unverified. History without reliable identity remains separate. No deployment wait or live verification is performed.
