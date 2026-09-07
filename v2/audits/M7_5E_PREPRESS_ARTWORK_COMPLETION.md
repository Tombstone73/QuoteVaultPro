# M7.5E Prepress and Artwork operational completion

## Disposition

**Implemented and source-validated; not live-validated.** M7.5E makes the canonical V2 Prepress path operational in `dev`. It does not deploy, mutate production, or contact a provider.

## Prior gap and authority boundaries

Prepress previously had a queue and immutable unit start/complete evidence, but lacked production-ready artwork revision, visual access, work context, a server-authoritative readiness result, and a canonical production handoff.

Artwork remains the sole file/storage/assignment authority. Proofing still owns proof versions, approval and revision-request evidence. Routing owns destination configuration and frozen route movement. Prepress owns preparation evidence only; it does not invent a file system, a proof approval, a station name, or a shadow production job.

## Artwork access, upload, and revision

The Prepress workspace now exposes server-projected source and current production artwork references, ART/NO ART queue cues, content-type-aware selected PDF/image access through the authenticated Artwork content route, and canonical open-artwork navigation. Queue APIs contain references and metadata only; they never return binary artwork.

`POST /artwork/prepress/production-uploads` is a constrained adapter over the existing Artwork upload service. It accepts only `purpose=production`, requires both `prepress.work` and `artwork.adopt`, and retains the existing tenant/order/line checks, storage upload ledger, idempotency, audit, and immutable assignment-supersession behavior. A replacement creates a new current production assignment and retains the prior assignment/file lineage. Source/customer artwork and proof artifacts are not overwritten.

## Prepress read model and readiness

The paginated, server-owned Prepress projection now includes canonical order/line context, due date, quantity, frozen expected dimensions, detected artwork dimensions when present, material snapshots, source/current production artwork references, proof status, current frozen route/destination, and explicit readiness blockers. It preserves the Active and Needs configuration separation, excludes bypassed and post-Prepress lines, and avoids N+1 browser composition.

Readiness fails closed for missing production requirements, current production artwork, completed Prepress units, required proof approval, frozen route, or frozen station destination. The UI renders those backend blocker reasons; it does not reproduce the rule set.

## Route-step destination authoring and frozen provenance

Routing now has the smallest authorized, tenant-scoped `route.manageTemplates` authoring path for a Route Template production step to `flatbed` or `roll`, with operation idempotency, attribution, audit, validation, and an unconfigured state in the canonical Routing workspace.

M7.5E also repairs the M7.5D provenance flaw: migration `0266` snapshots a configured destination onto new `v2_route_instance_steps`. The old template-step pointer was intentionally removed by historical migration `0194`; no runtime now relies on it. Existing/historical route instances have a null snapshot and remain fail-closed. Template changes cannot alter a frozen Order route's destination.

## Prepress handoff

`POST /prepress/units/:prepressUnitId/send-to-production` is an idempotent single transaction. It locks the completed Prepress unit and open Order route, verifies all current production-art requirements and required proof approval, requires the frozen mapped destination, advances the route, and inserts or reuses every corresponding canonical Production work. It requires `prepress.complete`, `route.advance`, and `production.work`, records audit evidence including destination, and cannot leave an orphaned job. Production queues and attempt start enforce the same frozen destination.

Prepress bypass remains respected: lines explicitly not requiring Prepress are excluded from the active queue and receive no dummy completion record.

## Validation

Passed locally:

- V2 TypeScript and V2 UI TypeScript checks with incremental write disabled
- V2 import-boundary check
- migration integrity: 262 protected historical V2 migrations unchanged
- Prepress queue hygiene and frozen-route handoff contracts
- Prepress operational UI, production-art upload panel, route-mapping UI, and Product Builder routing presentation contracts
- `git diff --check`

The root `npm run check` and named npm scripts could not be invoked because this runtime has no `npm` executable. Their strongest local equivalents were run directly. DB-backed Jest suites refused the configured `TEST_DATABASE_URL` before any connection because its database name does not carry the required standalone test/testing/ci marker; the safety guard was not weakened. No authenticated DEV runtime was available.

## Remaining dependencies for M7.5F

- M7.5F must complete Flatbed/Roll operator stations over these canonical production works; it must not create another handoff authority.
- Historic route instances without a frozen destination remain blocked until an authorized reconciliation/new-route process establishes safe provenance.
- M7-wide P0 inbound, shipping, portal, and M7.5F station gaps remain. Proofing visual/revision completion remains P1.

Production mutations: **none**. Application/business-data mutations: **none** outside the local source worktree. Provider writes: **none**.

Deployable but not yet live-validated.
