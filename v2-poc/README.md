# V2 modular order POC

This experimental vertical slice proves a clean server-side order path without modifying V1 runtime code or connecting to a database. Its fixture persistence is deliberately copy-on-write and has no `DATABASE_URL`, so the test harness cannot affect DEV or production data.

## Flow and boundaries

`CreateOrderApplicationOperation` is the only cross-domain write boundary:

```text
interface caller -> createOrder -> organization authorization -> customer/catalog reads
                 -> PBV2 compatibility pricing -> Orders + Billing + request record (one transaction)
```

- `resolveActorOrganizationContext` derives the role from organization membership; callers cannot provide a role. Owner/admin/manager/employee have `orders:create`; member does not.
- `getCustomer`, `getProductPricingConfiguration`, and order/invoice reads all require `organizationId`, returning not-found for foreign IDs.
- `V1Pbv2CompatibilityPricingAdapter` reuses V1's pure `evaluateOptionTreeV2` PBV2 option evaluator after Catalog has loaded the scoped product/tree. It does not use a V1 route, `storage`, or the DB-coupled `priceLineItem` loader.
- A durable request record is represented by the fixture persistence table and would map to a unique `(organization_id, actor_user_id, operation, request_id)` row plus request hash/result IDs in PostgreSQL. This intentionally replaces V1's short-lived process map.
- The operation persists the order, lines, draft invoice snapshots, audit record, and request record in one copy-on-write transaction. Failure injection proves all-or-nothing rollback.

## Schema-compatibility strategy

The POC keeps compatibility at repository seams, not in domain logic. A real PostgreSQL adapter would read `products` + `pbv2_tree_versions` by organization/product/active version, and write existing order/invoice line snapshot fields. Cents are canonical here; the existing schema's decimal projections would be written only by that infrastructure adapter. No migration is included because this experiment must not mutate shared schema/data.

## Run

```powershell
npx jest v2-poc/tests/v2VerticalSlice.test.ts --runInBand
```

The suite covers valid PBV2 pricing, taxable/exempt/multi-line totals, invoice integrity, role and organization denial, guessed foreign customer/product IDs, idempotent restart replay/key conflict, rollback, and readback.

## PostgreSQL compatibility experiment

The PostgreSQL runner is intentionally separate from the repository Jest setup
and does not alter its safety rules. It uses V2-owned raw `pg` repositories for
membership, customers, Catalog/PBV2, orders/lines, billing/invoice lines, and
a V2-only durable request table. The application operation does not call V1
routes, storage, order, or billing services. It continues to use only the pure
PBV2 option evaluator.

The runner uses an explicitly operator-approved disposable clone only when:

```powershell
$env:V2_POSTGRES_INTEGRATION = "1"
$env:TEST_DATABASE_URL = "<approved disposable clone URL>"
npx jest --config v2-poc/jest.postgres.config.js --runInBand
```

The V2-only guard permits exactly one database connection variable:
`TEST_DATABASE_URL`. It rejects `DATABASE_URL`, migration/direct/application
URLs, and other PostgreSQL/Neon URL variables when they are present, has no
fallback connection string, and is evaluated before any database-test import.
The supplied URL is the operator-approved disposable clone. Do not put
credentials in source control or logs.

`db/001_v2_poc_order_idempotency.sql` is experimental clone-only DDL. It is
not part of V1 migrations. The integration suite creates named POC data in two
temporary organizations, proves the transaction/failure/retry/concurrency
paths, reads existing clone records without modifying them, and removes its
own fixtures at completion.
