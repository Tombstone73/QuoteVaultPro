# M7.1 production read-only baseline

**Disposition: COMPLETE WITH BLOCKING FINDINGS.** This is a production aggregate-only, no-business-write baseline as of 2026-09-05. It is not a cutover approval. No PII, row payloads, identifiers, provider credentials, or audit passwords are recorded.

## Provenance, authentication, and read-only proof

The target was Railway `PrintersHero-PRODUCTION` / `production`, configured for Neon `ep-rough-lake-aem3jtto-pooler.c-2.us-east-2.aws.neon.tech`, database `neondb`, PostgreSQL 17.11. Production is one V1 Railway replica from `main` commit `1326ad1b1bda70e478adc44b3b7ee3ccdf7e5102`; DEV V2 evidence is not projected onto this target.

A single controlled Node process generated a strong password in memory, reset only `printershero_m7_audit`, and immediately opened a second connection with that in-memory value. The password was never emitted, persisted, committed, or exported. Two password rotations occurred: the first login attempt stopped on a pooled-backend-address comparison; the final rotation/login succeeded. Both changes were only `ALTER ROLE ... PASSWORD` for this audit role. All audit connections closed, and the current random password is intentionally unknown outside that process.

| Check | Result |
| --- | --- |
| Restricted identity | `current_user = printershero_m7_audit`; `current_database = neondb` |
| Target proof | exact configured verified production Neon endpoint |
| Transaction | default `transaction_read_only = on`; explicit `REPEATABLE READ READ ONLY` also `on` |
| Effective privileges | no database/schema `CREATE`; no `INSERT`, `UPDATE`, `DELETE`, or `TRUNCATE` on `organizations`; no `SELECT` on `oauth_connections` |
| Role attributes | login only; no superuser, role/database creation, replication, BYPASSRLS, or inheritance; connection limit one; expiry 2026-10-04 UTC |

Every inventory query ran inside the explicit transaction and ended in rollback/connection close. The password was not separately invalidated: it is random and unretained, so a later audit requires another authorized controlled rotation.

## Migration and physical schema inventory

The `public` schema has 234 tables and extensions `pgcrypto` and `plpgsql`. `__drizzle_migrations_v2` has `id`, `hash`, and `created_at`, with 194 rows. Its latest timestamp maps to repository journal tag `0199_v2_proofing_domain_foundation`.

This does **not** form a coherent M0199 schema. Production has only 15 `v2_*` tables: the M0180 operation/principal/outbox foundation and M0181 permission-set family. Repository SQL through M0199 requires V2 sales, audit, routing, billing, artwork, and proof tables that are absent from the catalog. The repository journal has 259 immutable entries through 0263 and 195 entries through M0199, while PROD's ledger has 194 rows.

This is a **P0 ledger/schema-provenance divergence**, not a finding of which historical row was altered or manually applied: DDL definitions and ledger hashes were not read. Do not run ordinary forward V2 migrations, deploy V2, or cut over. First obtain separately authorized DDL and migration-hash reconciliation and an approved repair/rollback plan.

## Aggregate business-state inventory

Counts and status aggregates only:

| Domain | Observed production state |
| --- | --- |
| Tenancy / CRM | 2 organizations, 528 active customers, 414 contacts |
| Product / pricing | 48 products; 10 pricing formulas; 0 product variants, product options, and pricing rules |
| Quotes | 67 all `draft`; 92 lines (90 `active`, 2 `draft`) |
| Orders | 350: 191 `in_production`, 117 `new`, 33 `ready_for_shipment`, 8 `canceled`, 1 `completed` |
| Production | 478 jobs: 320 `queued`, 152 `done`, 3 `in_progress`, 2 `canceled`, 1 `void`; 3 runs (2 canceled, 1 completed) |
| Artwork / proof | 739 artwork (710 current); 972 files (935 active); 38 proof versions; 17 proof approvals |
| Materials / fulfillment | 77 materials; 10 reservations (1 `RESERVED`, 9 `RELEASED`); 4 draft shipments, 8 shipment items, 2 pickup handoffs |
| Finance / local provider state | 257 invoices (239 billed); 24 payments (11 refunded, 11 succeeded); 9 successful Stripe attempts; 10 successful refund requests; 39 processed payment webhooks |
| Accounting / delivery | 1 synced accounting job; 0 QuickBooks leases; 4 delivery jobs (2 `failed`, 2 `needs_review`); 10 sent email-log records |
| V2 activation evidence | 0 `v2_outbox_messages`, 0 `v2_operation_requests`, 5 V2 permission-audit events |
| Audit history | 1,903 audit-log and 1,626 order-audit-log records |

These show live, non-quiescent legacy operations. They are not provider-side reconciliation proof and must not be used to retry, resend, claim, or mutate anything.

## Observed production shapes and risks

“Production-only” means observed in PROD, not proven absent in DEV.

- Legacy canonical tables use mixed status vocabularies: lower-case order/production states and upper-case inventory/shipment states.
- Product, quote-line, and order-line metadata includes PBV2 snapshot/version, option-tree, design/proof/prepress, and workflow compatibility fields. Only metadata was inspected; field population was not inferred.
- V2 permission/portal foundations exist, but no V2 sales/order/billing/routing/artwork/proof family was catalogued and V2 operation/outbox rows were zero.
- Empty optional subdomains (`product_variants`, `product_options`, `pricing_rules`, `prepress_jobs`, `quickbooks_sync_leases`) require migration adapters to tolerate zero rows.
- **P0:** 320 queued production jobs and 191 orders in production require an approved reconciliation/resume plan before any authority change.
- **P1:** assign an owner and non-mutating investigation plan for the failed/needs-review delivery jobs; define explicit V1-to-V2 status, lifecycle, financial, artwork, and fulfillment contracts.
- **P2:** repeat the controlled in-memory rotation/login pattern before role expiry; never retain a shared audit password.

## Scope ledger

Production mutations: two password rotations of `printershero_m7_audit` only. Application/business-data mutations: none. Provider writes: none. Deployments, migrations, queue claims, email sends, webhook replays, and Vercel/Railway configuration writes: none.
