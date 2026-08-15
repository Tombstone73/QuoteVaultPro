# V2 M0 Foundation

## Scope

M0 creates the production V2 architectural floor only. It contains no commercial workflow and exposes no business-data mutation route. V1 remains the only writer for customers, catalog/PBV2, quotes, orders, artwork, production, fulfillment, invoices, and payments in the existing V1 DEV and production business databases. Once later V2 modules exist, they are normal writers in their dedicated isolated V2 DEV database; this does not change M0's current no-business-route scope.

Production V2 lives in the top-level `v2/` application so it can be independently built and deployed as a separate Railway service. It must not import `server/index.ts`, V1 route handlers, V1 business services, V1 workers, or `v2-poc/`. Selected V1 reuse is future-only and explicit: the PBV2 pure evaluator, stable value types, and reviewed infrastructure adapters—not a broad `server/**` allowance.

## Contracts

Interfaces turn authenticated context into a trusted Principal through a `PrincipalIssuer`; HTTP input never supplies Staff role/capability claims. `AuthorityPolicy` is pure: it checks capability, organization, and resource/customer scope but performs no persistence or mutation.

Named application operations later accept a Principal, typed command, organization/resource scope, and an operation-specific business request identity where appropriate. They return authoritative result IDs and side-effect references. Repositories remain domain-specific and require organization scope; they enforce storage integrity, not business authority.

The small initial capability vocabulary is `orders.create`, `quotes.convert`, `proof.respond`, `fulfillment.pickup`, and `billing.payment.record`. New capabilities require an owning operation, documented resource scope, adapter authorization decision, and policy/negative test.

## Persistence foundation

M0 uses additive production tables only. It does not copy POC DDL or alter legacy `created_by_user_id` fields.

- Operation requests retain organization, operation, business request identity, payload fingerprint, status, authoritative result reference, original principal attribution, and timestamps. Their uniqueness is `(organization, operation, business_request_id)`; it is never implicitly actor-scoped.
- Operation attribution retains principal kind/subject, optional verified Staff actor, resource/result reference, and request linkage. Portal and Service never fabricate Staff.
- Durable work supports an event/work type, aggregate identity, deterministic key, payload/reference, retry timing, lease/claim, attempt count, completion/dead-letter state, and sanitized failure. It is a foundation for later outbox and reconciliation consumers, not a business worker.

Only append-only migration SQL in `server/db/migrations_v2` creates this foundation. Application startup never executes DDL. The migration must be rehearsed only on an explicitly authorized disposable clone and verified by physical catalog postconditions. A migration ledger is not physical proof.

## Runtime, safety, and observability

The shell validates typed configuration at startup, has liveness and readiness endpoints, supports graceful shutdown, and starts no V1 worker. Runtime database configuration and disposable-clone test configuration are distinct. Clone tests require an explicit write opt-in, `TEST_DATABASE_URL`, and the absence of alternate database URLs; there is no fallback and no secret logging. An explicitly approved Neon clone is allowed even when its internal database name is neutral.

Structured V2 context carries operation ID, business request ID, organization, principal kind/subject, optional Staff actor, resource IDs, durable-work ID, and stable error code. Errors use a small public-safe taxonomy: validation, not found, forbidden/scope, conflict/stale state/idempotency conflict, retryable failure, and internal error.

## Boundary and M1 gate

Automated boundary tests prohibit adapters importing raw DB/repositories/V1 routes or services; prohibit policy persistence; prohibit repository imports from interface code; and prohibit every production V2 import from `v2-poc/`. M0 is ready for M1 only when the V2 shell, contracts, migration/postconditions, clone safety, tests, and independent build are green; a fresh DEV-shaped clone has rehearsed the migration when an operator-approved target is available.

## Physical readiness

**PASS — guarded clone rehearsal completed.** The rehearsal uses only explicit `TEST_DATABASE_URL` plus `V2_M0_POSTGRES_INTEGRATION=1`, verifies the physical catalog, and rolls back its atomicity fixture. It also exercises PostgreSQL operation-request contention, principal-neutral replay and conflict behavior, Staff/delegated-AI/Portal/Service attribution, organization isolation, outbox deduplication and concurrent claims, lease expiry/stale-worker rejection, retry, completion, and dead-letter transitions. The rehearsal-only pool has three connections: one held creator transaction and two concurrent contenders; the primary verifier is released before that concurrent phase.
