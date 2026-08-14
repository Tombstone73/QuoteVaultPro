# DEV Physical Schema Reconciliation Audit

## Executive Summary

**Verdict: physical DEV does not fully match the current PrintersHero runtime contract.**

The audit confirmed **five findings**: **one P0**, **two P1**, and **two P2 migration-history integrity gaps**. The previously reported quote-artwork allocation drift has been repaired physically, and the pickup-handoff contract is physically present. The `line_item_file_status.retired` repair is still missing physically despite later migration ledger progress.

The V2 ledger is useful as an execution hint, but it is **not trustworthy by itself as evidence of schema correctness**. It contains later migration records while omitting earlier journal timestamps, and the runner's timestamp-based selection makes missed backfilled migrations permanently ineligible without an explicit later repair.

Fix the P0 foreign-key conflict before continuing workflow bug fixes that rely on safe order deletion. Fix the two P1 physical mismatches next. Ordinary application bug fixing can continue only away from order deletion, contact-only order creation/conversion, and artwork retirement/prepress removal; those workflows should be treated as blocked until surgical schema repairs are deployed and re-audited.

## Audit Basis

| Item | Value |
|---|---|
| Current DEV SHA / `origin/dev` | `2b8133a2abbc539e109c929100e196d84d7acf57` |
| `origin/main` inspected (not modified) | `29a3a1edbaf60a3d255e02a14a4ac54aefa7f102` |
| Working tree at audit start | Clean |
| Active V2 journal | 173 SQL files / 173 journal entries; latest `0177_repair_quote_attachment_production_allocation` |
| Physical source | User-supplied disposable Neon DEV-shaped clone; database name `neondb`; connection string omitted |
| Database access | PostgreSQL catalog and supporting data `SELECT`s only, each in `BEGIN READ ONLY` / `ROLLBACK`; `transaction_read_only=on` confirmed |
| Audit date | 2026-08-14 (America/Indianapolis) |

No production, Railway credential, application `DATABASE_URL`, or MAIN database was accessed. No schema, data, runtime code, or active migration was changed.

The clone has the current latest V2 ledger timestamp (`1788048000024`, migration 0177) and exhibits the known DEV drift. That establishes it as a useful DEV-shaped audit target, but not as a schema-correct baseline.

## Full Findings Register

| ID | Severity | Domain | Expected | Physical | Migration State | Runtime Impact | Recommendation |
|---|---|---|---|---|---|---|---|
| SCHEMA-001 | P0 | Production / orders | `production_runs.order_id` has exactly one FK to `orders(id)` with `ON DELETE SET NULL` | Both `production_runs_order_id_fkey ON DELETE CASCADE` and `production_runs_order_id_orders_id_fk ON DELETE SET NULL` exist | 0158 attempted to replace only the latter constraint name; 0153 created the original implicit `production_runs_order_id_fkey`, so it survived | The owner/admin `DELETE /api/orders/:id` route can delete an order and cascade-delete production runs and their members, contrary to the runtime contract and audit-history preservation intent | Ship a surgical FK repair: verify both names, drop the cascade FK, retain one `SET NULL` FK; then catalog-test the exact constraint set. |
| SCHEMA-002 | P1 | Artwork / prepress | `line_item_file_status` contains `active`, `superseded`, `retired` | Only `active`, `superseded` exist | 0150 (`ALTER TYPE ... ADD VALUE IF NOT EXISTS 'retired'`) has no physical ledger timestamp while later entries exist | Active retirement callers (`orderLineItemFiles.routes`, `prepressFiles.routes`, artwork repair and production-run services) will fail on a normal `status='retired'` write | Add a surgical, idempotent enum repair migration and a permanent enum-value postcondition. |
| SCHEMA-003 | P1 | Orders / customer identity | `orders.customer_id` is nullable; runtime validates customer **or** contact | `orders.customer_id` remains `NOT NULL` | 0151 (`DROP NOT NULL`) is absent from the ledger; later entries are present | Contact-only order creation/conversion is a supported current path and will fail its insert constraint | Add a surgical nullable-column repair with an explicit postcondition and focused contact-only order test. |
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
| Orders | `orders.customer_id` | nullability | Customer or contact identity | 0151 | `NOT NULL` | PHYSICAL DIFFERENT | P1 |
| Artwork/prepress | `line_item_file_status.retired` | enum value | Retirement state | 0150 | Missing | PHYSICAL MISSING | P1 |
| Production | `production_runs.order_id` | FK | One `SET NULL` FK | 0153/0158 | Conflicting CASCADE and SET NULL FKs | PHYSICAL DIFFERENT | P0 |
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

The contact-only identity contract is not present physically: current `shared/schema.ts` and canonical order validation allow a contact without a customer, while `orders.customer_id` remains `NOT NULL`. This is SCHEMA-003.

### Artwork, Proofing, and Prepress

Proof/prepress tables, their primary/foreign keys, and canonical artwork relationships are present for the inspected current contracts. `line_item_file_status.retired` is absent (SCHEMA-002), making file retirement writes fail. The runtime value is declared in `shared/schema.ts`, and current code writes it in normal cleanup/promote/recovery workflows.

### Production

Production-run/member quantity, outcome, recovery, file-strategy, and uniqueness contracts are present. The exception is SCHEMA-001: physical `production_runs.order_id` retains a historic cascade FK in addition to the intended `SET NULL` FK. This is not a harmless legacy extra because the active owner/admin order-delete path can invoke the cascade.

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
| `line_item_file_status.retired` (0150) | **Still missing.** This is SCHEMA-002. |
| Pickup handoffs / idempotency (0175 / 0176) | **Verified present.** Tables, FKs, quantity check, and partial unique exist. |
| Fulfillment packages/references (0173) | **Verified present** for inspected current columns, package relations, and integrity indexes. |

## Migration Ledger Reconciliation and Root Cause

The V2 journal has 173 checked-in SQL files and 173 entries; its current `when` values are strictly monotonic. Numeric gaps (45–49 and 155) and duplicate `0162` filename prefixes are informational because Drizzle identifies the migration stream through ordered journal entries/timestamps, not filename numbers.

The physical V2 ledger has 175 rows, 174 distinct `created_at` timestamps, and a latest timestamp equal to current 0177. Nine current journal timestamps are absent from the ledger, while later timestamps exist. Canonical Git-LF source comparison also found 15 active source hashes absent from the ledger and 13 ledger hashes without a current source counterpart. Representative effects of most historical gaps are physically present, so this is not a claim that all gaps are live defects. It is decisive evidence that the ledger cannot prove physical correctness.

The root cause is evidence-backed by `server/runMigrations.ts` and Drizzle's PostgreSQL dialect: the migrator compares an incoming migration's journal `when` to the **maximum** ledger `created_at`; it does not reconcile a complete set of tags, hashes, or physical postconditions. Once a higher timestamp is recorded, a backfilled migration with an older `when` is silently ineligible. The runner itself documents the historical 0034 case. The V2 baseline/manual-ledger utilities further allowed bookkeeping rows without a complete physical contract proof. Existing release checks are a helpful curated subset but do not check enum members or the contact-only order column.

This supports **A + B + C**: historical manual/baseline ledger state and a timestamp-driven migration runner/journal ordering weakness. There is no evidence here to claim a non-transactional DDL failure or deployment interruption.

## Recommended Repair Order

1. **SCHEMA-001 (P0):** remove the conflicting cascade FK from `production_runs.order_id`; preserve the intended `SET NULL` FK and add a constraint-set postcondition.
2. **SCHEMA-002 (P1):** add `line_item_file_status.retired` through a new, idempotent migration; validate the enum value physically.
3. **SCHEMA-003 (P1):** make `orders.customer_id` nullable through a new migration; add a contact-only order integration test.
4. **SCHEMA-004/005 (P2):** create an approved ledger-reconciliation plan after the physical repairs; do not rewrite history merely to make the ledger look complete.

## Recommended Permanent Safeguard

Use a small combination rather than a large framework:

1. Keep startup checks for a narrow boot-critical subset, but add enum-value support and cover every newly introduced critical column/constraint.
2. Run `scripts/db/auditPhysicalSchema.ts` in CI/deploy validation against a fresh disposable DEV clone. It uses only `TEST_DATABASE_URL`, opens `BEGIN READ ONLY`, emits JSON, and fails closed on a missing/wrong source or contract discrepancy.
3. Add per-migration postconditions for high-risk migrations (tenant ownership, financial idempotency, lifecycle enums, artwork allocation, production/fulfillment quantities) and verify them before promotion.
4. Treat applied migration SQL as immutable. Use later repair migrations for corrections, and reconcile journal/ledger hashes as an operational alert rather than modifying historical files.

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

## Validation Performed

- Git branch, HEAD, `origin/dev`, `origin/main`, and clean working tree verified before the audit.
- `git fetch origin --prune` completed; MAIN was not changed.
- `node scripts/check-journal-monotonic.mjs` passed: 173 active entries with strictly monotonic `when` values.
- Parallel static/runtime, migration-history, and physical-catalog domain reviews completed.
- All physical database queries used `BEGIN READ ONLY` followed by rollback; no database writes occurred.
- This document and the read-only audit script are the only planned repository changes. No runtime files or active migration files were changed.

## Remaining Unknowns

- The database was a user-supplied DEV-shaped clone; no provider-side clone provenance metadata was available to independently prove the instant it was created.
- This audit intentionally did not access PROD. PROD requires the checklist above before MAIN promotion.
- Historical ledger/source hash differences need a separately approved reconciliation decision; they should not be normalized by replaying or editing old migrations.

**Status:** deployable as documentation/read-only tooling, but the live repairs themselves are not yet deployed or live-validated.
