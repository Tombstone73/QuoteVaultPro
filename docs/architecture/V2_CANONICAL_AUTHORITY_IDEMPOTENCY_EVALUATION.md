# V2 canonical authority and idempotency evaluation

## Final decision

**V2 ARCHITECTURE PROVEN — PROCEED TO RECONSTRUCTION PLANNING.**

This disposable-clone-only experiment proves that staff, delegated AI, Portal, reviewed Inbound, and capability-limited Service/API contexts can share canonical V2 business operations without impersonating a user or duplicating business logic.

## Principal and authority model

`StaffPrincipal` carries organization, verified Staff actor, and capabilities. `DelegatedAiPrincipal` wraps Staff authority and must be confirmed and fresh; the application revalidates the underlying Staff membership and cannot widen its capabilities. `PortalPrincipal` carries an organization, customer, and portal subject. `ServicePrincipal` carries an organization, client subject, and explicit capability set.

`AuthorityPolicy` is pure and checks organization, operation capability, and customer resource scope. It has no database dependency. `PostgresPrincipalContext` is the only PostgreSQL membership revalidation adapter. Canonical applications receive a `Principal`, load their own scoped resource, then invoke policy against the actual organization/customer scope.

The representative `PostgresCreateOrderApplication` and `PostgresQuoteConversionApplication` contain zero direct Staff-membership queries. Their legacy actor-string methods are compatibility adapters only; their typed-principal methods are canonical. Proof response, fulfillment, and finance have equivalent typed entry points; fulfillment intentionally rejects Portal and ungranted Service.

## Truthful attribution

V2-only compatibility migration `006` makes legacy `orders.created_by_user_id` and `invoices.created_by_user_id` nullable on the disposable clone only. `v2_poc_operation_attributions` records organization, operation, resource, principal kind, principal subject, optional verified Staff actor, and time. Quote conversion also records principal kind/subject, source quote, result order, and optional Staff actor in its V2-private conversion data.

Staff and delegated AI retain the verified Staff actor. Portal and Service persist `NULL` in legacy Staff-only fields and never receive a fabricated user record.

## Create-order business idempotency

`v2_poc_business_requests` is unique on `(organization_id, operation, business_request_id)`, independent of the retrying principal. It persists the request fingerprint, authoritative order/invoice identifiers, initiating principal kind/subject, optional real Staff actor, result, and timestamps.

Runtime coverage proves:

- same business request plus same payload replays the authoritative order and invoice;
- same business request plus different payload conflicts;
- identical payload plus different business request creates legitimate distinct orders; and
- concurrent Portal/Service retries of one business request produce exactly one order and invoice while preserving the original initiating attribution.

## Quote conversion and tenant isolation

Quote business uniqueness remains `(organization, quote)`, independent of the principal. The canonical conversion first locks the scoped quote, resolves its real customer/contact scope, then authorizes the principal before preserving quote pricing, tax, PBV2 snapshot, artwork, proof requirements, lines, draft invoice, and conversion linkage.

Portal Customer A can convert its quote. Portal Customer B and a cross-organization principal are denied. Portal, Staff, valid delegated AI, and authorized Service retries/races return one order, invoice, and conversion link with no duplicated artwork, proof state, or commercial effect.

## Remaining operations and negative authority

Portal proof response is resource/customer scoped and uses the same proof operation. Staff and valid AI may use the same operation. Fulfillment pickup uses the same quantity-aware lock/idempotency logic for Staff and valid AI; Portal and Service fail closed. Finance keeps Portal in the customer-scoped outer/read/approval boundary and converges Staff/AI/provider outcomes through the same local financial model.

The negative matrix is proven by policy and runtime tests: Portal cannot cross customer/organization boundaries or fulfill; a Service principal with only `orders.create` cannot convert or fulfill; AI without a valid fresh GO or without underlying Staff capability is denied; and Staff Organization A cannot mutate Organization B.

## Concurrency, isolation, and boundaries

All repositories keep organization predicates. The order and quote paths use transactional claims, resource locks, and durable results. V2 boundary tests prove adapters cannot import persistence/V1 services and policy cannot persist. No V1 runtime, schema, or migration was altered.

## Validation and residual scope

Against the guarded disposable clone, the complete V2 PostgreSQL suite passed 49/49 tests: order creation, quote conversion, proof/artwork/prepress, production/fulfillment/billing, financial lifecycle/provider reconciliation, and harness safety. The in-memory, policy, interface, adapter-boundary, and safety suite passed 26/26 tests. Total: **75/75**.

This is an architectural POC, not a release implementation. Production authentication, Portal identity issuance, API-key provisioning, AI plan storage, and V1-to-V2 migration planning remain reconstruction work. They are not a blocker to the architecture proven here.
