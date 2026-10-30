# Combined DEV release preparation — 2026-10-30

The user authorized pushing all five pending work areas to DEV after the deployed
revision audit. Existing DEV starts at `41aa8305a32fcea3caa35e322d0f3a036f142a85`.
MAIN is outside this release. Acceptance testing remains paused and all email
automation controls remain off.

## Included work

- Email intake through `cd7a04312`, preserving the earlier milestones.
- Assistant PO corrections and clarification through `39e9df8c0` (including `22e3d2645`).
- Unstarted production-to-Prepress return: `56767bfa9`.
- QuickBooks structured state/province import and dry-run tooling: `5af63eba5`.
- Shipment save acknowledgement and operational completion: `6b8ec0378`.

Only these identified branches and current DEV are integrated. Other worktrees and
unfinished branches are preserved. No customer repairs or acceptance actions are
part of the push.

## Reviewed migration reconciliation

DEV's published journal and protected SQL through `0242_redo_customer_charges`
are the authoritative shared history. They are retained without changing their
indices, timestamps, tags or SQL. The four email migrations have never been
shared/deployed. Their SQL is moved byte-for-byte (Git-canonical LF) to a strictly
later journal append:

| Original feature identity | Integrated release identity |
| --- | --- |
| 0240_inbound_email_processing_jobs | 0243_inbound_email_processing_jobs |
| 0241_inbound_versioned_fingerprint_width | 0244_inbound_versioned_fingerprint_width |
| 0242_inbound_email_import_recovery | 0245_inbound_email_import_recovery |
| 0243_inbound_gmail_acknowledgements | 0246_inbound_gmail_acknowledgements |

New journal indices are 242–245, with timestamps 1793577600000,
1793664000000, 1793750400000 and 1793836800000. The integrity anchor starts from
the exact published DEV anchor and its normal `--refresh` command verifies the
unchanged shared prefix before recording the four later appends. No guard is
weakened, no applied migration is renamed, and no database ledger is rewritten.
Original feature identities and contents remain available in their preserved Git
commits. The isolated test database is disposable and is recreated normally.

SQL SHA-256 evidence after LF normalization, unchanged from `cd7a04312`:

```text
0243 3d717c4fa0e361c9f231eef9da8ff66bc930a98ce37c0c9e3a4c892bc66d4022
0244 57d3632d25ef287c272d114012fc1953da9f3a50a4d65dbe9335696a99678c80
0245 35638ac6fa9a54ba026a90cbf5c948db4e89a930e9ebb16fc245659fb8f778b9
0246 e3323c9cf840a30a8e75c2de3f1e14d38ca7415e506f96390830f3c51cc9e3b9
```

The historical seven DEV ledger discrepancies documented in
[the initial preflight](inbound-email-dev-rollout.md) are not repaired or stamped.
They predate this release and do not justify replaying old migrations. The new
append must be checked against actual DEV prerequisites and the canonical runner
must execute it during deployment. Local synthetic-foundation tests alone are
not deployed-schema compatibility evidence.

## Controls and rollback

Retain `WORKERS_ENABLED=false`, unset email worker gates and all enrollment
allowlists, and keep the existing mailbox disabled. No Google consent, Gmail
writes, customer notification, accounting sync, label purchase or financial
transaction is authorized as part of this integration. The callback fix uses
the verified DEV web origin to generate
`https://api-dev.printershero.com/api/inbound-orders/email/mailboxes/gmail/callback`.
Google's registration still requires separate verification.

The standard Git push starts deployment automatically. Do not wait for deployment
or resume end-to-end acceptance under this push-only instruction. Report static,
automated, database-rehearsal and deployed acceptance evidence separately.

To disable, retain the global kill switch and mailbox enrollment off. Preserve
durable queues and committed Orders; do not drop new tables or rewrite migration
history. A code rollback can restore the previous verified DEV revision while
retaining the additive schema. In-flight provider effects require manifest review
before any retry. MAIN configuration and history remain unchanged.
