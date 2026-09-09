# M7.7F Blocked-Path Validation

## AI: PASS (deterministic orchestration)

On DEV deployment `e924dbb`, authenticated M7 QA validation created one canonical synthetic inbound intake. `PREPARE` produced a pending `inbound.mark_duplicate` command without mutation; `CANCEL` marked that command cancelled and left the intake `received`; a new `PREPARE` created a distinct pending command. Literal `GO` transitioned the intake once to `duplicate`. Repeated `GO` returned a conflict and the detail endpoint confirmed the single terminal transition. Foreign-organization AI use returned 403. Hostile text produced no tool command. No external AI provider was called.

The first GO exposed PostgreSQL parameter inference in the canonical inbound transition. Explicit SQL casts repaired it; the original attempt failed closed and made no transition.

## Inbound: PARTIAL PASS

Canonical V2 synthetic ingestion, cancellation/retry-safe AI execution, and terminal duplicate transition are live-validated. V2 route tests cover exact-tenant rejection and malformed timestamps. Full human review, attachment adoption, and Order conversion remain to be exercised against QA fixtures.

## Proof: READY FOR QA VALIDATION

The exact-tenant suppression seam has focused guard coverage. The live Proof v1 → revision → v2 → approval/stale-response matrix has not yet been run; real Gmail delivery remains intentionally unvalidated.

## Portal: READY FOR QA VALIDATION

The exact-tenant, owner/admin, confirmed activation seam has focused guard coverage. The live activation/login and object-scope matrix has not yet been run; production Gmail activation remains unchanged and unvalidated here.

### M7.7F-G4 — QA Portal capability-ceiling correction: PASS

On DEV deployment `9299cf5`, the dedicated QA Customer A (`f1b72675-c565-4e85-8c41-53bf3ce8b58a`) had an active Portal permission-set assignment but no customer capability ceiling. The runtime correctly computes the Portal principal as the intersection of assigned and ceiling capabilities, so the empty ceiling intentionally masked `product.view` as Catalog `403` and `proof.view` as Proofs `404`.

No PortalPrincipal code was changed. The canonical, transactional `setCustomerPortalCeiling` authority service established an explicit QA-customer ceiling and emitted `customer_portal_ceiling_changed` audit evidence. The persisted assignment, resulting ceiling, and effective intersection are each:

- `invoice.view`, `order.create`, `order.view`, `payment.record`, `payment.view`
- `product.view`, `proof.respond`, `proof.view`, `quote.create`, `quote.view`

Fresh QA Portal authentication then proved the corrected live authority and customer scope. `GET /v2/portal/proofs` returned `200` with its valid empty `items` collection; no Proof was manufactured merely to produce a non-empty response. Before catalog provisioning, `GET /v2/portal/catalog` likewise returned `200` with an empty collection, proving that no entitlement is distinct from no authority.

One existing active QA Product (`89726ea4-61de-4612-bb2a-89d20c07263d`) was enabled for Customer A only through the canonical staff commercial-entitlement route. A fresh Portal session then received Catalog `200` with that product visible and price-preview `200` with canonical server-calculated `{ cents, currency }` amounts. No customer pricing agreement was needed: the preview correctly used the standard pricing fallback (`customerAgreementApplied: false`). Other QA customers have neither an active entitlement nor an active pricing agreement for this fixture Product.

The ceiling behavior itself was live-proven through the same canonical service: an assigned capability temporarily removed from the ceiling did not become effective, and `fulfillment.view` temporarily placed only in the ceiling did not become effective. The exact approved Customer A ceiling was then restored. No staff/admin capability entered the Portal principal. All reset delivery was suppressed by the QA-only seam and no provider call was attempted.

## Lifecycle

No broad already-proven production/fulfillment/finance paths were re-run. Consequently, the complete cross-workflow lifecycle is still pending final QA evidence.
