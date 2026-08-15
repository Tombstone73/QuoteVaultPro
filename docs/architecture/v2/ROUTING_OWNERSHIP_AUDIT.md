# Routing Ownership Audit

## Status and executive conclusion

This is an architecture and repository-forensics audit. It defines V2 Routing ownership without implementing Routing, M1, migrations, runtime changes, database writes, or deployment.

V2 Routing is the single owner of **internal PrintersHero work movement**: simple route templates, immutable-at-entry route instances, current/next step, transitions, authorized skips, and manual reroutes. It is not Production execution, Artwork/Proof state, Prepress work, Fulfillment handoff, Product configuration, Nesting, or external transport. A module reports its meaningful result; an explicit coordinating operation asks Routing to perform an expected-step transition.

The smallest viable model is ordered route templates, not a graph editor or workflow language. Default templates are: Printed (`Proofing -> Prepress -> Production -> Fulfillment`), Static / Resale (`Fulfillment`), and Service / Fee (normally no route). Product Type references the default template. A route instance is frozen when a routable work item enters an Order workflow, so later Product or Product Type changes affect only new work.

## 1. Current V1 routing map and competing authorities

V1 has no single Routing authority. At least seven materially different paths decide or infer what comes next:

| Current authority | What it decides or mutates | V2 disposition |
| --- | --- | --- |
| `server/services/productionRoutingResolver.ts` | Initial/post-Prepress station from organization setting, Product Type station/step, line snapshots, Product Type name inference, and flatbed fallback | RECONSTRUCT in Routing; retain only useful validation evidence |
| `server/services/productionScheduling.ts` | Whether a line is schedulable; proof gate; direct workflow/job scheduling | RECONSTRUCT as explicit Production/Routing coordination |
| `server/services/lineItemWorkflowService.ts` | Line workflow-state graph, active job owner, state/job transitions, and parent Order synchronization | RECONSTRUCT; split module state from route position |
| `server/routes/prepress.routes.ts` | Prepress completion/send-to-print downstream selection and job transitions | RETIRE route decisions from handlers |
| `server/routes/productionJobs.routes.ts` and `productionCompletionRouting.ts` | Completion successor, job creation, line completion, Order fulfillment target | RECONSTRUCT; Production reports outcome, Routing transitions |
| `server/services/productionRunService.ts` and `productionReturnToPrepressService.ts` | Combined-run movement/recovery back to Prepress | RECONSTRUCT behind Production outcome plus Routing reroute |
| Fulfillment eligibility/services | Infer readiness from Order state and update fulfillment fields | RECONSTRUCT as consumption of Routing destination plus Fulfillment facts |

`productionRoutingService.ts` calls itself the canonical production-job path, but it owns station resolution, active-job deduplication, inserts `production_jobs`, and even creates a Fulfillment station. It is valuable evidence for tenant scoping, expected-state/idempotency, and no-duplicate-job constraints; it is not future Routing architecture.

## 2. V1 terminology classification

| V1 concept | Classification and future owner |
| --- | --- |
| `workflowIntent` (`standard_production`, `fulfillment_only`, `service_fee`) | A. Product classification; replace with clearer Product Type/simple facts over time |
| `requiresProductionJob`, `requiresProofApproval`, `requiresPrepress` | A / requires product decision: Product or resolved configuration requirement inputs, never route state |
| `defaultStationKey`, `defaultStepKey`, Product Type name inference | C. Routing decision leak; replace with Product Type default Route Template reference |
| PBV2 `workflowTags`, `routing:*`, `workflowMetadata` | C / requires product decision: replace only with typed resolved requirement facts; never route control |
| `ready_for_prepress`, `ready_for_production`, `in_production`, line `workflowState` | Mixed C/E/F legacy state; reconstruct as separate module facts plus Route position |
| proof approval/version | D. Artwork/Proof truth; Routing consumes a proof-gate result |
| Prepress preparation/session/final file | E. Prepress/Artwork truth; Routing consumes completion/readiness result |
| station/machine/production-run/member outcome | F. Production execution truth |
| fulfillment-ready quantity, pickup/handoff | G. Fulfillment truth |
| Local Bridge/Onyx copy, RIP-managed file strategy | H. Integration transport/result, not Routing |
| Product-Type-name station fallback, auto-created Fulfillment station, status-pill workflow meaning | I. Legacy coupling to remove |
| installation, future specialty work, exact proof-loop policy | J. Product/architecture decision when real requirements require it |

## 3. Product Type and PBV2 boundaries

Products owns product identity, lifecycle, and simple classification facts: printed/static/service, dimensions/production class, whether a proof/prepress/production requirement may apply, and possibly finishing/installation facts. Product Type owns or references the **default Route Template** relationship. It does not own station sequences, transitions, or a workflow engine.

V1 overloads `product_types.defaultStationKey`, `defaultStepKey`, `sendToProductionDefault`, and `requiresPrepressOverride` (`shared/schema.ts`; `productionRoutingResolver.ts`). Product Type name inference and a post-Prepress re-read of the current Product Type are direct conflicts with the V2 active-route stability rule. A default template may be changed or disabled for future selection, but it cannot alter an existing instance.

PBV2 is a configuration/pricing structure. Current `workflowTags`, free-form template `workflowMetadata`, Product Intake `draftRouting` stored in PBV2 `treeJson`, and generated `routing:*` tags (`shared/optionTreeV2.ts`, `shared/pbv2/pricingAdapter.ts`, `server/services/productIntakeWizard/productIntakeDraftRelationships.ts`) are routing leaks. PBV2 may expose typed resolved facts--for example `requiresProof`, `requiresPrepress`, `finishingRequired`, selected material, sides, or dimensions--but must not select a station, instantiate a route, or advance work. Recipe/BOM consumes manufacturing requirements; Inventory owns material effects.

## 4. Target Route Template model

A Route Template is Routing-owned, organization-scoped, named, active/inactive, revisioned ordered step definition used to create routes for new work. Its smallest required concepts are:

- template identity, organization, name, active state, immutable revision;
- ordered step definitions with a module step type (`Proofing`, `Prepress`, `Production`, `Finishing`, `Fulfillment`), required/optional flag, and small immutable metadata;
- optional destination/station **category** metadata for a step, not an executable rule payload or required device identity;
- Product Type default-template reference, validated through Routing's template contract.

Routing owns template content and validity. Products stores only the association. Settings may store organization-level default-template or station-default configuration, but Settings is not the route engine. Production owns actual stations/machines and may resolve an eligible specific station when it executes a Production/Finishing step. Do not hardwire a machine into a template unless a proven requirement demands it.

Initial vocabulary is deliberately small: Printed; Static / Resale; Service / Fee; and, when real work needs it, Printed + Finishing. Finishing, cutting, lamination, mounting, and fabrication are initially Production step types/station categories with route metadata, not top-level modules. Installation remains a Product/Route fact until it acquires independent scheduling/crew/site lifecycle.

## 5. Target Route Instance and canonical routing unit

A Route Instance is Routing-owned, job-specific work movement created from a selected template revision. It persists the source template/revision, work-unit reference, stable planned work allocation, ordered frozen step definitions, current/next step, expected-state/revision for concurrency, and concise reroute history with actor/principal and reason. It does not snapshot full route state on every click. An append-only step-visit/transition record captures every entered, completed, skipped, held, and re-entered visit; a proof revision, reprint, or return to Prepress never overwrites an earlier completion.

The canonical routing unit is a **routable work item**, normally one non-parent Sales Order Line's manufacturing requirement:

    Sales Order Line -> routable work item -> Route Instance -> Production job/run membership when execution is needed

An Order is too coarse because it can combine printed, resale, and service lines. A Production job is too narrow because it is an execution record; Production runs can group many work items. Parent bundle lines remain Sales commercial/presentation structure; independently executable child/standalone work facts receive routes. Sales owns commercial quantity, Production owns actual output, and Routing owns only stable work allocation/lineage. A partial, split, or reprint case uses a named coordinated work-item split/allocation operation with idempotency and quantity-conservation checks across children, production outcomes, and fulfillment handoff; it never forces one line through impossible partial/parallel state.

Routes begin when canonical Sales creates or confirms an **Order** and identifies a routable work item. At that boundary, Routing resolves one active/published template revision from the Product Type template family and freezes it. If no valid template exists, the operation fails with an actionable domain conflict or requires an authorized explicit selection; it never uses Product Type name inference, a disabled-template fallback, or Flatbed default. Quotes create no active route, Production job, or Prepress workflow merely because they describe a product. Static/resale work begins at Fulfillment; service/fee lines create no route unless a Product Type explicitly defines real operational work.

## 6. Proofing, Artwork, and Prepress relationship

Proofing is a default route step/gate for printed work when the resolved Product policy requires it. Artwork owns source/derived/proof artwork, version, and approval/rejection truth. Routing only consumes a fact such as proof approved, proof not required, or authorized proof override. Before transition to Production, the result must be an Artwork-owned assertion that the designated production-artwork/proof version for this work item remains approved and unsuperseded; an Artwork replacement or rejection holds or reroutes work rather than accepting a stale approval. A rejected/replaced proof does not overwrite Artwork state with route state: an explicit expected-step reroute/hold returns the affected work to the appropriate Proofing or Prepress step with reason and attribution.

Prepress remains a simple bounded module: it selects/prepares a production Artwork file and reports validation/readiness/destination proposal. Prepress completion must not select the next station or change a line/order/fulfillment status. A coordinating operation atomically records its result and asks Routing to transition the expected Prepress step. The present route-handler selection in `server/routes/prepress.routes.ts` and direct Local Bridge queueing are reconstruction inputs, not V2 boundaries.

Proofing and Prepress remain steps because the initial desired route has distinct operational destinations and gates. They are not owners of route position. A Product whose proven policy does not need either gets a template without that step rather than a pile of unrelated bypass flags.

## 7. Production, stations, finishing, and Nesting

Production owns jobs, station/machine assignment, starts/completions, quantities, actual usage, failure facts, and execution history. It may create/claim/start/complete a job for the current Production or Finishing route step; it reports an outcome. Routing validates the expected current step and moves the work to the next internal destination. Production never directly marks Fulfillment, creates a Fulfillment job, or declares the Sales Order complete.

Stations are Production/Settings configuration. Routing references a step type and, when justified, a station category such as Roll, Flatbed, Finishing, Lamination, CNC, or Fabrication. Production resolves a specific machine/station; route templates do not use station names or device inference as business authority. V1 `productionCompletionRouting.ts` custom `on_complete_route` maps and `productionRoutingResolver.ts` name/fallback logic must be reconstructed as explicit template/transition behavior.

Nesting is separate reusable calculation/optimization. Production may create a combined run and attach per-member work items; Nesting returns a nest/result. Every member retains its own Route Instance, and Production reports a result per member so Routing advances each independently. A combined run is not a route, and neither PBV2 nor Routing owns nest calculations.

## 8. Fulfillment, static/resale, and service behavior

Fulfillment is a route destination/step, not a Production station. Routing transitions a completed-enough work item into Fulfillment after a Production outcome. Fulfillment owns availability, packing, partial/multi-visit pickup, shipment request, handoff, and completion. It must not infer route completion from a random Order status.

Static/resale products use a Fulfillment-only template and create no fake Prepress or Production job. Service/fee lines are normally Sales/Billing-only and have no route; a service with genuine operational work receives an explicitly configured template. This retires V1's use of fulfillment as a `production_jobs` station and prevents static work accidentally creating Production state.

Partial production is an execution outcome, not automatic route completion. Routing advances only the completed allocation/work item authorized by the reported result; remaining work stays at its current step or is explicitly split through the conserved-allocation contract. A fulfillment handoff may draw from legitimate stock or other sources under Fulfillment/Inventory policy, but that does not let Production mutate Fulfillment truth.

## 9. Transitions, reroutes, skips, and history

A normal transition is explicit and idempotent:

    source module records meaningful result
      -> coordinating application operation requests Routing.transition(expected current step, result reference)
      -> Routing validates scope/current revision/step and records transition
      -> commit Audit and durable work as needed

Use an atomic cross-module operation when integrity requires it, without writing foreign tables or calling foreign repositories. There are no hidden database triggers, status watchers, or client-selected successor stations. Duplicate/concurrent completion must resolve through an expected-step/version/idempotency key: the first valid transition wins; equivalent replay returns its result; a stale/incompatible completion conflicts safely.

`route.reroute` is a permissioned named operation for machine failure, return to Prepress, adding Finishing, moving to another production step, or reopening governed work. It records actor/principal, reason, prior/current resulting step, and correlated source facts. It rejects or explicitly coordinates active Production jobs/runs, completed Fulfillment handoffs, and incompatible proof/prepress states, and never deletes prior history. `route.skipStep` is distinct, permissioned, reason-required, and only skips an actual route step after the same domain-gate coordination. Proof override remains Artwork/Proof policy; recording no production execution remains Production; neither becomes a generic Routing bypass. Sales cancellation, line removal, Order reopen, and route voiding are named coordinated operations that retain route history and prevent orphaned Route Instances.

Routing history is concise: route created; step entered; step completed; step skipped; manually rerouted; meaningful hold/reopen. Audit/History can project these with operation attribution, but Routing owns current route truth and does not create full snapshots per transition.

## 10. Status versus route position and user interface

V1 line `workflowState`, line/order statuses, active production job status, `routingTarget`, and `fulfillmentStatus` overlap. `lineItemWorkflowService.ts` even synchronizes a parent Sales Order to `in_production`; production completion marks a line complete when it merely moves toward Fulfillment. This is a V2 boundary violation.

V2 retains module status separately from route position:

| Fact | Owner example |
| --- | --- |
| Proof approved/rejected; Artwork designation | Artwork |
| Prepress prepared/failed | Prepress |
| Job queued/started/completed; produced quantity | Production |
| Current route step = Fulfillment | Routing |
| Packed/picked up/handed off | Fulfillment |
| Order commercial lifecycle | Sales |

The UI consumes scoped DTOs to answer: **Where is this work now? What happens here? What is next?** It may render module statuses alongside route position, but must not combine them into one fictional company-status enum, calculate eligibility, or select transitions. Existing production-board, Prepress action, combined-run eligibility, status-pill, and timeline code are presentation/characterization evidence only; `orderStatusPillService.ts` and Timeline projections must not become route authority.

## 11. Integrations, permissions, and authority

Routing is entirely internal. It may decide that a production-ready file is eligible for Onyx/Local Bridge handoff or that work has reached a destination; Integrations owns actual external transport, provider/device receipts, retries, and reconciliation. `local_file_copy_jobs`, RIP-managed file behavior, and direct production/prepress upload/copy code are Integration/Artwork reconstruction inputs, never Routing state.

Representative Routing capabilities are `route.view`, `route.manageTemplates`, `route.reroute`, and `route.skipStep`. Their final vocabulary remains small and operation-owned. Authentication/Permissions issues a scoped Principal and M0 AuthorityPolicy evaluates capability plus organization/customer scope; named operations must scope-load and validate the real Order/work item. Resource/work-item entitlement is a future policy extension, not a guarantee M0 already provides, and must preserve M0's pure-policy boundary. No `role === Admin` shortcut is allowed. Route create/attach/reroute target scope is derived from the real Order/work item, never from client-supplied IDs. Portal users receive only customer-scoped permitted views/operations; Service and AI use the same named operations under their approved scopes and ceilings.

## 12. Persistence concept and template stability

Conceptual persistence--not a migration prescription--is normalized and simple:

- `route_templates` and ordered `route_template_steps`: organization ownership, identity/name, active state, revision, step type/order/requiredness/small metadata;
- Product Type's default-template reference: a Products-owned association validated by Routing;
- `route_instances` and ordered `route_instance_steps`: work-item reference, template identity/revision/frozen definition, planned allocation/lineage, current step/revision, timestamps, and terminal/hold state;
- append-only route step-visit/transition records: each entry/completion/skip/hold/re-entry, result reference, allocation, actor, reason, and idempotency correlation;
- concise route events/reroute records correlated with Audit/History.

Template revisions are immutable once used. Editing a template creates a new revision for future instantiation; disabling/deleting a template leaves historical and active instances intact. Changing Product Type, Product configuration, or default template never auto-updates an active route. An explicit rebuild/reroute operation must have authority, reason, preflight, history, and a consciously selected target template/revision. Cross-order physical production runs are a V1-supported backend behavior despite a same-order UI assumption; V2 tentatively permits them only as Production grouping with per-member organization/customer scope, attribution, allocation, and independent route results. The exact operational policy remains open.

## 13. V1 reuse, reconstruct, remove, and product-decision inventory

| Current V1 concept | Disposition | V2 treatment |
| --- | --- | --- |
| Production job tenant/idempotency/active-owner lessons | REUSE BEHIND CONTRACT | Characterize expected-state and deduplication guarantees |
| Production run/member allocations and no-history-deletion constraints | REUSE BEHIND CONTRACT | Production execution contract; per-member route outcomes |
| Pure nesting/layout calculations | REUSE BEHIND NESTING CONTRACT | Adapt calculator, not current Production/PBV2 coupling |
| Proof gate and scoped Prepress/Portal safety tests | REUSE AS CHARACTERIZATION | Preserve policy/tenant behavior behind owners |
| Local Bridge least-privilege transport | REUSE BEHIND INTEGRATION CONTRACT | External handoff only |
| `productionRoutingService`, resolver, line workflow graph, completion routing | RECONSTRUCT | Split routing from execution/status ownership |
| Product Type direct station/step defaults and name inference | REMOVE | Default Route Template association |
| PBV2 workflow tags/draft station metadata | MOVE / RECONSTRUCT | Typed facts only; route selection belongs Routing |
| Fulfillment Production station and auto-bootstrap | REMOVE | Fulfillment route step plus own handoff facts |
| `productionBypassed` generic boolean and route-handler bypasses | RECONSTRUCT | Product applicability plus explicit skip/reroute/domain override |
| Parent route behavior | RECONSTRUCT | Sales bundle facts -> child/standalone routable work items |
| Product Intake route inference | REQUIRES PRODUCT DECISION | Reviewable Product/Route template proposal, never PBV2 truth |

High-value characterization tests include `productionScheduling.routingReason.test.ts`, `productionCompletionRouting.test.ts`, `productionRoutingService.fulfillment.test.ts`, `productionReturnToPrepress.contract.test.ts`, `productionRunCompletionIntegrity.contract.test.ts`, `productionRunPrepress.contract.test.ts`, `prepressQueueEligibility.test.ts`, proof approval/revision tests, and `client/src/lib/prepressCombinedRuns.test.ts`. Recast them as operation/authority/concurrency contracts, not V1 route-wiring tests.

## 14. Five highest-risk reconstruction points

1. Current Product Type/name/org-default inference can silently choose a different destination after work has begun.
2. Line/order/production/fulfillment statuses are coupled, allowing Production completion to prematurely imply fulfillment or Order completion.
3. Combined runs, partial quantities, and failure recovery can advance one member incorrectly, violate quantity conservation, or lose the ability to return safely to Prepress.
4. Bypass/recovery flags and route handlers are distributed and can bypass proof, authorization, history, or expected-state checks.
5. Concurrent completion, duplicate scheduling, stale route step, and external handoff can create duplicate work or move work after the source operation failed.

## 15. Target V2 architecture: explicit answers

1. **What is a Route Template?** A Routing-owned, ordered, revisioned organization template for future work.
2. **Who owns it?** Routing; Products owns only the Product Type reference.
3. **What is a Route Instance?** A frozen job-specific copy/reference of the template revision with per-step progress.
4. **What gets routed and when?** A routable work item, normally a non-parent Order Line manufacturing requirement, on Order workflow entry--never a Quote.
5. **What is a Route Step and who advances it?** An ordered internal destination/gate. Routing advances after an explicit report from its owning module.
6. **How are Proofing/Prepress/Production/Fulfillment represented?** Route steps; Artwork/Prepress/Production/Fulfillment still own their respective business facts.
7. **How do static/resale and service/fee lines work?** Static begins at Fulfillment; service/fee has no route unless actual work is explicitly configured.
8. **How is Finishing added?** A template step with Production station-category metadata, then explicitly rerouted/templated when required.
9. **How are reroutes/bypasses handled?** Permissioned expected-state `route.reroute`/`route.skipStep` with reason/history; domain-specific overrides stay with their owners.
10. **Do active jobs change with Product Type/template changes?** Never automatically; only a deliberate audited rebuild/reroute can change them.
11. **How do combined runs and failures work?** Production groups and reports each member, including cross-order members only under explicit scope/allocation policy; Routing moves each work item independently, and failure can trigger governed reroute/split.
12. **What does Routing consume?** Product Type template/simple facts; typed PBV2 facts; Artwork proof/readiness; Prepress result; Production outcome; Fulfillment result.
13. **What is not Routing?** Pricing/configuration, artwork/file truth, execution/quantities, stock, fulfillment/shipping/billing, nesting calculation, and external handoff.
14. **What V1 can be reused?** Narrow idempotency/recovery/nesting/tenant-scope behavior tests and adapters behind contracts.
15. **What must be reconstructed or retired?** Station inference, workflow/status coupling, production-owned fulfillment routing, PBV2 route metadata, bypass booleans, and route-local handlers.

## 16. Safe future sequence and exit criteria

1. Freeze V1 characterization tests for routing, proof/prepress gates, recovery, member outcomes, tenancy, and idempotency.
2. Define Route Template, Route Instance, routable work-item, transition-result, and authority contracts.
3. Approve Product Type simple facts/default-template association and PBV2 typed resolved-fact boundary.
4. Implement the simple Routing domain/persistence and template revision semantics.
5. Implement route instantiation for one printed V2 Order-line slice.
6. Connect Proofing, Prepress, Production, and Fulfillment through explicit expected-step transitions.
7. Add static/resale, then controlled service/fee applicability.
8. Add manual reroute/skip, partial outcomes, split work, and combined-run member behavior.
9. Retire V2 dependence on V1 route/status inference only after parity and cutover evidence.

Routing is ready to implement only when: canonical work-item identity and template selection are approved; module outcome/transition contracts and scoped permission matrices have negative tests; templates/instances are stable across Product changes; static/service behavior is explicit; reroute/skip/partial/concurrent transition rules are approved; Production cannot mutate Fulfillment/route truth; PBV2/Integrations cannot move work; and V1 compatibility/reconstruction decisions are time-limited.

## 17. Open product decisions

Open decisions include: exact Product facts versus resolved configuration requirements for proof/prepress/finishing; proof rejection/revision loop UX; whether prepress destination is a proposal or a route constraint; definition and split policy for partial quantities; cross-order production-run operational policy; initial station-category taxonomy; service types that warrant routes; installation's future module threshold; exact route-template edit/rebuild UX; and Recipe/BOM's final write ownership.

- **Does V1 currently have one routing authority?** No.
- **How many materially different next-step authorities exist?** At least seven, listed in section 1.
- **Should Proofing, Prepress, and Fulfillment be steps?** Yes when their template applies; their domain facts remain outside Routing.
- **Can most V1 bypass flags be replaced?** Yes, with explicit Routing skip/reroute where movement is bypassed and owner-specific override operations where it is not.
- **What belongs in PBV2?** Typed resolved configuration requirements only; no station, template, transition, or movement decision.
- **What belongs in Production?** Execution, station/machine facts, quantities, runs, and outcomes--not next destination.
- **What belongs in Fulfillment?** Availability/packing/pickup/handoff/shipment request--not route inference.
- **What is the first implementation prompt after all audits?** "Create the V2 Reconstruction Implementation Sequencing / M1 Readiness Plan. Reconcile the approved Module Ownership, PBV2/Pricing, Authentication/Permissions, and Routing audits into ordered M1 contracts, dependencies, characterization tests, and explicit non-goals. Do not implement M1, migrations, V1 changes, or runtime behavior."
