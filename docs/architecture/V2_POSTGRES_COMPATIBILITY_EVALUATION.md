# V2 PostgreSQL compatibility experiment

## Executive verdict

**Not yet proven by a PostgreSQL run.** Static contract analysis indicates **YES, WITH CONTAINED COMPATIBILITY** for the narrow order-create slice, but this experiment intentionally did not substitute an in-memory fixture or a shared database for the required real-schema PostgreSQL test. The evidence is therefore useful for design and test setup, not a claim that a database-backed vertical slice passed.

The experiment was stopped before any database write because no safe isolated PostgreSQL target could be established, and this checkout cannot bootstrap the current schema into an empty database from its active migration stream alone. This is a safety-correct blocked result, not a production-schema failure.

## Continuation status: disposable clone discovered, writes still fail closed

A later continuation made a **read-only** connection to the user-designated `TEST_DATABASE_URL` clone. It confirmed the expected real schema tables and existing data shape (including organizations, memberships, customers, products, PBV2 trees, orders, invoice records, and 13 valid active product/tree pointers). No database data or schema was changed.

The continuation established that DEV and PROD URLs exist only in Railway and are unavailable to this machine. The operator explicitly approved `TEST_DATABASE_URL` as the disposable Neon clone and required the V2 harness to use no other target. `v2-poc/src/infrastructure/postgresSafety.ts` now fails closed unless `V2_POSTGRES_INTEGRATION=1` and `TEST_DATABASE_URL` are present **and no other PostgreSQL/Neon/application database URL variable is visible**. It has no fallback URL and does not modify the V1 guard. `v2-poc/jest.postgres.config.js` invokes that guard before any integration-test import, isolating this clone from the V1 Jest setup, which correctly rejects its retained `neondb` name. Read-only normal SQL and `BEGIN`/`ROLLBACK` worked through the pooled endpoint; the approved-clone write experiment can now proceed.

## Starting state and safety confirmation

| Item | Result |
| --- | --- |
| Starting experiment SHA | `d3aa9363ee5d2b54000537490f59770c6c38aecd` |
| Branch | `experiment/v2-modular-poc` |
| Working tree at start | Clean |
| `origin/dev` / `origin/main` | Both remained `aeff75c3a2b139b46d9d96707397c550092b11ec` |
| Existing V2 POC | Passed 13 focused fixture tests before this assessment |
| PostgreSQL writes | **Zero** |
| Production/shared DEV credentials or database use | **None** |
| V1 runtime/schema/migration changes | **Zero** |

`TEST_DATABASE_URL` was not configured. `docker`, `psql`, `pg_isready`, `createdb`, and `initdb` were unavailable; no local PostgreSQL listener/service was found. The repository's `safeTestDatabaseUrl` guard correctly refuses application URLs as a fallback and rejects DEV, MAIN, production, shared, and business targets.

## Why an empty local database was not safe to create

The active `server/db/migrations_v2` stream is an **upgrade stream**, not a fresh bootstrap: `0000_baseline.sql` is intentionally a no-op, while `0001_stations.sql` immediately assumes base tables such as `organizations` and `production_jobs`. The active journal is internally consistent (170 monotonic entries), but it cannot establish the real schema shape from a blank database without a trusted baseline schema artifact. Archived/ignored migrations are not a validated substitute.

The missing prerequisites are:

1. A direct, isolated PostgreSQL URL whose database name includes `test`, `testing`, or `ci`, distinct from every application URL.
2. A verified current-schema bootstrap artifact (preferably a schema-only dump from the approved current DEV schema, with no business data), or a replayable initial baseline migration.
3. Permission to use that isolated target only for this experiment.

When supplied, the existing test guard should be used to set `TEST_DATABASE_URL`; migrations and the focused V2 PostgreSQL tests can then run only against that verified target.

## Repository architecture proposed for the next run

The V2 application/domain layer remains unchanged:

```text
interface/test harness -> CreateOrderApplicationOperation -> authorization/domain policy
                       -> V2 repository contracts -> PostgreSQL compatibility repositories
                       -> current PrintersHero tables
```

Compatibility repositories, not domain operations, would own the SQL mappings. No V1 route, `storage` repository, or order/invoice service is required for this design. The existing pure PBV2 evaluator remains the only V1 runtime reuse, through the already-established compatibility adapter.

The proposed V2-only request table is deliberately **not** added or applied until the isolated database exists:

```sql
CREATE TABLE v2_order_create_requests (
  id varchar(64) PRIMARY KEY,
  organization_id varchar NOT NULL REFERENCES organizations(id),
  actor_user_id varchar NOT NULL REFERENCES users(id),
  operation varchar(64) NOT NULL DEFAULT 'create_order',
  request_id varchar(160) NOT NULL,
  request_hash varchar(128) NOT NULL,
  order_id varchar REFERENCES orders(id),
  invoice_id varchar REFERENCES invoices(id),
  result_json jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (organization_id, actor_user_id, operation, request_id)
);
```

The transaction would claim this key with `INSERT ... ON CONFLICT`, compare the fingerprint, create order/lines/invoice/invoice-lines, then store result IDs before commit. A failure would roll back the request claim as well as every commercial record. This mirrors the useful shape of AI idempotency records without reusing the AI-owned table.

## Actual schema compatibility findings

| Repository | Tables / representations | Translation hidden by adapter | Rating | Concern |
| --- | --- | --- | --- | --- |
| Authorization | `users`, `organizations`, `user_organizations` | Membership role only; composite `(user_id, organization_id)` lookup | GREEN | Current roles are owner/admin/manager/member; `employee` is not a membership role. |
| Customer | `customers` | company/display name, exemption, override rate, active lifecycle | GREEN | Repositories must bind `(organization_id, id)`; FK alone does not establish caller scope. |
| Catalog | `products`, `pbv2_tree_versions`, additive options/tree fields | resolve active pointer plus matching org/product tree into one pricing DTO | YELLOW | Parallel product representations remain, but active PBV2 read can be contained. |
| Orders | `orders`, `order_line_items` | decimal money projections plus PBV2/option/tax snapshots; number allocation | YELLOW | Lines have no org column, so a scoped product read must precede write; `order_number` itself is not unique. |
| Billing | `invoices`, `invoice_line_items` | decimal + cents header copies and sold-line snapshots | YELLOW | One-active-invoice invariant is application/advisory-lock based, not a general DB unique constraint. |
| Idempotency | no general order-create table; AI-specific records exist | dedicated V2 request record and composite unique key | RED | Requires a minimal additive table/index before a production cutover. |

### Important mappings

- `user_organizations` is the correct organization authority. Do not accept a caller-provided role or use global `isAdmin` for the V2 operation.
- Products and PBV2 trees both carry organization ownership. `products.pbv2_active_tree_version_id` must resolve to a tree with the same organization and product before pricing.
- Order headers have subtotal/tax/tax-amount/taxable-subtotal/total decimal fields; order lines preserve PBV2 tree/snapshot, option selections, and taxability/tax amount. V2 should calculate cents internally then write exact decimal compatibility projections.
- Invoices retain both decimal and cents totals. Invoice lines copy sold order-line values but do not retain the full PBV2 tree snapshot; that remains an order-line responsibility.
- Current code uses a transaction plus advisory locking to prevent duplicate active invoices. This must remain an explicit V2 repository concern until a database invariant is introduced.

## Required PostgreSQL proof still outstanding

None of the following may be inferred from static inspection. They require the isolated real-schema database described above:

- V2 PostgreSQL repository CRUD/readback against actual migrations and constraints.
- Order + line + draft invoice + invoice-line transaction rollback after each requested failure point.
- Durable idempotency restart and concurrent-key behavior using the V2-only table.
- Database tenant-isolation queries for foreign customer/product/order IDs.
- PBV2 parity against a seeded current-shaped active tree.
- Existing-record compatibility for a V1-shaped seeded order/invoice.

## Validation performed without database access

- Existing V2 fixture vertical slice: **13/13 passed**.
- Safe V1 contracts and PBV2 check: **21/21 passed** (`safeTestDatabase`, tenant-role source, order/invoice integrity, grommet pricing adapter).
- `npm run db:migrations:v2:check-journal`: passed (170 active entries monotonic).
- `git diff --check`: pending final documentation diff validation.

## Measured impact

| Measure | Result |
| --- | --- |
| Total V2 production LOC | 338 nonblank TypeScript lines (unchanged) |
| Total V2 test LOC | 78 nonblank TypeScript lines (unchanged) |
| PostgreSQL compatibility LOC added | 0; implementation deferred rather than unvalidated against a fake or shared schema |
| PostgreSQL integration tests executed | 0; blocked before DB writes |
| Repository implementations added | 0; proposed contracts/mappings documented only |
| Tables actually written/touched | 0 |
| Direct SQL/ORM mutations outside repositories | 0 |
| Canonical mutation operations | 1 existing `CreateOrderApplicationOperation.execute` |
| Model/token/cost metrics | Not available; not invented |

## Critical evaluation

1. **Can V2 use the current PrintersHero PostgreSQL schema cleanly?** **YES, WITH CONTAINED COMPATIBILITY — not yet runtime-proven.** The narrow persistence model has enough scoped ownership and snapshot fields for adapters; decimal/cents duplication, PBV2 representations, and application-enforced invoice uniqueness are contained but real costs.
2. **Did PostgreSQL persistence materially increase V2 coupling?** Statically, it adds adapter-local translation rather than domain-layer coupling. Actual code/test evidence is pending the isolated database.
3. **Did V2 need to call V1 business repositories/services?** No. The planned adapter uses schema contracts/direct infrastructure only; the existing pure PBV2 evaluator remains the sole proven reuse.
4. **Can existing customers/products/orders survive a future V2 cutover?** Probably for this slice: customer ownership/tax, product/tree pointers, order-line PBV2 snapshots, and invoice snapshots are all readable. Product legacy representations and redundant financial fields require careful compatibility mapping; this is not yet demonstrated on a database record.
5. **Would a future full V2 need a database migration?** **Moderate normalization migration.** The first slice needs a minimal additive idempotency table. A full V2 should also decide how to retire or govern redundant financial/status/product representations and strengthen invoice uniqueness.
6. **Is the full-rebuild thesis stronger or weaker after this experiment?** **UNCHANGED.** The schema appears more usable than a wholesale-replacement assumption, but the decisive PostgreSQL experiment could not safely run. No persistence result should be manufactured from static analysis.

## Recommended next experiment

Provision `printershero_v2_poc_test` (or equivalent) as a direct disposable PostgreSQL target and supply a verified schema-only bootstrap matching the active application schema. Apply that bootstrap and the V2-only request-table DDL exclusively there, seed two organizations and current-shaped PBV2/order fixtures, then run the required transaction, concurrency, parity, isolation, and existing-record readback suite. Only after that run should PostgreSQL compatibility repositories be committed as validated implementation.

## Runtime PostgreSQL results (approved disposable clone)

### Executive verdict

**YES, WITH CONTAINED COMPATIBILITY.** The current PrintersHero schema supported the V2 order-create slice through V2-owned PostgreSQL repositories without importing V1 routes, `storage`, order services, or billing services. The only V1 behavior reused at runtime is the pure PBV2 option-tree evaluator, behind the V2 pricing adapter.

The clone was operator-approved through `TEST_DATABASE_URL`. The V2 runner requires `V2_POSTGRES_INTEGRATION=1`, accepts no fallback URL, and fails before imports if any other PostgreSQL/Neon/application URL variable is exposed. V1 test/database guard code was not changed. The pooled Neon endpoint completed normal SQL, DDL, transactions, rollback, and concurrent request tests.

### Implemented architecture

`PostgresCreateOrderApplication` owns one transaction: membership authorization, durable request claim, scoped customer and active PBV2 configuration reads, canonical cents pricing/tax, order/header + lines, draft invoice + lines, request completion, commit. Database representations are contained in `v2-poc/src/postgres/postgresOrderCreate.ts`; the domain operation receives cents and pricing snapshots rather than SQL columns.

The V2-only `v2_poc_order_create_requests` table has a unique `(organization_id, actor_user_id, operation, request_id)` constraint and SHA-256 canonical request fingerprint. A failed transaction rolls back its request claim as well as every commercial record.

### Runtime scorecard

| Repository | Tables Used | Translation | Runtime Result | Rating | Concern |
| --- | --- | --- | --- | --- | --- |
| Authorization | `user_organizations`, `organizations` | active membership + role to capability | Owner succeeds; member is denied before a request claim | GREEN | Current persisted membership has no `employee` role; adapter deliberately grants owner/admin/manager only. |
| Customer | `customers` | exemption, override/default tax, terms | Taxable/exempt and foreign customer tests pass | GREEN | Scope is `(organization_id,id)`, not FK inference. |
| Catalog/PBV2 | `products`, `pbv2_tree_versions` | active pointer/tree/product/org validation | Foreign product rejected; real active PBV2 product parity passed | YELLOW | Multiple legacy product representations remain hidden in this adapter. |
| Orders | `global_variables`, `orders`, `order_line_items` | V2 cents to decimal snapshots; scoped line read; V2 document number allocation | Create/readback, number concurrency, all rollback stages passed | YELLOW | Header/line decimal dual representation remains compatibility cost; line total is authoritative when quantity cannot divide cents. |
| Billing | `invoices`, `invoice_line_items` | header cents+decimal copies and invoice-line snapshot read | Required draft invoice/lines match order financials; scoped readback passed | YELLOW | Existing schema lacks generic one-active-draft DB constraint; idempotent create operation supplies the invariant for this slice and detects multiple legacy drafts. |
| Idempotency | `v2_poc_order_create_requests` | V2-only additive request record | fresh-instance replay, conflict, concurrency, rollback passed | GREEN for experiment | Production cutover needs an additive migration/table with a lifecycle/retention policy. |

### Proofs performed

- **Atomic creation/readback:** an order with PBV2 line snapshot, tax, draft invoice, and invoice line committed; independently reconstructed repositories reloaded exact header totals and line snapshots.
- **Failure injection:** after request claim, order insert, line insert, invoice insert, invoice-line insert, and immediately before commit, direct PostgreSQL counts showed no order, lines, invoice, invoice lines, or request record for that failed request. Each request then retried successfully.
- **Durable retry:** a fresh application instance returned the original order/invoice for the same key; changed content with that key produced `IDEMPOTENCY_CONFLICT`.
- **Concurrency:** two simultaneous same-key creates produced one order, one invoice, and one line; concurrent distinct requests received distinct document numbers.
- **Tenant isolation:** foreign customer/product IDs and foreign order reads return scoped not-found; an organization member lacking the capability is denied before mutation.
- **Tax:** tested 7% taxable line (2,200¢ + 154¢ tax), exempt line (0¢ tax), and multi-line taxable order (3,200¢ + 224¢ tax); invoice totals equal persisted authoritative order totals. Integer-cent rounding is an intentional correction over V1’s less explicit rounding boundary.
- **PBV2 parity:** an existing active clone product was loaded through the scoped V2 catalog adapter; its V2 calculation matched the V1 pure evaluator for its current base/option evaluation and persisted snapshot. The POC fixture separately exercises selected option impacts.
- **Existing records:** a non-POC V1-created order with draft invoice loaded through V2 scoped repositories. Header cents totals and order/invoice line counts matched direct database source records. This test does not claim that every historical lifecycle/product representation is covered.

### Complexity and conclusion

The real persistence model increased code in repository adapters, not in the V2 application/domain layer. Six repository responsibilities touch ten existing tables plus one V2-only experimental table. There are zero V1 business repository/service calls and zero direct SQL/ORM mutations outside V2 PostgreSQL repositories/test fixture setup. One canonical mutation operation is used.

The final experiment footprint is 424 V2 source lines and 252 V2 test lines; the PostgreSQL adapter itself is 51 source lines and its integration suite is 157 test lines. The V2 suite contains 32 tests in total (16 PostgreSQL-harness/integration and 16 V2 in-memory/safety tests); the unaffected V1 safety suite has 21 passing tests. These counts are a bounded compatibility cost, not a claim that every legacy workflow is covered.

The schema should be retained for a staged V2 cutover with **minimal additive migration first**: durable request records, then a deliberate decision on active-draft invoice uniqueness. A later full V2 should normalize/govern redundant decimal/cents financial projections, product representations, and overlapping status columns; that is moderate normalization, not evidence that a clean replacement schema is required for this slice.

The full-rebuild thesis is **STRONGER**: runtime evidence confirms that a clean modular application boundary can survive the current schema for a meaningful commercial slice, while the scorecard makes remaining data-model debt explicit rather than spreading it through routes. The next highest-information experiment is **Quote → Order conversion**, because it tests existing snapshots, transactional conversion/idempotency, and compatibility reads without expanding into production/fulfillment complexity.
