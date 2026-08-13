# Architecture Remediation Roadmap

This is a progressive strangler plan. It deliberately avoids a rewrite and does not prescribe microservices.

| Phase | Scope / prerequisites | Risk | Expected regression reduction | Tests required before change |
| --- | --- | --- | --- | --- |
| 1. Stop active P0 access and lifecycle bypasses | ARCH-001, 004-006, 008-010. Identify/deprecate unsafe public paths; apply server org capability checks. | High, tightly scoped | Prevents unauthorized/cross-tenant and incomplete terminal mutations. | Tenant read/write/delete matrix; all cancellation paths; shipping-email signature/scope; artwork delete. |
| 2. Financial correctness | ARCH-002, 003, 011-013, 024. Define order tax and credit authority; centralize financial header/line mutations. | Critical | Prevents wrong billing, stale A/R, and credit exposure. | Taxable inbound/direct/AI vectors; line-edit tax; payment failure/retry; header=line invariants; credit ledger/exposure. |
| 3. Terminal fulfillment reconciliation | ARCH-007, 023. Persist `FulfillmentTerminalStateReached` reconciliation record before response. | High | Prevents missing invoices after ship/pickup and improves recovery. | Inject billing/event failure; retry/reconciliation idempotency; terminal-state uniqueness. |
| 4. Production/artwork recovery correctness | ARCH-009, 014-015, 020-022. Canonical recovery, artwork retire, prepress transaction context, proof delivery record. | High | Stops contradictory production/fulfillment/artwork state. | Reopen/undo state invariants; active run constraints; final-art rollback; proof delivery failure. |
| 5. Order application-operation spine | ARCH-016-017 plus remaining order caller convergence. Add durable request IDs and initialization/retry state. | High | Reduces central workflow divergence. | Direct/quote/portal/AI/inbound creation parity and multi-instance retry simulation. |
| 6. Catalog/PBV2 convergence | ARCH-018-019, 027-028. Route auto publish and remaining high-risk PATCH/configuration through named operations. | Medium-high | Prevents product/pricing representation drift. | Auto-save vs publish equivalence; legacy isolation; cross-entry-point pricing snapshots. |
| 7. Authority consolidation | Replace route-local/global role checks with the shared organization capability model across finance, catalog, production, fulfillment. | High | Makes permissions reviewable and consistent. | Role × organization × interface matrix, including AI/portal/platform distinctions. |
| 8. Interface cleanup and compatibility retirement | ARCH-025, 029, legacy status/route surfaces. Remove only after callers are migrated and observability confirms no use. | Medium | Removes accidental bypass reintroduction. | UI route inventory, API compatibility tests, production telemetry review. |
| 9. Module boundary hardening | Move remaining route-local workflows behind module operations; split god files only as behavior moves. | Medium | Lowers future change blast radius. | Operation contract suite and dependency/import checks. |

## Sequencing rules

Phases 1 and 2 should precede additional inbound ordering, storefront/API order creation, external carrier integrations, and any broader AI writes. Phase 3 should precede carrier-rate/service integration and heavily automated fulfillment. Phase 4 should precede nesting visualization or more production automation. Phase 6 should precede broad configurable-product/storefront product expansion. Phases may contain small independent work items, but do not start an interface expansion that creates a new mutation path before its canonical operation exists.

## Explicitly leave alone for now

- Do not replace `PricingService` with a new evaluator; protect and reuse it.
- Do not replace transactional quote conversion or inbound claim/linking just because their code is large.
- Do not split deployment/database into microservices.
- Do not do a formatting-only route/service breakup.
- Do not remove legacy product/artwork representations until every live consumer and migration rule is known.
- Do not broaden AI to finance, lifecycle, product activation, or inventory actions merely because its framework exists.

## Operating approach per slice

1. Specify the command and invariants.
2. Add behavioral failure/authorization/parity tests around current behavior.
3. Implement a thin canonical operation using the existing working persistence logic.
4. Route one caller family through it.
5. Migrate other callers and add durable reconciliation/idempotency where necessary.
6. Observe, then remove the bypass or mark it incompatible.
