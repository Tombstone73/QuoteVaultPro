# DEV Physical Schema Reconciliation Audit

## Executive Summary

**Historical DEV verdict: physical DEV did not fully match the current PrintersHero runtime contract.**

The original read-only audit confirmed **five findings**: **one P0**, **two P1**, and **two P2 migration-history integrity gaps**. The previously reported quote-artwork allocation drift and pickup-handoff contract were physically present; the `line_item_file_status.retired` repair was not.

Forward migration `0178_reconcile_runtime_critical_schema_contracts` has now repaired SCHEMA-001, SCHEMA-002, and SCHEMA-003 on an explicitly authorized disposable Neon clone. The migration runner, startup postconditions, rollback-only behavioral checks, quote-conversion/contact-only integration suite, and a new read-only catalog audit all passed on that clone. This is **disposable-clone proof only**: real DEV is not yet live-validated and must not be described as repaired until normal deployment completes and a brand-new clone from deployed DEV independently passes the read-only reconciliation.

The V2 ledger is useful as an execution hint, but it is **not trustworthy by itself as evidence of schema correctness**. It contains later migration records while omitting earlier journal timestamps, and the runner's timestamp-based selection makes missed backfilled migrations permanently ineligible without an explicit later repair.

The V2 ledger remains useful as an execution hint, but it is **not trustworthy by itself as evidence of schema correctness**. It contains later migration records while omitting earlier journal timestamps, and the runner's timestamp-based selection makes missed backfilled migrations permanently ineligible without an explicit later repair.

The three runtime defects are now covered by a forward migration and permanent physical postconditions. Deploy that migration before relying on hard deletion of disposable orders, contact-only order creation/conversion, or artwork retirement/prepress removal in DEV. SCHEMA-004 and SCHEMA-005 remain historical P2 auditability findings.

## Audit Basis

| Item | Value |
|---|---|
| Original audited DEV SHA / `origin/dev` | `2b8133a2abbc539e109c929100e196d84d7acf57` |
| Repair starting DEV SHA / `origin/dev` | `a285945aed2150723f058a0d063df241c1344f34` |
| `origin/main` inspected (not modified) | `29a3a1edbaf60a3d255e02a14a4ac54aefa7f102` |
| Working tree at audit start | Clean |
| Active V2 journal before repair | 173 SQL files / 173 journal entries; latest `0177_repair_quote_attachment_production_allocation` |
| Active V2 journal after repair | 174 SQL files / 174 journal entries; latest `0178_reconcile_runtime_critical_schema_contracts` |
| Physical source | User-authorized disposable 24-hour Neon DEV-shaped clone; database name omitted from this document |
| Original audit database access | PostgreSQL catalog and supporting data `SELECT`s only, each in `BEGIN READ ONLY` / `ROLLBACK`; `transaction_read_only=on` confirmed |
| Repair validation database access | Migration runner applied only 0178; behavioral fixture writes were rollback-only; catalog re-audit was `BEGIN READ ONLY` / `ROLLBACK` |
| Audit date | 2026-08-14 (America/Indianapolis) |

No production, Railway credential, or MAIN database was accessed. The repair validation used only the explicitly authorized disposable clone. No historical migration was rewritten and no application schema was manually edited outside the new forward migration.

Before repair, the clone had the current latest V2 ledger timestamp (`1788048000024`, migration 0177) and exhibited the known DEV drift. After 0178, its ledger advanced to `1788048000025` and the three repaired physical contracts matched. It remains a clone-validation target, not proof of live DEV deployment.

## Full Findings Register

| ID | Severity | Domain | Expected | Physical | Migration State | Runtime Impact | Recommendation |
|---|---|---|---|---|---|---|---|
| SCHEMA-001 | P0 historical; repaired on clone | Production / orders | `production_runs.order_id` has exactly one FK to `orders(id)` with `ON DELETE SET NULL` | Before repair: both `production_runs_order_id_fkey ON DELETE CASCADE` and `production_runs_order_id_orders_id_fk ON DELETE SET NULL`; after 0178 clone: exactly one `SET NULL` FK and no direct cascade FK | 0158 attempted to replace only the latter constraint name; 0153 created the original implicit `production_runs_order_id_fkey`, so it survived. 0178 now identifies the relationship by catalog columns, removes duplicates/non-SET-NULL variants, and retains/adds one intended FK. | Before repair, hard delete could cascade production history. The canonical delete boundary now returns typed `ORDER_DELETION_PRODUCTION_HISTORY` / 409 whenever production job/run/member history exists; disposable orders still delete. | Deploy 0178, then obtain a brand-new live-DEV clone and rerun exact catalog plus behavioral proof. |
| SCHEMA-002 | P1 historical; repaired on clone | Artwork / prepress | `line_item_file_status` contains `active`, `superseded`, `retired` | Before repair: only `active`, `superseded`; after 0178 clone: all three values exactly once | 0150 (`ALTER TYPE ... ADD VALUE IF NOT EXISTS 'retired'`) has no physical ledger timestamp while later entries exist; 0178 adds the required value idempotently. | Before repair, active retirement callers would fail on normal `status='retired'` writes. Rollback-only clone validation persisted a retired file and verified resolver exclusion of retired/superseded projections. | Deploy 0178 and rerun read-only enum/value audit on fresh live-DEV clone. |
| SCHEMA-003 | P1 historical; repaired on clone | Orders / customer identity | `orders.customer_id` is nullable; runtime validates customer **or** contact | Before repair: `orders.customer_id` was `NOT NULL`; after 0178 clone: nullable with existing customer/contact FKs preserved | 0151 (`DROP NOT NULL`) is absent from the ledger while later entries exist; 0178 applies the physical nullability repair. | Before repair, supported contact-only order creation/conversion could fail. Clone validation proved customer-backed and contact-only persistence; the focused quote conversion suite passed its contact-only cases. | Deploy 0178 and repeat contact-only order/conversion checks against a fresh live-DEV clone. |
| SCHEMA-004 | P2 | Migration system | Every active journal migration has a physical ledger identity/timestamp, or a documented immutable baseline exception | Nine journal timestamps are absent while later timestamps exist: `0001`, `0003`, `0004`, `0015`, `0016`, `0017`, `0149`, `0150`, `0151` | V2 ledger has 175 rows / 174 distinct timestamps vs 173 active journal entries; 0149 was later repaired, 0150/0151 were not | Ledger progression alone can falsely declare an incomplete schema current | Reconcile history only through a reviewed repair plan; do not rewrite ledger as a substitute for physical postconditions. |
| SCHEMA-005 | P2 | Migration system | Active migration files and physical ledger hashes form an auditable immutable history | Canonical Git-LF comparison found 15 current source hashes absent from the ledger and 13 ledger hashes with no current source equivalent | Representative physical contracts for the historic hash gaps are mostly present; this is an auditability/integrity gap, not automatically a runtime defect | Source-file mutation/duplicate/manual ledger history prevents a ledger-only proof of what ran | Freeze applied migration contents; validate source hash set in CI and use new repairs rather than editing historical migration files. |

### Expected vs Physical Matrix

The reusable script at `scripts/db/auditPhysicalSchema.ts` emits JSON with this core comparison matrix and fails closed when its required `TEST_DATABASE_URL` is missing or equals an application/migration URL.

| Domain | Object | Object Type | Runtime Expected | Migration Expected | Physical DEV | Result | Severity |
|---|---|---|---|---|---|---|---|
| Organization/auth | `user_organizations` | PK/FKs/role enum | Composite membership identity and tenant-role enforcement | V2 baseline/portal migrations | Present; composite PK, cascade FKs, required role values | MATCH | — |
| Customers/contacts | `customer_contact_links` | FKs/partial uniques | Active pair and one-primary relationship invariants | 0079/0109 | Present | MATCH | — |
| Products/PBV2 | `pbv2_tree_versions` | tables/enums/FKs/indexes | Active/draft tree ownership and product pointer | PBV2 migrations | Present; active/draft partial uniqueness and active-tree FK | MATCH | — |
| Quotes/artwork | quote allocation fields | columns/check/index | Allocation quantity/group/role used in conversion | 0149, repaired by 0169/0170/0177 | Present with correct types, default, positive check and group index | MATCH | — |
| Orders | `orders.customer_id` | nullability | Customer or contact identity | 0151, forward-repaired by 0178 | Pre-repair clone `NOT NULL`; post-0178 clone nullable | MATCH on clone / live DEV pending | P1 historical |
| Artwork/prepress | `line_item_file_status.retired` | enum value | Retirement state | 0150, forward-repaired by 0178 | Pre-repair clone missing; post-0178 clone present | MATCH on clone / live DEV pending | P1 historical |
| Production | `production_runs.order_id` | FK | One `SET NULL` FK | 0153/0158, forward-repaired by 0178 | Pre-repair clone conflicting CASCADE and SET NULL FKs; post-0178 clone exact SET NULL FK | MATCH on clone / live DEV pending | P0 historical |
| Fulfillment | pickup handoffs | tables/FKs/check/index | Partial pickup quantity and replay safety | 0175/0176 | Present, including positive quantity check and partial request unique | MATCH | — |
| Billing/payments | payment identifiers/webhooks | unique indexes | Provider idempotency, transaction and webhook identities | 0081 and legacy/baseline | Present | MATCH | — |
| Background/integrations | storage, QB, bridge, notifications | tables/FKs/uniques | Worker/integration persistence | 0007+, 0132 and legacy/baseline | Present for inspected active contracts | MATCH | — |
| Migration ledger | journal vs physical ledger | history | Complete immutable identity set | V2 journal | Missing and non-current historical identities | MIGRATION HISTORY GAP | P2 |

## Domain Findings

### Organization, Authentication, and Tenant Isolation

Inspected `organizations`, `users`, `user_organizations`, and authorization-relevant enums/FKs. The membership composite PK, organization/user cascade FKs, member roles (`owner`, `admin`, `manager`, `member`), organization statuses, and unique organization slug are present. Supporting data checks found no user with more than one default membership. No current-runtime physical mismatch was found.

### Customers, Contacts, and Credit

`customers`, `customer_contacts`, `customer_contact_links`, and `customer_credit_transactions` exist with the runtime-required ownership FKs and active relationship partial unique indexes. Supporting tenant-consistency checks found no cross-tenant relationship rows. No credit-policy redesign conclusion is implied by this audit.

### Products, PBV2, and Pricing

`products`, `pbv2_tree_versions`, and PBV2 option-group templates exist. Active/draft version uniqueness and the product active-tree FK are physically present; PBV2 lifecycle enum values match the runtime. No current mismatch was found.

### Quotes and Quote Artwork

The quote allocation repair is verified: `quote_attachments.production_quantity` is nullable `integer`, `production_group_id` is nullable `varchar(128)`, and `production_role` is `varchar(16) NOT NULL DEFAULT 'artwork'`. The positive-quantity CHECK, group index, and quote/line/organization FKs are present. Equivalent order attachment and line-item-file allocation projections, checks, and indexes are also present.

### Orders and Order Lines

The pre-repair clone did not support the contact-only identity contract: current `shared/schema.ts` and canonical order validation allow a contact without a customer, while `orders.customer_id` was `NOT NULL`. Migration 0178 makes the column nullable. The rollback-only clone fixture proved both normal customer/contact ownership and contact-only order persistence; the focused quote-routing/conversion integration suite passed the supported contact-only conversion path. Live DEV still requires a post-deployment clone proof.

### Artwork, Proofing, and Prepress

Proof/prepress tables, their primary/foreign keys, and canonical artwork relationships are present for the inspected current contracts. Before repair, `line_item_file_status.retired` was absent (SCHEMA-002), making file retirement writes fail. Migration 0178 adds it idempotently. The disposable clone accepted a `retired` line-item-file row and the current resolver returned only active production projection rows while excluding retired and superseded rows; a different tenant resolved nothing.

### Production

Production-run/member quantity, outcome, recovery, file-strategy, and uniqueness contracts are present. Before repair, SCHEMA-001 left a historic cascade FK in addition to the intended `SET NULL` FK. Migration 0178 removed that dangerous duplicate relationship. The repository-level hard-delete guard locks the scoped order and rejects deletion with `ORDER_DELETION_PRODUCTION_HISTORY` / 409 if a production job, run, or run member exists; rollback-only clone validation confirmed all five protected records remain and a genuinely disposable order deletes. Cancellation remains a separate workflow operation.

### Fulfillment and Shipping

Migration 0175/0176 is physically complete: `pickup_handoffs` and `pickup_handoff_items` exist with required FKs, positive item-quantity CHECK, `client_request_id`, and the partial `(organization_id, pickup_ticket_id, client_request_id)` unique index. Shipment package/reference and fulfillment checklist contracts inspected from 0173 are also present.

### Billing, Invoices, and Payments

The live provider reconciliation integrity contracts are present: `payments` has organization/provider/idempotency and transaction uniqueness plus Stripe intent uniqueness; `payment_webhook_events` has the provider/event unique index. Current invoice/payment columns and FKs inspected in the runtime path are present. No billing physical mismatch was found.

### Background and Integration Infrastructure

Inspected active persistence for audit logs, accounting sync, outbound pickup notifications, storage jobs, local bridge agents/destinations/copy jobs, and integration connections. Required tables, selected FKs, and core durable uniqueness constraints are present. No mismatch was found.

## Known Repairs Verification

| Contract | Physical result |
|---|---|
| Quote attachment production allocation (0149 / 0177) | **Verified present.** Fields, default, check, and index match the intended repair. |
| Order attachment and line-item-file allocation repairs (0169 / 0170) | **Verified present.** Fields, positive checks, and group indexes exist. |
| `line_item_file_status.retired` (0150) | **Pre-repair missing; post-0178 disposable clone match.** Active/superseded values remain intact. |
| `orders.customer_id` contact-only identity (0151) | **Pre-repair NOT NULL; post-0178 disposable clone match.** Column nullable; existing customer/contact FKs remain present. |
| `production_runs.order_id` non-destructive FK (0153 / 0158) | **Pre-repair conflicting CASCADE + SET NULL; post-0178 disposable clone match.** Exactly one `SET NULL` FK, no direct cascade path. |
| Pickup handoffs / idempotency (0175 / 0176) | **Verified present.** Tables, FKs, quantity check, and partial unique exist. |
| Fulfillment packages/references (0173) | **Verified present** for inspected current columns, package relations, and integrity indexes. |

## Migration Ledger Reconciliation and Root Cause

The V2 journal has 173 checked-in SQL files and 173 entries; its current `when` values are strictly monotonic. Numeric gaps (45–49 and 155) and duplicate `0162` filename prefixes are informational because Drizzle identifies the migration stream through ordered journal entries/timestamps, not filename numbers.

The physical V2 ledger has 175 rows, 174 distinct `created_at` timestamps, and a latest timestamp equal to current 0177. Nine current journal timestamps are absent from the ledger, while later timestamps exist. Canonical Git-LF source comparison also found 15 active source hashes absent from the ledger and 13 ledger hashes without a current source counterpart. Representative effects of most historical gaps are physically present, so this is not a claim that all gaps are live defects. It is decisive evidence that the ledger cannot prove physical correctness.

The root cause is evidence-backed by `server/runMigrations.ts` and Drizzle's PostgreSQL dialect: the migrator compares an incoming migration's journal `when` to the **maximum** ledger `created_at`; it does not reconcile a complete set of tags, hashes, or physical postconditions. Once a higher timestamp is recorded, a backfilled migration with an older `when` is silently ineligible. The runner itself documents the historical 0034 case. The V2 baseline/manual-ledger utilities further allowed bookkeeping rows without a complete physical contract proof. Existing release checks are a helpful curated subset but do not check enum members or the contact-only order column.

This supports **A + B + C**: historical manual/baseline ledger state and a timestamp-driven migration runner/journal ordering weakness. There is no evidence here to claim a non-transactional DDL failure or deployment interruption.

## Recommended Repair Order

1. **Deploy 0178 to DEV:** it repairs SCHEMA-001/002/003, adds runner postconditions, and preserves production history by rejecting hard deletion once production history exists.
2. **Re-clone and audit DEV:** after deployment, create a brand-new DEV clone and run only the read-only catalog reconciliation. Treat any remaining P0/P1 result as a release blocker.
3. **SCHEMA-004/005 (P2):** retain historic evidence, do not rewrite ledger history merely to make it look complete, and use the new append-only/immutability preflight for all future migrations.

## Recommended Permanent Safeguard

Use a small combination rather than a large framework:

1. Keep startup checks for a narrow boot-critical subset. 0178 adds enum-value, nullable-column, and exact-FK postcondition types and covers all three repaired contracts.
2. Run `scripts/db/auditPhysicalSchema.ts` in CI/deploy validation against a fresh disposable DEV clone. It uses only `TEST_DATABASE_URL`, opens `BEGIN READ ONLY`, emits JSON, and fails closed on a missing/wrong source or contract discrepancy.
3. Add per-migration postconditions for high-risk migrations (tenant ownership, financial idempotency, lifecycle enums, artwork allocation, production/fulfillment quantities) and verify them before promotion.
4. Run `npm run db:migrations:v2:preflight` in CI. The committed migration-history manifest fails closed for changed protected SQL/journal metadata and lower-timestamp/backfilled entries; reviewed future migrations must be strictly later appends before refreshing the manifest.

Snapshot-only comparison is insufficient because baseline/compatibility schema is intentional; runtime-critical catalog assertions provide a smaller, sustainable signal.

## PROD Before MAIN Promotion Checklist

Do **not** use application credentials in CI output and do **not** run DDL. Against a separately authorized production read-only connection, run the following before the next MAIN promotion:

1. Confirm the active app SHA/journal and physical V2 ledger timestamp/hash inventory; report only redacted identity metadata.
2. Confirm `line_item_file_status` includes `retired`.
3. Confirm `orders.customer_id` is nullable and that the current customer/contact FKs remain valid.
4. Confirm `production_runs.order_id` has exactly one FK and it is `ON DELETE SET NULL`; verify no cascade FK remains.
5. Re-run allocation repair checks for `quote_attachments`, `order_attachments`, and `line_item_files` including positive checks and group indexes.
6. Re-run 0175/0176 pickup handoff table/FK/CHECK/partial-unique checks.
7. Re-run payment/webhook provider and idempotency unique-index checks.
8. Verify current tenant membership, PBV2 active-pointer, production-run/member, shipment package, and invoice/payment critical contracts with a read-only catalog script.
9. Compare journal timestamps and canonical migration hashes to the physical ledger; triage every mismatch as a documented bootstrap exception, repair migration, or deployment blocker.
10. After DEV deploy, create a fresh clone and confirm 0178's ledger row plus the three exact postconditions before promoting to MAIN.

## Validation Performed

- Git branch, original HEAD, `origin/dev`, `origin/main`, and clean working tree verified before the original audit.
- `git fetch origin --prune` completed; MAIN was not changed.
- `npm run db:migrations:v2:preflight` passed after repair: 174 active entries have strictly monotonic `when` values and all protected migration history is unchanged.
- Migration 0178 ran through the application migration runner on the authorized disposable clone; all 55 startup release checks passed.
- The post-repair read-only physical audit reported MATCH for SCHEMA-001/002/003 and every other audited runtime-critical contract. Its only remaining report is the pre-existing SCHEMA-004 journal-timestamp history gap.
- Rollback-only disposable clone validation passed: protected production-history delete rejected with typed 409 and no partial cleanup; disposable order deletion succeeded; customer/contact and contact-only identity persisted; retired enum/resolver lifecycle and tenant isolation behaved as intended. A separate two-session check proved the repository's `FOR UPDATE` order lock blocks a concurrent production-job insert before the hard-delete decision can proceed.
- Focused quote routing/conversion integration passed against the authorized disposable clone, including contact-only conversion cases.
- Focused static suites passed: `schemaReconciliationRepairs`, `migrationRuntimePostconditions`, and `migrationHistoryIntegrity` (10 passed; safe-test-name-gated duplicates skipped because the disposable database uses a neutral name).
- TypeScript validation, production build, and `git diff --check` passed.
- Parallel static/runtime, migration-history, and physical-catalog domain reviews completed.
- The original reconciliation queries were read-only. Repair validation applied exactly the approved forward migration and used rollback-only fixture transactions; no DEV/PROD database was written.
- This repair milestone adds one forward migration, migration safety tooling/CI, physical postconditions, deletion guard, focused tests, and this updated audit. No historical migration was changed.

## Remaining Unknowns

- The database was a user-supplied DEV-shaped clone; no provider-side clone provenance metadata was available to independently prove the instant it was created.
- This audit intentionally did not access PROD. PROD requires the checklist above before MAIN promotion.
- Historical ledger/source hash differences need a separately approved reconciliation decision; they should not be normalized by replaying or editing old migrations.

**Status:** deployable but not yet live-validated. The disposable clone proof does not establish that real DEV has applied 0178; a fresh clone from deployed DEV is the next required reconciliation step.
