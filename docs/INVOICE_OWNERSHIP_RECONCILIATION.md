# Invoice ownership consistency and historical review

Native Order-backed reads retain the existing canonical Order Customer projection. Before new payment or QuickBooks transmission, stored Invoice ownership must agree. A mismatch requires staff reconciliation; a read never repairs a financial record.

The normal Order header command updates a mutable linked Invoice in the same transaction, retires unfunded old-owner sessions, and audits both identities. Reselecting the current Order Customer also checks for a stale Invoice. Existing payment, delivery, approval and external-history protections still apply. Ordinary commercial recalculation no longer writes billing owner fields. Contact-only transitions retain their existing guarded path.

Unsynced grouped payment queue rows display the batch Customer. A disagreement among Order, Invoice and batch blocks queue transmission eligibility and produces an accounting review message. Synced rows and provider history are not rewritten. Export guards separately compare stored Invoice ownership and batch payer before any external write.

## Read-only historical proposal

Run with an explicitly selected database connection and at least 8 GB Node heap:

```powershell
$env:NODE_OPTIONS='--max-old-space-size=8192'
npx.cmd tsx scripts/audit-invoice-ownership.ts <organization-id> <invoice-id> <actor> <reason>
```

`DATABASE_URL` must already be set securely. The script uses a repeatable-read, read-only transaction and a 15-second statement timeout. It supports **no apply mode**. Its JSON result contains blockers, an audit proposal, an identity-only patch if eligible, and preserved financial values. It does not write an audit row, alter a ledger, call Stripe, or call QuickBooks.

The proposal requires a recorded old-to-new Order ownership event before batch creation, original portal payer evidence, provider success evidence, exact allocation membership and amounts, and one canonical Customer across all allocations. A stale-owner payment already exported to QuickBooks blocks reconciliation. An Invoice export is a separate checkpoint: its external CustomerRef must be verified by accounting before any local correction. The planner conservatively blocks whenever that external Invoice reference remains; it is not a general-purpose historical repair command.

An old generic `UPDATE` event without Customer before/after values is insufficient chronology. Do not substitute the current Order Customer or a guessed date. Correctly owned/exported sibling allocations must remain untouched. If blockers exist, obtain the missing evidence and design the explicit audited accounting correction separately; never bypass the planner with a direct database UPDATE.

No schema migration is required.
