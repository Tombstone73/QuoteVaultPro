# Post-M6 operational queue hygiene

## Disposition

**CONSOLIDATE NOW:** Prepress queue selection uses one canonical repository query with an explicit optional `requirementState` (`configured`, `unconfigured`, `all`). Both count and item queries apply the same bound SQL predicate before pagination, within the existing organization, open/nonarchived Order, active/pending route, and Prepress-route scope. The default API remains `all`, preserving the Production workspace consumer.

**ARCHIVE / HIDE FROM ACTIVE WORK:** The Prepress workspace defaults to **Active work** (configured requirements). A visible **Needs configuration** count opens a nondestructive recovery view; **All routed work** preserves combined review. These are derived views, not persisted archive states. Unconfigured lines retain Order/Customer/Artwork navigation and original evidence. They have no invented requirements or preparation actions. Incoming line/unit deep links use the combined view, preserving previously visible historical work.

**REMOVE NOW:** Removed `filterPrepressQueue`, an obsolete local search helper referenced only by two assertions in the hook-order test. The actual UI already sent search to the canonical server queue. The replacement regression drives the search input and verifies `q`, filter, and reset page reach that API. This eliminates a misleading second search authority without removing working functionality.

**CONSOLIDATE NOW (integrated Builder/pricing agent work):** Proofing, Prepress and Production now use `OperationalQueuePager`, preserving the same paging contract and callback behavior.

**KEEP:** Prepress coverage and execution ownership, existing unconfigured coverage union, frozen requirements, exact side/page/layer matching, and direct unit/line detail APIs. Production continues to call the all-work default. Proofing, Production, Fulfillment, Routing and Sales lifecycle queries remain authoritative for their domains.

**REVIEW / DO NOT DELETE:** Historical unconfigured records, attached Artwork, QA evidence, and valid operational records. This change neither deletes nor updates database rows. New valid unconfigured work also appears prominently in Needs configuration; the view does not presume every unconfigured record is historical.

## Canonical owner path

- HTTP: `v2/src/interfaces/http/prepressRoutes.ts`, mounted under `/v2/organizations/:organizationId/prepress`; queue `GET /queue`, unit `GET /units/:id`, line coverage and units, canonical open/start/complete mutations.
- Service: `v2/src/modules/prepress/prepressApplication.ts`, `PrepressApplicationService`; principal organization scope and `prepress.view` are checked before every queue read.
- Repository: `v2/infrastructure/prepress/postgresPrepressTransaction.ts`, `listQueue`; count and rows share one WHERE predicate. Artwork and requirements are read only for the bounded page.
- UI: `v2/ui/src/PrepressWorkspace.tsx`, through `prepressApi.list` in `api.ts`; cache keys include session, organization, page, size, search and requirement state.
- Contract: `v2/src/modules/prepress/contracts.ts`, `PrepressQueuePageRequest`, `PrepressQueueRequirementState`, `PrepressQueueItem`, `OrderLinePrepressCoverage` and `PrepressUnit`. Shared paging remains `v2/src/modules/shared/operationalQueue.ts`.

## DEV evidence

A read-only DEV snapshot executed `PrepressApplicationService` -> `PostgresPrepressTransaction.listQueue` for the primary organization after this implementation. Results: **4 configured / 18 unconfigured / 22 combined**. Each total matched the fetched page of up to 100 items; all coverage states matched the requested filter. No returned underlying row was cross-tenant, archived or non-open. Evidence: `codex-artifacts/post-m6/prepress-views-dev.json` (local artifact; the historical-data report owns full provenance/classification).

All 18 unconfigured primary-organization rows belonged to the identified DEV QA fixture customer. None had frozen requirements/fingerprints, Prepress units or Production work. Two retain Artwork (one and two assignments respectively). Keep them auditable and accessible through recovery; their QA provenance alone does not justify destructive deletion in this milestone.

No migrations, requirements fabrication, database writes, provider calls, V1 edits, or MAIN edits were performed by this subtask.

## Validation

- `v2:check`, `v2:ui:check` passed after the filter implementation.
- `v2/tests/infrastructure/prepressQueueHygiene.pure.ts`: actual SQL parameter/scope contract for all/default/configured/unconfigured, same count/item WHERE before LIMIT/OFFSET, bounded coverage reads, unchanged unconfigured evidence, real route -> service input validation, invalid/array/injection-shaped filters, cross-tenant requests, RBAC denial and old default compatibility.
- `v2/ui/src/prepressQueueHygiene.test.tsx`: default active view, visible recovery count, recovery selection and Order navigation, no fabricated actions, server search, combined view, permission/organization transitions, historical line/unit deep links and API transport/defaults. Every mocked operation is GET.
- Existing Prepress visual and permission/hook-order tests passed with filter-aware cache keys; no meaningful coverage was removed.
- Live DEV canonical repository read checks above passed; parent integration owns full-suite/build/browser validation.

## Remaining limitations

The derived recovery view covers the same eligible open routed Orders as the former queue. It is not a new archive/history database facility. Archived/completed Order history remains under its canonical owner UI. Existing deep links to records outside the queue's current page still depend on the pre-existing bounded queue navigation; this change prevents the new requirement filter from hiding historical links, without adding a separate detail projection or new historical state.
