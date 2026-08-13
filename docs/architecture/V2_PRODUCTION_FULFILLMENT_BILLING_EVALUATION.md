# V2 Production → Fulfillment → Billing Compatibility Evaluation

Status: experimental; validated only through the isolated V2 PostgreSQL harness.

## Scope and boundary

This slice is implemented in `v2-poc/src/postgres/postgresProductionFulfillment.ts`. It uses current production, order, shipment, pickup-handoff, fulfillment-event, and invoice tables, plus two V2-private additive tables installed only by the V2 harness:

- `v2_poc_fulfillment_requests` is the durable idempotency boundary for production outcome, pickup handoff, and shipment finalization.
- `v2_poc_billing_reconciliations` is the durable reconciliation/outbox record for terminal physical fulfillment.

No V1 route, service, repository, runtime code, V1 schema file, or V1 migration was modified or imported. The V2 harness has a fail-closed gate: `V2_POSTGRES_INTEGRATION=1`, a present `TEST_DATABASE_URL`, and no other exposed database URL variable. It makes no fallback to application, Railway, DEV, PROD, or generic database configuration.

## Quantity and persistence compatibility

The implemented source of physical availability is scoped by organization and order line:

`available = max(0, SUM(non-cancelled run-member successful_quantity) - SUM(SHIPPED shipment items) - SUM(pickup handoff items))`

`remaining production = max(0, ordered quantity - produced successful quantity)`.

This matches the current V1 quantity projection: `successful_quantity` is authoritative, while completed/damaged/remaining/outcome fields describe the run member’s current outcome. The V2 production repository writes those current-shaped fields cumulatively and records a production event. Failed injected production transactions do not contribute to availability.

For each physical mutation, V2 first locks the organization-scoped `order_line_items` row and then recomputes all three aggregate quantities in that transaction. Pickup and shipment therefore share one pool even though V1’s public workflow may impose additional shipping-method policy. V2 writes append-only pickup-handoff headers/items, shipment headers/items, and standard-shaped fulfillment events. It intentionally exposes no V2 mutation for historical handoffs.

The current 0175 clone schema supplies append-only-shaped handoff history, but has no database trigger that makes arbitrary SQL updates impossible. Accordingly, immutability is **YELLOW**: the V2 application boundary is append-only, but a privileged direct database writer remains outside that boundary.

## Billing and ARCH-007

When a physical operation reaches the ordered quantity, V2 writes its fulfillment event and a `PENDING` billing reconciliation row in the same transaction. The reconciler implements the agreed V2 action, `ensure draft`: it requires exactly one current draft invoice (the V2 create-order slice creates it) and marks the durable row `COMPLETED` with the invoice identity. It does not finalize, pay, sync, or create another invoice.

An injected reconciliation failure rolls back only reconciliation processing. The physical pickup/shipment remains true and the durable row remains `PENDING`; a fresh application instance retries it once the failure is removed. Terminality is evaluated across all order lines under line locks, rather than treating one completed line as a terminal order. This closes the V1 post-commit terminal-billing recovery gap tracked as ARCH-007 for this experimental path.

## Evidence from the isolated clone

The V2 PostgreSQL harness validated:

- 1,000 ordered; 400 successful production; pickup 150 → available 250 and remaining production 600.
- Additional production to 700; shipment 200 → available 350 and remaining production 300; an attempted 351 pickup is rejected.
- The production, pickup, and shipment transaction failure points roll back their request and physical rows together; the same request safely replays from a fresh instance and altered input conflicts.
- Concurrent pickup 75 and shipment 75 against availability 100 produce exactly one success; combined physical fulfillment is 75.
- Terminal fulfillment commits a pending reconciliation. An injected billing failure preserves the terminal handoff and exactly one draft invoice; a fresh instance completes the same reconciliation.
- Tenant-scoped access rejects foreign order, line, and production member identifiers.
- Existing V2 order integration coverage also reads a V1-created order/invoice through the current schema and checks real PBV2 pricing parity against the pure evaluator when the clone has a suitable active product.

## Adversarial review and remaining work

The implementation is intentionally a POC, not production promotion. It has no HTTP endpoints, job scheduler/worker lease, retries with backoff, operator reconciliation UI, alerting, or production migration path. The reconciliation record is durable and restart-safe, but invocation is explicit in the test/application boundary. V1’s public shipment/pickup method-exclusivity policy was not copied into V2; that policy must be made explicit at a future application boundary.

Evaluation: **YELLOW-GREEN for the isolated V2 persistence experiment**—the core compatibility, serialization, rollback, idempotency, tenant scoping, and ARCH-007 recovery behavior are demonstrated; operationalization and database-enforced handoff immutability remain outstanding.
