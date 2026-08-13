# V2 modular rebuild POC evaluation

## Scope and result

The experiment on `experiment/v2-modular-poc` implements one clean, fixture-backed vertical slice under `v2-poc/`: authenticated actor -> organization-scoped authorization -> customer lookup -> PBV2 product configuration -> canonical pricing -> order + lines + draft invoice persistence -> readback. No V1 runtime file, shared schema, migration, DEV branch, MAIN branch, or database data was changed.

The target is a modular monolith, not microservices. The slice follows the documented direction:

```text
Interface adapter -> canonical application operation -> organization authorization
                  -> domain policy -> module repository -> infrastructure transaction
```

`CreateOrderApplicationOperation` is the explicit atomic Orders/Billing consistency boundary. Repositories do not mutate another module's collection; the operation coordinates their writes through one unit of work.

## Behavioral reference and deliberate differences

| Scenario | V2 classification | Evidence / reason |
| --- | --- | --- |
| Membership-derived organization context | Intentional correction | Matches tenant-context direction; does not accept global admin/caller role. |
| Valid customer/product lookup | Intended parity | Both are scoped by organization. |
| PBV2 option pricing | Intended parity | Reuses V1 `evaluateOptionTreeV2` through a clean adapter. |
| Taxable, exempt, and mixed lines | Intentional correction | V2 applies tax after pricing per line and snapshots it; prevents zero/stale-tax paths. |
| Order/invoice financial equality | Intended parity | Both records are one atomic result with immutable line snapshots. |
| Foreign product ID | Intentional correction | V2 rejects before pricing; direct V1 order route has an identified unscoped product lookup. |
| Foreign customer/order IDs | Intended parity | Returns scoped not-found without existence leakage. |
| Retry with same request ID | Intentional correction | Durable transaction record replaces V1's two-minute process-local map. |
| Retry with changed payload | Intentional correction | Hash conflict prevents accidental reuse. |
| Invoice failure | Intended target behavior | Full rollback of order, invoice, audit, and request is proven by injection. |
| Restart/readback | Intended target behavior | A second application instance using the same fixture store reads persisted order/invoice state. |
| DB-backed V1 `priceLineItem` integration | Deliberately deferred | It loads product/tree from DB; adapter boundary permits a production repository to provide its pure evaluator input without route dependency. |

## Viability answers

**Can a clean V2 slice reuse current business behavior?** Yes. Organization membership semantics, scoped reads, PBV2 option evaluation, cents snapshots, and atomic draft-invoice behavior are reusable. The DB-coupled `PricingService.priceLineItem` is not imported; V2 uses its pure PBV2 evaluator seam after Catalog owns scoped configuration loading.

**Can boundaries be made clearer without duplicating logic?** Yes for the slice. Pricing calculation is delegated to V1's pure evaluator; authorization, Catalog, Customers, Orders, Billing, and infrastructure have named responsibilities. The only cross-domain mutation is named and atomic.

**Can V2 avoid the highest-risk V1 patterns?** Yes in this POC: no global admin shortcut, no unscoped product lookup, no route-local pricing/tax calculation, no process-local idempotency, and no post-commit invoice creation.

**Can V2 coexist with V1?** Yes if introduced via compatibility repositories and one caller at a time. This POC intentionally does not share runtime routes or write a shared database. A production next step requires a dedicated idempotency migration/table and an integration test against an explicitly configured isolated test database.

## Measured scope

| Measure | Result |
| --- | --- |
| V2 production LOC | 338 nonblank TypeScript lines across 12 source files (including fixture composition). |
| V2 test LOC | 78 nonblank TypeScript lines in one focused test file. |
| V2 modules/files | 12 source files, 1 focused test file, 1 README. |
| Canonical mutation entry points | 1: `CreateOrderApplicationOperation.execute`; one separate read-only query, `ReadOrderApplicationQuery.execute`. |
| Direct cross-domain repository writes | 0. |
| Compatibility adapters | 1: `V1Pbv2CompatibilityPricingAdapter`. |
| V1 runtime files/functions required at runtime | 1 pure evaluator import: `server/services/optionTreeV2Evaluator.evaluateOptionTreeV2`; no V1 route/storage/db loader. |
| V1 runtime files changed | 0. |
| Duplicate pricing evaluator logic | 0; base unit multiplication and tax policy are V2 domain inputs, PBV2 option impacts use the V1 evaluator. |
| Legacy routes required | 0 for POC execution. |
| Codex-specific statistics | Not collected; no built-in reliable measure was available. |

The added tests are behavioral contracts, not source-string assertions. Validation must include the focused POC test, selected V1 pricing/order-invoice contracts when an isolated test database is configured, and `git diff --check`.
