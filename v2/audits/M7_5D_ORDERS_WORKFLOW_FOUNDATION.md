# M7.5D operational Orders and flexible workflow foundation

## Scope and disposition

**Disposition: implemented and source-validated; not live-validated.** This milestone makes the V2 Orders workboard and exceptional, line-scoped workflow paths executable in `dev`. It does not authorize a production deployment, a provider call, or a production data change.

## Operational Orders workboard

`GET /v2/organizations/:organizationId/orders` now has a tenant-qualified, server-owned operational projection for canonical V2 Orders. It is intentionally additive: legacy rows retain their read-only compatibility shape.

The projection exposes only bounded operational facts: primary contact/representative, artwork/no-art summary, canonical commercial-note indicator, prepress state, production state and selected Flatbed/Roll destination, fulfillment state, billing/open-balance state, and overdue/artwork attention. It does not expose an object key, asset bytes, or a provider identity.

The bounded workboard filters (`needs_artwork`, `prepress`, `production`, `flatbed`, `roll`, `ready_for_fulfillment`, `fulfillment`, and `open_balance`) are evaluated by PostgreSQL before keyset paging. Lifecycle, due-date, search, archive, summary, and cursor behavior remain server-owned.

The Orders UI restores lifecycle and workboard filters from a safe local preference scoped by authenticated session and organization. It renders the API projection without re-deriving business state in the browser.

## Workflow policy and canonical paths

The tenant policy is `organizations.settings.preferences.workflow.policy`. Valid values are `flexible`, `guided`, and `strict`; missing or malformed settings resolve to **strict**. Every exception also requires the narrow `workflow.override` capability, granted by the migration only to owner/administrator templates. The policy therefore never grants authority by itself.

Two current, line-scoped exception commands are available only through authenticated V2 Orders routes:

- Direct Production moves a frozen route from its current bypassable Prepress step to its canonical Production step. It requires current production artwork, an approved current proof when frozen product facts require proof, no existing production work, explicit confirmation under guided/strict policy, and an explicit frozen-template step mapping to Flatbed or Roll.
- Production Not Required requires an operator reason, rejects a line with any production work, records an attributable exception, and advances only a frozen prepress/production path to its canonical fulfillment step. It records no fictitious prepress or production completion.

`GET /orders/:orderId/workflow/actions` supplies exact current line actions, confirmation requirements, allowed destinations, reason requirements, and an eligibility explanation. The detail UI shows no workflow control unless this endpoint permits it; it refreshes the canonical data after a command succeeds.

Migrations `0264` and `0265` add the auditable exception record and explicit route-template production-destination mapping. Existing routes are never guessed or backfilled from labels. A direct action is absent/rejected until exactly applicable destination configuration exists. Destination selection also constrains untouched workboard queue visibility and the first production attempt.

Mixed orders remain supported because all requirements and exceptions are line scoped. Automatic Order closure continues to require actual required production completion (or an explicit Not Required fact), fulfillment completion where required, route completion, and canonical invoice settlement. Terms and QuickBooks state do not settle an Order.

## Traveler decision

The existing production traveler is retained. It is a private, canonical PDF for a production work item and reads frozen order, configuration, required unit, quantities, material, and artwork-reference facts. It has an existing authenticated preview route and needed no parallel Orders-document implementation in this milestone.

## Validation

Passed locally:

- V2 TypeScript check (`tsc -p v2/tsconfig.json`)
- V2 import boundaries
- V2 UI TypeScript check (`tsc -p v2/ui/tsconfig.json`)
- migration history integrity (261 protected historical V2 migrations unchanged)
- workflow policy/exception, persistence, Order projection/pagination/filter, and HTTP route pure contracts
- Orders workboard, scoped preference, and workflow-action UI presentation contracts
- `git diff --check`

The root `npm run check` script could not be invoked because this runtime contains Node and project executables but no `npm` executable. Its equivalent local `tsc --noEmit` invocation still reports existing unrelated V1/client/server errors (including legacy order action-panel fixtures, fulfillment, inbound, QuickBooks, assistant, and other V1 modules), plus an unavailable `node_modules/typescript/tsbuildinfo` write. No M7.5D V2 diagnostic was reported. No authenticated DEV runtime was available, so there is no live DEV claim.

## Remaining boundaries

- Route-template destination mappings need a normal authorized administration/authoring path before operators can use Direct Production for a route. The fail-closed behavior is intentional until then.
- This does not complete the separate P0 Prepress, Flatbed/Roll station, shipping, portal, or inbound-intake gaps.
- No provider, production, or deployment validation occurred.

## Safety record

Production mutations: **none**.

Application/business-data mutations: **none** outside the local source worktree.

Provider writes: **none**.

Deployable but not yet live-validated.
