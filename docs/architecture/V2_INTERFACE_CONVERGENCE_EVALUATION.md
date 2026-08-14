# V2 interface convergence evaluation

## Executive verdict

**V2 ARCHITECTURE PROVEN — PROCEED TO RECONSTRUCTION PLANNING.**

The V2 POC now translates every supported interface into a typed principal and invokes a canonical application operation. Interface adapters contain only context translation, Plan/GO orchestration, request shaping, and response shaping; they do not import persistence, SQL, V1 services, pricing, tax, fulfillment, invoice, proof, or payment logic.

## Canonical route

```text
Staff / AI / Portal / reviewed Inbound / Service API
                     -> typed Principal
                     -> AuthorityPolicy
                     -> canonical application operation
                     -> organization- and resource-scoped repository
```

`AuthorityPolicy` is persistence-free. `PostgresPrincipalContext` is the separate, explicit boundary that revalidates a Staff or delegated-AI staff membership. Portal and Service are never translated into a user identity.

## Interface parity matrix

| Operation | Staff | AI | Portal | Inbound | Future API | Same Canonical Operation |
| --- | --- | --- | --- | --- | --- | --- |
| Create order | SUPPORTED | SUPPORTED after valid Plan/GO | INTENTIONALLY FORBIDDEN | SUPPORTED after Staff review | SUPPORTED with `orders.create` | YES |
| Quote conversion | SUPPORTED | SUPPORTED after valid Plan/GO | SUPPORTED for own customer quote | SUPPORTED after Staff review | SUPPORTED with `quotes.convert` | YES |
| Proof/artwork response | SUPPORTED | SUPPORTED after valid Plan/GO | SUPPORTED for own customer proof | NOT APPLICABLE | NOT APPLICABLE | YES |
| Fulfillment pickup/shipment | SUPPORTED | SUPPORTED after valid Plan/GO | INTENTIONALLY FORBIDDEN | NOT APPLICABLE | INTENTIONALLY FORBIDDEN unless separately granted and attributable | YES |
| Financial read/finalization | SUPPORTED | SUPPORTED after valid Plan/GO | customer-scoped read/approval only | NOT APPLICABLE | provider/service outer flow converges on local model | YES |

Quote conversion intentionally remains different from generic create-order: it preserves the approved quote’s price, tax, PBV2, artwork, proof, and customer/contact snapshots rather than repricing a request.

## Boundary evidence

- Architectural tests assert that the representative order and quote applications have no direct `user_organizations` query; membership revalidation lives only in `PostgresPrincipalContext`.
- Architectural tests assert that `AuthorityPolicy` has no persistence dependency and interface adapters have no persistence/SQL/V1 service dependency.
- Portal and Service subjects resolve to no Staff actor. V2-private attribution records carry principal kind/subject and an optional verified Staff actor instead.
- The original string-actor methods remain compatibility wrappers for pre-existing POC tests. Typed-principal entry points are the canonical operation surface; no new adapter is permitted to call the legacy methods.

## Validation

The combined V2 regression completed against the guarded disposable PostgreSQL target: 49 PostgreSQL integration tests and 26 in-memory/boundary/safety tests, all passing. The V2 harness required `V2_POSTGRES_INTEGRATION=1`, used only `TEST_DATABASE_URL`, and rejected alternate database URL variables.

The next task is **CREATE THE PRINTERSHERO V2 RECONSTRUCTION MASTER PLAN**. This POC phase is closed; do not start another V2 feature experiment from this branch.
