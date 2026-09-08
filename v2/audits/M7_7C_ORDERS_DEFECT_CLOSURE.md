# M7.7C — Orders read defect closure

## Scope and reproduction

Starting DEV source was `c554207be5b71a6cc6a35a85165061a3c54ee6fc`. The authenticated staff Orders workspace made a read-only request to the tenant-scoped Orders endpoint and returned HTTP 500, while the authenticated shell and Finance reads loaded.

The read path is `OrdersList` → `orderApi.list` → authenticated Orders HTTP route → `PostgresSalesWorkspaceReads.listOrdersForWorkspace` → four bounded native/legacy list and summary projections plus the native operational projection.

## Root cause and repair

This was an application SQL-construction defect, not a migration or physical-schema defect. Runtime diagnostics and the deployed read-only request exposed three sequential defects in the shared static operational predicate:

1. The `open_balance` arm had an extra closing parenthesis, yielding PostgreSQL syntax error near `)`.
2. The `ready_for_fulfillment` arm closed its line-item `EXISTS` early, leaving alias `l` outside its correlated `NOT EXISTS` scope.
3. The two summary statements accepted the list query's sparse `$1…$11` argument array while referencing `$1…$6` and `$11`; PostgreSQL rejected untyped skipped parameter `$7` (`42P18`).

The repairs retain tenant filters, server paging, filters, sort, the native/legacy compatibility projection, and all operational facts. Summary queries now use their own contiguous seven-parameter array and a deliberately renumbered static operational predicate. No schema, migration, business data, provider configuration, or production resource changed.

## Regression coverage

`v2/tests/infrastructure/salesCustomerPagination.pure.ts` now verifies emitted Orders projection SQL is balanced, keeps the correlated line alias inside its fulfillment predicate, and uses contiguous summary parameter numbering. It continues to cover mixed-source paging, search, sorts, operational summaries, and the Flatbed filter. `orderLifecycleRoutes.pure.ts` covers validated HTTP filter forwarding.

## DEV revalidation

Railway DEV deployment `b64c2f0c-6f62-4753-82a3-fefc481365ba` for `d48105cf2b1bd1952d39bc7d531bba1757dbe4cd` succeeded. A fresh authenticated browser session then loaded Orders successfully: 123 mixed V2/legacy records, summary total, pagination control, and customer/contact, artwork, prepress, production, fulfillment, and billing projections were visible. No HTTP 500 or Orders diagnostic was emitted for that recheck.
