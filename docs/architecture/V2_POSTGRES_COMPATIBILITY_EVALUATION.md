# V2 PostgreSQL compatibility experiment

## Executive verdict

**Not yet proven by a PostgreSQL run.** Static contract analysis indicates **YES, WITH CONTAINED COMPATIBILITY** for the narrow order-create slice, but this experiment intentionally did not substitute an in-memory fixture or a shared database for the required real-schema PostgreSQL test. The evidence is therefore useful for design and test setup, not a claim that a database-backed vertical slice passed.

The experiment was stopped before any database write because no safe isolated PostgreSQL target could be established, and this checkout cannot bootstrap the current schema into an empty database from its active migration stream alone. This is a safety-correct blocked result, not a production-schema failure.

## Continuation status: disposable clone discovered, writes still fail closed

A later continuation made a **read-only** connection to the user-designated `TEST_DATABASE_URL` clone. It confirmed the expected real schema tables and existing data shape (including organizations, memberships, customers, products, PBV2 trees, orders, invoice records, and 13 valid active product/tree pointers). No database data or schema was changed.

The continuation could not compare that target endpoint to a DEV/PROD application endpoint because no application database URL was present in the process, user, machine, or workspace configuration. The brief requires that comparison before a write, so the PostgreSQL implementation/tests remain blocked. `v2-poc/src/infrastructure/postgresSafety.ts` now supplies a V2-only fail-closed guard: it requires `V2_POSTGRES_INTEGRATION=1`, `TEST_DATABASE_URL`, and `V2_REFERENCE_DATABASE_URLS` (a JSON array of known application references); it rejects exact and Neon pooler/direct endpoint aliases, has no fallback URL, and does not modify the V1 guard. `v2-poc/jest.postgres.config.js` invokes that guard before any integration-test import, isolating this clone from the V1 Jest setup, which correctly rejects its retained `neondb` name. Read-only normal SQL and `BEGIN`/`ROLLBACK` worked through the pooled endpoint; DDL, write rollback, and concurrency remain untested until endpoint isolation is proven.

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
