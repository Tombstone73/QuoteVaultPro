# PrintersHero V2 Module Ownership and Boundary Architecture

## Status and purpose

This is the authoritative V2 ownership model. It freezes the bounded modular-monolith boundaries before M1 reconstruction. It is architecture only: not an implementation, migration, refactor, deployment, or V1 behavior change.

V2 remains one repository, one separately deployable V2 application, and one PostgreSQL core. Its modules are explicit ownership boundaries, not microservices. This decision complements the [reconstruction master plan](../V2_RECONSTRUCTION_MASTER_PLAN.md), [reuse/rewrite inventory](../V2_REUSE_REWRITE_INVENTORY.md), [cutover/rollback plan](../V2_CUTOVER_ROLLBACK_PLAN.md), and [M0 foundation](M0_FOUNDATION.md); it does not modify their decisions.

### Revision note: reconciled with the implemented V2 (documentation only)

This document was written before M1 and had not been updated while roughly 70 migrations of architecture were built. It has now been reconciled with the implementation at `origin/dev @ 63f19bd39a5c9c799aae3f5335709d346077c96a`. The revision changes documentation only: it changes no code, schema, migration, or behavior.

How to read the additions:

- **A directory is not an owner.** Ownership is about mutable business facts. A folder such as `v2/src/modules/fulfillment/` may currently *host* code for facts that this document assigns to another owner (Shipping is the main case). Where hosting and ownership differ, the ownership stated here governs and the difference is recorded as **implementation location**, not as a legitimate exception.
- **Approved decisions** (recorded under [Approved architecture decisions](#approved-architecture-decisions)) are binding ownership statements.
- **Known boundary debt** ([below](#known-boundary-debt)) lists confirmed places where current code writes state that this document assigns to another owner. Listing debt records reality; it does **not** authorize the behavior or create an exception.
- **Business decisions required** ([below](#business-decisions-required)) are conflicts in the evidence that this document deliberately does not resolve.
- Evidence and counts live in the non-authoritative [V2 ownership audit](../audits/V2_OWNERSHIP_AUDIT_origin-dev-63f19bd3.md), which never overrides this document.

**Campaign status supersedes snapshot locations.** Per-module implementation
locations and the original debt table record the audited implementation. Read
[Ordering campaign retirement evidence](#ordering-campaign-retirement-evidence)
for subsequent reviewed corrections before treating a recorded caller write as
current behavior. Ownership principles and undecided business policies are not
changed by the retirement record.

## Governing rules

### One business fact, one owner

Each mutable business fact has one authoritative owner. Other modules may hold an identity reference, request behavior through a named operation/contract, or consume an exposed result/event. They must not retain competing mutable truth, directly mutate a foreign persistence model, reproduce a foreign business rule, or reach through a boundary to another module's repository.

A cached projection, explicit reference, immutable checkpoint, or recomputable rendering is not competing ownership when its source and freshness semantics are explicit.

### Current state and history

V2 uses **current mutable state + concise business audit events + intentional immutable checkpoints**. A successful edit records the principal/actor, time, resource, and meaningful changed fields or groups. It does not record mouse clicks, focus, keystrokes, temporary unsaved state, or a complete document version for each save.

Checkpoints exist only at real business boundaries: quote sent/accepted/converted, invoice issued, proof approved, payment/refund recorded, and shipment handed off. Sent quotes and issued invoices retain immutable data/revision sufficient to reproduce the historical document; a PDF is normally rendered on demand, not retained as authoritative data.

### Quote and invoice document rendering

Draft quotes and invoices are rendered on demand from authoritative current data; rendering a draft does not create a durable document artifact. A sent Quote Revision and an issued Invoice preserve the immutable data/revision needed to reproduce what was sent or issued, then render a PDF on demand. Do not retain PDF binaries solely because they were rendered. Any legal, provider, customer-contract, or exact-binary retention requirement must be established explicitly before changing that rule.

### Business and platform boundaries

Business modules own business facts, rules, and lifecycles. Platform modules provide reusable cross-cutting capability and must not acquire business decisions merely because many modules use them. Add a top-level module only when an area has meaningful independent authoritative data, rules, lifecycle/state, operations, and ownership complexity; never create one merely for a technical folder or future work type.

## Complete module map

| Business modules | Platform / cross-cutting modules |
| --- | --- |
| Sales; Products; Pricing / PBV2; Customers / CRM; Inbound Orders; Artwork; Prepress; Production; Routing; Nesting; Inventory / Materials; Procurement; Fulfillment; Shipping; Billing; Communications; Reporting; Portal / Storefront; Bug Reporting | Authentication / Permissions; AI; Settings; Assets; Audit / History; UI System; Search; Integrations |

**Not modules.** Replacements and Cutover are deliberately absent from this map. Replacement is a coordinated workflow across existing owners (see [Replacement and rework coordination](#replacement-and-rework-coordination)). Cutover is a set of evidence gates and procedures (see [Cutover and V1/V2 writer authority](#cutover-and-v1v2-writer-authority)). Neither owns a business fact of its own, so neither is a top-level module.

## Approved architecture decisions

These four decisions were reviewed and approved. They are ownership statements, not descriptions of current code. Where the implementation differs, the difference is recorded under [Known boundary debt](#known-boundary-debt) or as *implementation location* in the module section.

### Decision 1: Recipe/BOM

**Products / Product Builder owns versioned Recipe/BOM authoring.** This resolves the earlier open question "Exact Recipe/BOM write ownership and versioning."

- A Product **Draft** recipe is editable.
- A **published** Product Version recipe is immutable and version-bound.
- An Order Line never references a mutable Product Draft recipe.
- Quote/Order conversion resolves the applicable recipe (and any other applicable material-requirement source) and **freezes** the resulting material requirements on the line.
- **Inventory** consumes the frozen requirements and owns availability, reservations, inventory movements, and inventory accounting.
- **Production** reports actual material consumption.
- **Pricing** does not own Recipe/BOM physical-consumption semantics.
- Inventory must not recompute historical Recipes; it consumes what was frozen.
- **Neutral unit vocabulary** (the unit type used by recipes, reservations, movements, and consumption) must live where Products, Inventory, and Production can all consume it without Production or Inventory depending on Products merely for a unit type. The shared vocabulary location is `v2/src/modules/shared/`.

*Implementation location today:* the unit type `RecipeUnit` is defined in `products/productRecipes.ts` and imported by `inventory/inventoryLedger.ts` and `production/materialConsumption.ts`. That is the dependency this decision says to avoid. It is recorded as boundary debt (BD-7). The requirement resolver (`modules/materials/materialRequirementResolver.ts`) currently derives requirements from two source kinds, `recipe_component` and `pbv2_inventory_consumption`; the decision names the Product Version recipe as the authoring source, so the second source kind's status is part of [Business decision BDR-2](#business-decisions-required).

### Decision 2: Shipping

**Shipping is a distinct domain owner.**

Shipping owns: shipment/container/package lifecycle; carrier and service selection; estimated carrier cost; actual carrier cost; customer shipping price; the shipping pricing policy snapshot and override evidence; labels; tracking; shipment state; carrier handoff facts; combined-shipment allocation facts; and absorbed-freight economics.

**Fulfillment** owns fulfillment availability, pickup/handoff, and fulfillment completion. Fulfillment may *request* Shipping behavior and must not own Shipping state.

**Billing** owns Invoice financial mutations, shipping additional charges, tax calculation and application on the Invoice, Invoice revisions, and financial checkpoints. Shipping and Fulfillment may provide Billing the authoritative shipping facts but **must not directly mutate Billing-owned financial state.**

**External carrier transport and API communication belongs to Integrations.**

*Implementation location today:* shipment containers, carrier shipment, shipping pricing policy, shipping economics, and allocation live under `v2/src/modules/fulfillment/` and `v2/infrastructure/fulfillment/`; there is no `shipping` module directory. This is **implementation location**, not ownership: those files hold Shipping-owned facts. The carrier port (`CarrierProviderPort`) is an empty seam and shipments are currently manual (manual carrier, service, and tracking fields), so no carrier adapter exists yet. Fulfillment's write of Billing invoice charges is recorded as boundary debt (BD-1).

### Decision 3: Replacements and rework

**Do not create a standalone parallel Replacement module.** Replacement is coordinated through existing owners; see [Replacement and rework coordination](#replacement-and-rework-coordination) for the full ownership split.

### Decision 4: Inventory coexistence

**Inventory is the V2 owner of inventory availability, movement, and accounting facts.** The V1 counter `materials.stock_quantity` must not become an independent, competing source of business truth. Where the V1 counter remains necessary during coexistence, it must be documented explicitly as a **compatibility projection or bridge** with reconciliation and a defined cutover path. Dual mutable state without reconciliation is **not** an acceptable permanent architecture.

*Implementation location today:* the V2 inventory ledger updates `materials.stock_quantity` in the same transaction as the V2 movement, and the availability check reads the V1 counter; no reconciliation between them was found. This is recorded as boundary debt (BD-6). This document does not implement or prescribe the fix.

## Business modules

### Sales

- **Purpose.** Own canonical commercial documents and their lifecycle.
- **Authoritative facts/data.** Quotes, orders, line items, shared/current sales transaction data, customer/contact references, PO, due date, sales context, selected/resolved product configuration references, quantities, negotiated prices, quote revisions/sent history, conversion, editing, and Sales audit events.
- **Key future operations.** Create/edit/revise/send/accept quote; create/edit/cancel order; convert quote; request Billing draft synchronization.
- **May reference/consume.** Customers identities; Products and Pricing results; Artwork references; Billing invoice reference; Authentication, Audit, Communications.
- **Must not own.** CRM, product/pricing rules, invoices/payments, artwork truth, production/routing/fulfillment/shipping state, or provider delivery.
- **Known future capabilities.** One consistent quote/order workspace; quote alternatives and revisions; historical sent proposal viewing.
- **Important boundaries.** Conversion preserves the original Quote and its checkpoint. Sales invokes Billing through a contract; it never owns invoice persistence. Sales records the **selling-price decision** (calculated, override, discount, or locked) against an immutable reference to a Pricing `PricingResult`; it never rewrites the calculated result. At conversion Sales resolves and freezes the applicable material requirements and production requirements on the Order Line ([Decision 1](#decision-1-recipebom)); a Draft recipe is never referenced.
- **Order lifecycle reconciliation.** Sales owns the Order's commercial state (`open`, `completed`, `cancelled`) and the function that reconciles it. Other owners (for example a replacement obligation) call that function inside their transaction to re-open or close the Order; the calls coordinate the owners' results and **do not transfer ownership of those results to Sales**. See [Replacement and rework coordination](#replacement-and-rework-coordination).
- **Implementation location.** `sales/`, `infrastructure/sales/`. Sales also writes Routing step advances and a Production quantity projection directly (BD-3; the quantity write is a declared projection).
- **Open questions.** Exact quote alternative/revision UX and which current commercial facts remain shared after conversion.

### Products

- **Purpose.** Own the catalog and product identity/lifecycle.
- **Authoritative facts/data.** Product identity, active/inactive lifecycle, type/classification, attributes, PBV2 and Recipe/BOM links, product images through Assets, import/export, duplication, activation/publishing, storefront availability, and Product Type default-route relationship. **Versioned Recipe/BOM authoring** ([Decision 1](#decision-1-recipebom)): the editable Draft recipe and the immutable, version-bound published recipe. The Product Version to Route Template binding (Product-owned selection of a Routing template).
- **Key future operations.** Create/edit/duplicate/import/export/publish products; assign Product Type, pricing structure, recipe, imagery, and availability; author and publish Recipe/BOM with the Product Version.
- **May reference/consume.** Pricing/PBV2 configuration identity; Assets; Routing template reference; Settings; the neutral unit vocabulary in `modules/shared`.
- **Must not own.** Price execution, stock, production, route instances/transitions, shipping, fulfillment, billing, or Artwork. Inventory availability, reservations, movements, and accounting. Actual material consumption.
- **Known future capabilities.** Product types expose simple facts such as printed/static/service, dimensions required, production class, and installation flag.
- **Important boundaries.** Product Type references a default route but embeds no workflow engine. Recipe/BOM is authored here and version-bound; Inventory owns material accounting and consumes frozen requirements. An Order Line never references a mutable Draft recipe.
- **Implementation location.** `products/`, `infrastructure/products/`. Product-scoped pricing sections of the PBV2 tree are also authored through the Products lifecycle service today; that overlaps Pricing and is [Business decision BDR-1](#business-decisions-required), not a settled Products responsibility. Publication currently sets the active tree pointer through the whitelisted V1 canonical publisher (see the V1 bridges in [Cutover](#cutover-and-v1v2-writer-authority)).
- **Open questions.** Recipe/BOM ownership is settled by Decision 1. Remaining: the fate of the second requirement source kind (`pbv2_inventory_consumption`) (BDR-2), and Recipe/BOM effective-date and lifecycle detail.

### Pricing / PBV2

- **Purpose.** Own configurable product structure needed to arrive at a price.
- **Authoritative facts/data.** Questions/options, conditions, defaults, required selections, dimensions/quantity behavior for pricing, base/tier/matrix/formula prices, option effects/overrides, resolved configuration facts, and pricing inputs/results.
- **Key future operations.** Resolve/validate configuration; calculate price; manage pricing structures and formulas; return ResolvedProductConfiguration and PricingResult.
- **May reference/consume.** Product configuration links and simple facts; Nesting calculations; defined Settings inputs.
- **Must not own.** Product lifecycle, stock/reservations, material accounting, routing, production, fulfillment, shipping, or integrations.
- **Known future capabilities.** A clean Pricing contract hides PBV2 internals; the pure V1 evaluator is a candidate only behind it.
- **Important boundaries.** PBV2 may expose resolved variables for Recipe/BOM; it must not create fake options for inventory or move work. `PricingResult` is a *calculated* price only; Sales decisions are absent from it by contract.
- **Implementation location.** `pricing/` holds the `PricingPort` execution contract, `PricingResult`, the parity adapter, the Formula domain (`formulaDomain.ts`, with its own application service and HTTP routes), and a pricing-local nesting estimate seam. The interpretation of the active PBV2 tree into `PricingRules` (`products/pbv2CompatibilityResolution.ts`) and the authoring of product-scoped pricing sections of the tree (`products/productVersionLifecycle.ts`) currently live in `products/`.
- **Open questions.** Disposition of current workflow tags, material usage, shipping configuration, production effects, routing-like behavior, and Product Intake metadata was assigned to the [PBV2 / Pricing Ownership Audit](PBV2_PRICING_OWNERSHIP_AUDIT.md). That audit is complete and its non-pricing dispositions (Recipe/BOM to Products and Inventory, layout to Nesting, workflow to Routing, shipping to Shipping) are consistent with this document. **Who owns PBV2 tree authoring and pricing-rule authoring is not settled by the existing evidence: see Business decision BDR-1.**

#### Pricing / PBV2 / Products ownership by concern (evidence reconciliation)

The table separates seven concerns that the earlier text treats as one. "Documented" means stated in this document or in the PBV2 / Pricing Ownership Audit. "Code" means where the implementation currently does the work. A cell is marked **CONFLICT** where documented intent and code disagree, or where two documented statements disagree. Nothing in this table decides a conflict.

| Concern | Documented owner | Where the code does it | Status |
| --- | --- | --- | --- |
| **A. Product identity and lifecycle** | Products (identity, active/inactive, type, publishing, availability) | `products/`, `infrastructure/products/`. Gate: `product.edit`, `pricing.publish` for publish. | Consistent |
| **B. Product to active PBV2 association** | Products: "PBV2 and Recipe/BOM links"; PBV2 audit: "Products owns association/publish orchestration" | Read by Products (`getActivePricingConfiguration`). The active-tree pointer is set through the whitelisted V1 canonical publisher (`server/services/products/canonicalProductPublishOperations`); no V2 production SQL writes it. | Consistent on ownership; **execution is a V1 bridge** (see Cutover) |
| **C. PBV2 tree structure / authoring** (questions, options, conditions, defaults, required rules) | This document: Pricing / PBV2 ("Questions/options, conditions, defaults, required selections"). PBV2 audit: "PBV2 is a component inside the Pricing / PBV2 module". | Authored through `ProductVersionLifecycleApplicationService` in `products/` (`updateDraftOptions` and related), written into `pbv2_tree_versions.tree_json` by `infrastructure/products/`. Gate: `product.edit`. | **CONFLICT** (documented Pricing/PBV2, coded in Products) |
| **D. Pricing rule and formula authoring** | This document: Pricing ("manage pricing structures and formulas"). PBV2 audit: Pricing owns the Formula Library and "matrix/tier semantics". | *Formula Library* (definitions, revisions, visibility, status): `pricing/formulaDomain.ts`, gate `pricing.configure`. *Product-scoped base/tier/matrix/option-price/formula-selection sections of the tree*: `products/productVersionLifecycle.ts`, gate `product.edit`. | **CONFLICT** for tree-embedded pricing; Formula Library is consistent |
| **E. Pricing evaluation / execution** | Pricing | `PricingPort.calculate` (`pricing/contracts.ts`), `V2PricingParityAdapter` (`pricing/v2PricingAdapter.ts`) | Consistent |
| **F. PricingResult** | Pricing ("Calculated price only. Sales decisions are intentionally absent.") | `pricing/contracts.ts` (`PricingResult`, `assertPricingResultEvidence`) | Consistent |
| **G. Final Sales selling-price decision** | Sales (PBV2 audit §13: "Sales owns Selling Price") | `sales/contracts.ts` (`SellingPriceDecision`: calculated, unit/total override, discount, locked) referencing a `PricingResultId`; authority `order.overridePrice` | Consistent |

Supporting observations, all evidence and none a decision:

- The **resolver** that turns the active tree plus product facts into the `PricingRules` input for Pricing (`products/pbv2CompatibilityResolution.ts`) lives in Products, while `PricingRules` and `PricingResult` are Pricing contract types. Products' contract imports Pricing types and Pricing's contract imports a Products type (`SellableProductConfiguration`).
- Authority is granted per concern rather than per module: Formula authoring, customer-specific pricing, and tax settings use `pricing.configure`; product-scoped draft pricing edits use `product.edit`; publish uses `pricing.publish`. The capability model therefore does not by itself indicate which module owns tree-embedded pricing.
- `v2_product_version_formula_revision_bindings` has two writers that perform different lifecycle events: Products copies the ACTIVE version's binding into a new mutable Draft ("The ACTIVE binding is never retargeted"), and the Formula domain performs the historical freeze. The row's owner is not stated.
- The PBV2 audit's own open decisions (Formula Library version policy after an expression changes; legacy customer-tier/markup behavior; `childItemEffects`) remain open and are not resolved here.

**BUSINESS DECISION REQUIRED (BDR-1).** See [Business decisions required](#business-decisions-required).

### Customers / CRM

- **Purpose.** Own customer relationship truth.
- **Authoritative facts/data.** Company/customer identity, contacts, addresses, status, metadata, relationships/associations, appropriate credit inputs, and preferences.
- **Key future operations.** Create/edit/merge customer/contact; manage address, status, preference, and association.
- **May reference/consume.** Authentication scope, Assets customer logos, Settings, and Sales/Billing references.
- **Must not own.** Quotes/orders, invoices/payments, product/pricing rules, or Portal authority.
- **Known future capabilities.** Customer-specific associations, credit inputs, and portal scoping.
- **Important boundaries.** Sales references CRM truth; Billing reads needed data; a customer merge is a named cross-module operation, never direct foreign-table rewrites.
- **Open questions.** Exact credit-policy split between CRM configuration and Billing decisions.

### Inbound Orders

- **Purpose.** Own intake and review before canonical Sales creation.
- **Authoritative facts/data.** Original email/manual/document source, parsing, extracted fields, match proposals, dimensions, quantity, PO/due/shipping proposals, missing info, confidence, review/correction state, and submission identity/idempotency.
- **Key future operations.** Ingest/parse; propose matches; review/correct; submit canonical quote or order; preserve source evidence.
- **May reference/consume.** Customers/Products matching queries, Artwork intake, AI proposals, Authentication, and Sales operations.
- **Must not own.** Canonical quote/order data, price/tax rules, or an alternate order copy after submission.
- **Known future capabilities.** Multi-channel intake and assisted extraction.
- **Important boundaries.** Terminal submission calls Sales.createOrder or Sales.createQuote; Inbound retains source/history and resulting reference only.
- **Current V2 state.** Implemented as `modules/inbound/` (intake states, source providers `gmail | manual | imported`, review draft, ingest/review/conversion commands, `inboundIntakeApplication.ts`) with `infrastructure/inbound/`. Its SQL writes are confined to its own `v2_inbound_*` tables, and its conversion calls Sales' order application. This matches the ownership statement above.
- **Open questions.** Final confidence thresholds and which fields require human review.

### Artwork

- **Purpose.** Own first-class customer and production artwork lifecycle.
- **Authoritative facts/data.** Source/customer artwork, production artwork, versions, replacements, source-derived lineage, grouping/layers, proof-source links, production designation, readiness, production derivatives, automation output, and retirement.
- **Key future operations.** Upload/replace/retire/compose; derive/designate production file; attach proof source; report readiness.
- **May reference/consume.** Storage through contracts; Sales references; Prepress results; Production/Nesting derivative requests; Authentication, Audit, Integrations.
- **Must not own.** Route state, production execution/quantities, fulfillment, shipment, billing, or reusable branding media.
- **Known future capabilities.** Multi-layer prints, customer-to-cleaned-production lineage, proof sources, Illustrator automation outputs, and nesting derivatives.
- **Important boundaries.** Prepress and Production consume Artwork, never create alternate truth. Artwork is distinct from Assets even when both use storage. **Artwork owns replacement and derived artwork lineage** ([Decision 3](#decision-3-replacements-and-rework)): a replacement is a new version or derivative with recorded lineage, never an edit of the original.
- **Open questions.** Final artifact retention/rendition policy and persistent ownership of future nesting outputs.

### Prepress

- **Purpose.** Own simple preparation/validation work that makes Artwork ready for Production.
- **Authoritative facts/data.** Prepress validation/preparation state and result, selected production file reference, and bounded destination-preparation facts.
- **Key future operations.** Review/preflight; validate; select existing or uploaded production file; report preparation result/readiness.
- **May reference/consume.** Artwork contract, Product simple facts, Production destination data, Authentication, and Routing transition request.
- **Must not own.** Artwork identity/versions, route decisions, production job state, fulfillment, or provider handoff.
- **Known future capabilities.** Low-friction preparation, destination selection, and later automation.
- **Important boundaries.** Prepress reports a result; Routing decides the next internal step.
- **Implementation location.** `prepress/`, `infrastructure/prepress/`. The Prepress adapter currently also advances Routing's route instance and inserts Production work for a rework successor (BD-2, BD-3).
- **Open questions.** How much independent state remains after simplification and automation.

### Production

- **Purpose.** Own execution of manufacturing work.
- **Authoritative facts/data.** Production jobs/work, execution state, quantities, starts/completions, machine/station facts, operational state, and history.
- **Key future operations.** Create/claim/start/complete/reopen governed work; record output/waste/actual usage; report outcome/readiness.
- **May reference/consume.** Sales line references, Artwork production files, Routing route instance, Nesting result, Inventory operation, Authentication, Audit.
- **Must not own.** Artwork truth, route state, inventory stock, fulfillment, shipping, billing, or external production-system decisions.
- **Known future capabilities.** Machine/station execution and work-type expansion through shared modules.
- **Important boundaries.** Production reports facts and requests Inventory consumption; Routing—not Production—moves work to Fulfillment. **Production owns replacement and rework Production work and attempts** ([Decision 3](#decision-3-replacements-and-rework)); original Production history is immutable and is never edited to express a replacement. Production's `ordered_quantity` on a work item is a projection of the current commercial line quantity, not an independent commercial fact.
- **Implementation location.** `production/`, `infrastructure/production/`. Production work rows for rework and replacement are inserted by Prepress and Fulfillment adapters rather than through Production's own creation operation (BD-2).
- **Open questions.** Detailed scheduling/resource model, if and when independently justified. A single Production operation for creating successor (rework or replacement) work is not yet defined.

### Routing

- **Purpose.** Own internal PrintersHero workflow movement.
- **Authoritative facts/data.** Route templates, job route instances, current/next/optional/skipped steps, transitions, authorized manual rerouting, and internal destination.
- **Key future operations.** Define template; instantiate route; transition/skip/reroute; determine authorized next step.
- **May reference/consume.** Product Type default route and facts/results from Artwork, Prepress, Production, and Fulfillment.
- **Must not own.** Product/catalog truth, production quantities, artwork, inventory, shipping/provider transport, or integrations.
- **Known future capabilities.** Simple defaults: printed Proofing -> Prepress -> Production -> Fulfillment; static/resale -> Fulfillment; service/fee no route unless defined; add steps only on evidence.
- **Important boundaries.** Product Type changes do not mutate active jobs; a job retains its instantiated route unless explicitly rerouted. Only Routing advances a route instance's current step.
- **Implementation location.** `routing/`, `infrastructure/routing/`. Routing's own lifecycle writer is `routing/postgresRoutingLifecycleTransaction.ts`. Other adapters currently also advance route instances (BD-3).
- **Open questions.** Route-template persistence/versioning and future proofing/finishing semantics.

### Nesting

- **Purpose.** Own reusable fit and optimization calculations.
- **Authoritative facts/data.** Calculation definitions/results for sheet/roll fit, rotation, margins, gaps, bleed, waste, usable dimensions, mixed sizes, sheet usage, sticker nesting, and future instructions.
- **Key future operations.** Estimate price-related material use; calculate actual production nest; return deterministic calculation result.
- **May reference/consume.** Pricing dimensions, Inventory material characteristics, and Artwork/Production geometry inputs.
- **Must not own.** PBV2 structure/price, execution, stock/consumption, sales documents, or routing.
- **Known future capabilities.** Shared sheet/roll/sticker optimization and output instructions.
- **Important boundaries.** Pricing and Production both call Nesting; it is neither a PBV2 subfeature nor a Production subfeature.
- **Open questions.** Whether persisted nest output becomes an authoritative Production artifact.

### Inventory / Materials

- **Purpose.** Own material and stock truth.
- **Authoritative facts/data.** Material definitions, units/conversions, stock, movements, reservations, consumption effects, adjustments, availability, inventory accounting, and material-usage truth. The reconciliation of Production's actual-consumption facts to inventory movements.
- **Key future operations.** Define/reserve/release/receive/consume/adjust material; calculate availability; record correlated movements.
- **May reference/consume.** Frozen material requirements on Order Lines (derived from the Product Version recipe per [Decision 1](#decision-1-recipebom)), Pricing facts, Production actual use, Procurement receiving request, Nesting requirements, the neutral unit vocabulary.
- **Must not own.** PBV2 options/rules, customer-facing product options, Recipe/BOM authoring, vendor purchasing lifecycle, production execution, routing, fulfillment, or shipping. Inventory must not recompute historical Recipes.
- **Known future capabilities.** Material conversions and requirement-to-availability planning.
- **Important boundaries.** Recipe/BOM may calculate GROMMET-BRASS times a resolved selected count; only Inventory changes stock. Production's consumption record is an immutable fact; the inventory movement it causes is a separate, retryable effect reconciled by the consumption identity (`v2_inventory_reconciliation_attempts`). That pair is an intentional immutable-fact plus mutable-effect design, not duplicate authority.
- **V1 coexistence ([Decision 4](#decision-4-inventory-coexistence)).** V2 Inventory owns availability, movement, and accounting. The V1 counter `materials.stock_quantity` is, at most, a compatibility projection or bridge that requires reconciliation and a defined cutover path. Independent dual mutable state is not acceptable as a permanent architecture; the current state is Known boundary debt BD-6.
- **Implementation location.** `inventory/inventoryLedger.ts`, `infrastructure/inventory/`, and `materials/materialRequirementResolver.ts`.
- **Open questions.** Reservation policy. (Recipe/BOM ownership is settled by Decision 1.) The cutover path and reconciliation mechanism for the V1 counter are unspecified.

### Procurement

- **Purpose.** Own purchasing and replenishment.
- **Authoritative facts/data.** Vendors, purchase orders, receiving workflow, vendor costs, purchase units/cases/packs, minimums, and replenishment.
- **Key future operations.** Manage vendor; create/approve/send PO; receive; reconcile cost; propose replenishment.
- **May reference/consume.** Inventory queries, Product/Settings references, Authentication, Audit, Integrations.
- **Must not own.** Stock/movements, material definitions, Sales orders, product price, invoices/payments, or provider transport.
- **Known future capabilities.** Replenishment policy and vendor cost history.
- **Important boundaries.** Receiving invokes Inventory.receive; Procurement never writes inventory truth directly.
- **Open questions.** Supplier commitment and landed-cost model.

### Fulfillment

- **Purpose.** Own internal handoff of available completed goods.
- **Authoritative facts/data.** Pickup, partial/multi-visit pickup, availability for handoff, packing/handoff facts, and fulfillment completion. The **replacement obligation** (its authorization and the resulting replacement fulfillment obligation), see [Replacement and rework coordination](#replacement-and-rework-coordination).
- **Key future operations.** Determine availability; pack; record pickup/handoff; request shipment; report terminal fact; authorize a replacement obligation and track its fulfillment.
- **May reference/consume.** Sales order context, Production outcomes, Inventory availability, Routing destination, Shipping operation, Billing reconciliation need, Authentication, Audit.
- **Must not own.** Production quantities and Production work/attempts (including replacement Production work), stock truth, shipment/package/carrier state and shipping economics, invoice math/payments or Billing state, or route state. Original fulfillment history is immutable and is never edited to express a replacement.
- **Known future capabilities.** Partial, multi-visit, and stock-origin fulfillment; replacement pickup and replacement shipment handoff.
- **Important boundaries.** Fulfillment may request Shipping and consume production/inventory facts without making them artificial authorization ceilings. Fulfillment provides Shipping and Billing the authoritative fulfillment facts; it does not compute their state.
- **Implementation location.** `fulfillment/fulfillmentApplication.ts`, `fulfillmentCompletion.ts`, `replacementObligations.ts`, `contracts.ts`; `infrastructure/fulfillment/postgresFulfillmentTransaction.ts`, `postgresReplacementObligations.ts`. The same directory also hosts Shipping-owned code (see Shipping).
- **Open questions.** Availability policy across produced, stocked, and substitute-source goods.

### Shipping

- **Purpose.** Own shipment lifecycle and shipping economics ([Decision 2](#decision-2-shipping)).
- **Authoritative facts/data.** Shipments, containers, and packages; carrier/service selection; **estimated carrier cost** and **actual carrier cost**; the **customer shipping price**; the **shipping pricing policy** with its snapshot and override evidence (modes: pass-through, flat, percent, no charge, manual; organization default and customer override); rates/results; labels; tracking; shipment state; carrier handoff facts; **combined-shipment allocation facts** (how one shipment's price is allocated across Orders); and **absorbed-freight economics** (the amount the business absorbs when actual cost exceeds the customer price). Replacement shipping state, economics, and allocation.
- **Key future operations.** Rate/select service/create package and shipment/purchase or void label/record handoff/reconcile carrier status; resolve the applicable pricing policy; record actual cost; allocate a combined shipment; provide Billing the authoritative shipping charge facts.
- **May reference/consume.** Fulfillment request, Sales destination, Customers address, Billing shipping-charge use, Integrations adapters, Authentication, Audit.
- **Must not own.** Fulfillment availability, pickup, or completion; order lifecycle; **Invoice financial state, shipping additional charges on an Invoice, tax on an Invoice, Invoice revisions, or financial checkpoints (all Billing)**; stock; or carrier credentials/transport (Integrations).
- **Known future capabilities.** Multi-package and provider-rate workflows.
- **Important boundaries.** Carrier communication is Integrations; Shipping exposes authoritative shipment results to consumers. Shipping provides Billing the authoritative shipping facts and requests the charge through a Billing operation; it never writes Billing tables. The shipment pricing policy in force is snapshotted with the shipment so a later policy change never reprices it.
- **Implementation location.** Shipping-owned code currently lives inside the Fulfillment directories: `fulfillment/shipmentContainer.ts`, `shipmentContainerApplication.ts`, `carrierShipment.ts`, `shippingEconomicsApplication.ts`, `shipmentEconomicsRead.ts`, `replacementShippingEconomics.ts` (pricing modes, customer price, allocation, absorbed freight); `infrastructure/fulfillment/postgresShipmentContainerTransaction.ts`, `postgresShippingEconomics.ts`, `postgresShipmentShippingAllocation.ts`, `postgresShipmentEconomicsRead.ts`. There is no `shipping` directory. That is implementation location, not ownership. `CarrierProviderPort` is currently an empty seam and shipments are manual (carrier name, service, and tracking are entered by staff); no carrier adapter exists.
- **Known boundary debt.** `postgresShipmentShippingAllocation.ts` writes Billing-owned invoice charge, revision, and total state directly (BD-1).
- **Open questions.** Shipping-charge timing and multi-origin shipment policy. Whether Shipping is extracted into its own module directory is an implementation-structure question, not an ownership question.

### Billing

- **Purpose.** Own financial documents and lifecycle.
- **Authoritative facts/data.** Invoices, lines/math/lifecycle, payments, refunds, credits/corrections, financial adjustments, payment-term application, and issued history. Also, per [Decision 2](#decision-2-shipping) and [Decision 3](#decision-3-replacements-and-rework): **shipping additional charges on an Invoice; tax calculation and application on the Invoice; Invoice revisions; financial checkpoints; and billable replacement Invoices with their financial lifecycle** (including the replacement Invoice number suffix rule and the proportional pricing of the replaced quantity).
- **Key future operations.** Create/synchronize draft; edit draft; issue/finalize; permitted issued edit/correction; record payment/refund; reconcile provider receipt; render document data; accept an authoritative shipping charge from Shipping and apply it to an Invoice (recomputing tax and revising the Invoice); create or read a billable replacement Invoice for a replacement obligation.
- **May reference/consume.** Sales through draft-sync contract, Customers, Fulfillment/Shipping facts, Settings terms/tax inputs, Integrations providers, Authentication, Audit.
- **Must not own.** CRM, order lifecycle, fulfillment/shipping state and shipping economics, provider transport, Artwork, or Production.
- **Known future capabilities.** Order-created draft invoice, permission-driven issued-invoice correction, and payment workspace linked from Order; additional Invoices for billable replacements.
- **Important boundaries.** Order creation may atomically coordinate draft invoice creation. Sales requests synchronization while commercially editable; Billing owns issue/history/payment truth. **Other modules provide Billing facts and call Billing operations; they do not mutate Billing tables.** A no-charge replacement leaves the original Invoice and its payments untouched. A billable replacement uses the approved additional-Invoice behavior. Invoice lines copy the Sales selling amount with a pricing evidence fingerprint, an immutable snapshot rather than a second mutable price.
- **Implementation location.** `billing/`, `infrastructure/billing/`. The billable replacement Invoice is created by Billing's own operation (`postgresReplacementInvoice.ts`), which is the intended pattern. The shipping-charge write path currently sits in Fulfillment's directory (BD-1).
- **Open questions.** Exact issue/finalization event and post-issued correction semantics.

### Communications

- **Purpose.** Own communication intent and history.
- **Authoritative facts/data.** What/why/to whom/template/context/status and business-visible history for quote, invoice, proof, shipping, reminder, and future SMS notices.
- **Key future operations.** Compose/queue/send/retry/cancel; manage templates; record delivery history.
- **May reference/consume.** Sales, Billing, Artwork/Prepress, Shipping, Customers, Settings, Authentication, Audit, Integrations.
- **Must not own.** Quote/invoice/proof/shipment lifecycle, CRM recipient truth, provider credentials, or delivery mechanics.
- **Known future capabilities.** Template and multi-channel delivery.
- **Important boundaries.** Communications determines intent/context; Integrations transports and returns a receipt. A quote delivery also creates a Sales checkpoint.
- **Implementation location.** `infrastructure/communications/` (there is no `src/modules/communications` directory). It holds the durable invoice-email and proof-email delivery queues (`v2_invoice_email_delivery_*`, `v2_proof_delivery_jobs`) and the organization email integration connection (`v2_email_integrations`, OAuth state). The Gmail API send call is made from the same directory (`invoiceEmailSender.ts`), so provider transport currently sits beside communication intent; the ownership statement above still assigns transport to Integrations. The proof delivery queue table is written by both Proofing (enqueue, retry) and the Communications worker (claim, complete); queue producer/consumer sharing is common, and this document records it without treating it as duplicate authority.
- **Open questions.** Consent, template governance, and channel preference rules.

### Reporting

- **Purpose.** Own read-heavy non-authoritative reporting.
- **Authoritative facts/data.** Reports, dashboards, KPIs, exports, analytics, and deliberately justified read models.
- **Key future operations.** Build/query/export report; refresh projection; present sales, production, inventory, cost, and aging analytics.
- **May reference/consume.** Scoped facts/events/projections from all owners, Search, Settings, UI System.
- **Must not own.** Operational facts, lifecycle rules, or another business-rule engine.
- **Known future capabilities.** Sales, job-cost, production, inventory, and aging reporting.
- **Important boundaries.** Read models need provenance/freshness design and never write back operational truth.
- **Open questions.** Which materialized views are justified and their refresh semantics.

### Portal / Storefront

- **Purpose.** Own customer-facing application behavior.
- **Authoritative facts/data.** Customer-facing storefront/workspace behavior and presentation context, not alternate domain truth.
- **Key future operations.** Present customer-scoped catalog/workspaces; submit canonical requests; approve quote/proof; upload artwork; initiate payment.
- **May reference/consume.** Customer-scoped Principals; Sales, Products/Pricing, Artwork, Billing, Shipping, Customers, UI System, Settings, Communications DTOs/operations.
- **Must not own.** Alternate Sales/Billing/Artwork/Pricing rules, internal data, identity authority, or route state.
- **Known future capabilities.** Branded storefronts, customer catalogs, ordering, proofs, artwork, status, invoices, and payments.
- **Important boundaries.** Portal calls canonical operations as a scoped Principal; UI System renders branding while Portal owns behavior.
- **Current V2 state.** The Portal module is thin by design. `modules/portal/` holds customer-safe read projections (`commercialReads.ts`: per-order only, so a combined shipment never reveals another customer's work), a customer artwork command (`portalArtwork.ts`), and portal order creation (`portalOrderCreation.ts`, resolving the session to a CRM contact and calling Sales). `infrastructure/portal/` contains read adapters and ownership checks and performs **no SQL writes**. Portal access, invitation, credential, and password-reset state is written elsewhere (Authentication, Team Access, Communications, and Proofing adapters); see Business decision BDR-3.
- **Open questions.** Customer pricing/availability policy and storefront tenancy/brand model.

### Bug Reporting

- **Purpose.** Own user-submitted application defect reporting.
- **Authoritative facts/data.** Reports, page/build/user/org context, supported screenshots, severity/category, comments/status, affected-resource link, and sanitized diagnostic context.
- **Key future operations.** Submit/triage/comment/classify/link/redact/attach safe evidence/hand off externally.
- **May reference/consume.** Authentication, Settings build context, Assets safe screenshots, Audit correlation, Integrations.
- **Must not own.** Core business lifecycle/data, unrestricted tenant data, secrets, or external ticket-system truth.
- **Known future capabilities.** User reports with diagnostic correlation and external support handoff.
- **Important boundaries.** GitHub/support transport is Integrations; capture and exposure are scope/redaction governed.
- **Open questions.** Retention/redaction requirements and external issue synchronization policy.

## Platform and cross-cutting modules

### Authentication / Permissions

- **Purpose.** Own authentication identity, configurable named permission sets, assignments, scope, capability decisions, and authority policy.
- **Authoritative facts/data.** Principals/identity bindings, permission-set definitions/assignments, scopes, and authority decisions.
- **Key future operations.** Issue/verify Principal; manage permission sets/grants; evaluate identity + scope + assigned sets + hard platform ceilings; revoke/session management.
- **May reference/consume.** Customers portal scope, Settings, Audit, and every module's operation/resource-scope declaration.
- **Must not own.** Domain business rules or mutable domain data.
- **Known future capabilities.** Unlimited organization-defined named sets such as Sales, Production, Accounting, and portal variants.
- **Important boundaries.** Preserve M0 PrincipalIssuer and pure AuthorityPolicy. Delegated AI cannot exceed verified Staff; Portal/Service remain explicitly scoped; HTTP never supplies Staff claims.
- **Implementation location.** `src/authorization/` (pure policy, persistence-free and boundary-enforced), `infrastructure/authorization/` (permission persistence and bootstrap), `infrastructure/authentication/` (session, CSRF, credentials). Permission-set administration is also written by Team Access under `infrastructure/organization/postgresTeamAccess.ts`, and Proofing bumps the authority revision and assigns a portal permission set (BD-4). Whether Team Access is a Settings surface over Authentication operations or a second writer is part of Business decision BDR-3.
- **Open questions.** Reviewed capability vocabulary, scope model, and very small hard safety ceiling set.

### AI

- **Purpose.** Own PrintersHero AI orchestration.
- **Authoritative facts/data.** Conversations/workspace context, Plan/GO, tool registry, missing-information state, proposals, model abstraction, usage/audit, delegation, and revalidation.
- **Key future operations.** Plan/propose/revalidate/invoke named operation/record usage/request model work.
- **May reference/consume.** Verified scoped Principal, authorized DTOs, canonical module operations, Audit, Settings, Integrations.
- **Must not own.** Domain lifecycle/rules, privileged mutation paths, or fabricated Staff attribution.
- **Known future capabilities.** Staff-delegated Plan/GO and controlled proposal generation.
- **Important boundaries.** AI calls Sales.createOrder, Billing.recordPayment, or Artwork.replaceArtwork like any interface; it cannot bypass authority or owners.
- **Current V2 state.** Implemented as `modules/ai/` (conversations, tool registry with read and command kinds, pending commands with confirmation states, a hard-denied tool list, provider abstraction) and `infrastructure/ai/`. Its SQL writes are confined to `v2_ai_*` tables; domain mutations are expressed as commands (`infrastructure/ai/*AiCommand(s).ts`) that are intended to invoke owner operations. That per-command routing to owner operations was not traced line by line in the audit and is recorded as unverified.
- **Open questions.** Durable plan retention and external model/provider split with Integrations.

### Settings

- **Purpose.** Own configuration and preferences.
- **Authoritative facts/data.** Organization/user settings for numbering, tax, terms, production/routing defaults, notifications, theme, integration, feature, and portal/storefront configuration.
- **Key future operations.** Read/update scoped setting; resolve defaults; validate configuration ownership.
- **May reference/consume.** Authentication scope, UI System interpretation, Integrations config, and defined consumers.
- **Must not own.** Business transaction state or any business lifecycle.
- **Known future capabilities.** Layered user, organization, and storefront configuration.
- **Important boundaries.** Settings stores configuration; business owners apply rules and UI System interprets presentation. It is not an untyped catch-all.
- **Current V2 state.** The implemented Settings surface is `modules/organization/` (business profile, document-numbering settings, team-access presentation) and `infrastructure/organization/`. Its business-profile and numbering writes go to organization and company-settings rows (V1 tables that hold this configuration). The organization/team-access adapter also writes identity, invitation, and permission-set rows that belong to Authentication and Portal (see BDR-3); Settings owns the configuration, not those facts.
- **Open questions.** Configuration schema/versioning and tenant override precedence.

### Assets

- **Purpose.** Own reusable/shared media.
- **Authoritative facts/data.** Organization/customer logos where appropriate, product images, branding/theme graphics, reusable application media, and possibly avatars.
- **Key future operations.** Upload/manage/replace/retire reusable asset; assign reference; deliver safe rendition.
- **May reference/consume.** Products, Customers, UI System, Settings, Authentication, Integrations storage.
- **Must not own.** Customer/production artwork, artwork lineage/proofs/derivatives, or arbitrary generated files.
- **Known future capabilities.** Reusable branding and application media catalog.
- **Important boundaries.** Artwork remains a distinct owner even if Assets and Artwork share storage infrastructure.
- **Current V2 state.** Tenant branding and the organization logo are handled in `infrastructure/documents/postgresTenantBranding.ts` and `infrastructure/organization/organizationLogoAdoption.ts`, the latter through a whitelisted V1 storage bridge. PDF rendering of owner documents (`infrastructure/documents/ownerPdfRenderer.ts` and the per-domain `postgres*Documents.ts` readers) renders on demand from authoritative data, consistent with the rendering principle above; rendering does not own the underlying facts.
- **Open questions.** Customer-logo ownership and retention policy.

### Audit / History

- **Purpose.** Own cross-cutting meaningful operation history.
- **Authoritative facts/data.** Successful operation event with principal, verified Staff actor/delegator, organization, operation, resource, changed groups, timestamp, and correlation.
- **Key future operations.** Record/query authorized meaningful audit event and correlate request/attribution/result.
- **May reference/consume.** Every operation result/event, Authentication attribution, M0 operation request and durable-work context.
- **Must not own.** Domain snapshots, business decisions, UI interaction logs, or database-trigger copies of every column.
- **Known future capabilities.** Cross-module resource history and attribution.
- **Important boundaries.** Business modules own their immutable checkpoints; Audit records the cross-cutting account and cannot substitute for checkpoint data.
- **Current V2 state.** There is no Audit module directory. The shared `v2_audit_events` table is written inline, inside the operation's own transaction, by the infrastructure adapters of fifteen domains, and permission changes use a separate `v2_permission_audit_events` table. Writing an audit event in the same transaction as the operation it records is the intended atomicity; whether it must instead go through an Audit-owned port is not stated and is left open.
- **Open questions.** Retention, redaction, and actor-visible history policy. Whether domains may write the shared audit table directly or must call an Audit port.

### UI System

- **Purpose.** Own reusable presentation system.
- **Authoritative facts/data.** Design tokens, semantic colors/typography/spacing/density/radius, component variants, shell/navigation, shared forms/tables/cards/dialogs/status, responsive behavior, document workspaces, and theme rendering.
- **Key future operations.** Render semantic component/theme; provide workspace primitives; resolve presentation layers.
- **May reference/consume.** Settings, Assets, Portal branding, Authentication preferences, and business DTOs.
- **Must not own.** Business rules/data, configuration persistence, storefront behavior, or domain mutations.
- **Known future capabilities.** System Default + Organization Theme + User Preferences + Customer/Storefront Branding, including controlled density/layout/type/color options.
- **Important boundaries.** Settings stores preferences; UI System interprets them. Business UI uses semantic tokens, never hard-coded visual identity.
- **Open questions.** Initial token taxonomy and allowable storefront customization range.

### Search

- **Purpose.** Own search indexing/query behavior.
- **Authoritative facts/data.** Non-authoritative indexed/read projections and search metadata.
- **Key future operations.** Index/remove projection; query/rank/filter; return authorized result DTOs.
- **May reference/consume.** Authorized owner projections/events, Authentication scope, Settings, UI System.
- **Must not own.** Source records, mutations/lifecycle rules, or grants.
- **Known future capabilities.** Global search across customers, sales, products, artwork, shipments, and production.
- **Important boundaries.** Results retain source owner/scope; Search cannot repair a source record by mutation.
- **Open questions.** Index freshness/rebuild and authorization filtering strategy.

### Integrations

- **Purpose.** Own PrintersHero-to-outside-PrintersHero capability.
- **Authoritative facts/data.** Adapter connection/configuration references, transport request/receipt, webhook/provider correlation, retry/reconciliation state, and external-system mapping.
- **Key future operations.** Send/retry/reconcile; receive/verify webhook; manage connection; hand off to QuickBooks, Stripe, carriers, email, storage, Local Bridge, Onyx, Illustrator, MCP, APIs, webhooks, and partners.
- **May reference/consume.** Named business operation/results, Settings, scoped service authority, M0 durable work, Audit.
- **Must not own.** Core business validity/decisions, internal Routing, invoice/refund authority, or domain-table writes.
- **Known future capabilities.** Durable provider adapters and external workflow handoffs.
- **Important boundaries.** Routing decides internal movement/intent; Integrations crosses the external boundary. It invokes owner operations for provider outcomes rather than writing business data. **External carrier transport and carrier API communication belong here** ([Decision 2](#decision-2-shipping)); Shipping owns the shipment facts those calls produce.
- **Current V2 state.** Accounting (QuickBooks) is implemented under `infrastructure/accounting/`: a lease-based durable sync queue, invoice approval, payment-reference and refund-sync workflows, and connection readiness. Its SQL writes are confined to `v2_quickbooks_*` tables (plus audit events and one organization preference), and it reads Billing, Sales, and Customers state; it does not write invoices, payments, orders, or customers in V2. Provider transport for QuickBooks calls the retained V1 client through two explicit, single-file whitelisted bridges (`quickBooksBillingQueue.ts`, `quickBooksIntegrationReadiness.ts`). The Stripe connection, payment initiation, and webhook ingress are under `infrastructure/billing/`; the Gmail connection and delivery are under `infrastructure/communications/`. No carrier adapter exists. One QuickBooks path writes Billing-owned state through the V1 importer: BD-5.
- **Open questions.** Provider receipt/reconciliation retention and exact AI-vs-Integrations model adapter ownership. Whether provider adapters currently under Billing and Communications directories are to be consolidated under Integrations is an implementation-structure question.

## Replacement and rework coordination

Replacement ([Decision 3](#decision-3-replacements-and-rework)) is a **workflow coordinated across existing owners**. It is not a module and has no table of its own that any other owner must defer to. **The same Order remains authoritative.** Original Production and Fulfillment history remains immutable.

| Fact | Owner |
| --- | --- |
| The replacement obligation: its authorization, reason, quantity, responsibility, billing treatment, status, and events; and the resulting **replacement fulfillment obligation** (what still has to be handed off) | **Fulfillment** |
| Replacement Production work and its attempts (and rework successor work) | **Production** |
| Replacement and derived artwork lineage | **Artwork** |
| A **billable replacement Invoice** and its whole financial lifecycle, including the suffix numbering and pricing of the replaced quantity | **Billing** |
| Replacement shipping state, shipping economics, and shipping allocation | **Shipping** |
| The Order's commercial state (`open`, `completed`, `cancelled`) and its reconciliation | **Sales**; it coordinates the results of the other owners and **does not take ownership of their facts** |

Rules:

- A **no-charge** replacement leaves the original Invoice and its payments untouched.
- A **billable** replacement uses the approved additional-Invoice behavior: Billing creates a separate Invoice for the replaced quantity; the original Invoice is not edited.
- The obligation and its source refer to original fulfillment handoffs and shipments by identity. They do not rewrite them.
- Order lifecycle reconciliation re-opens or closes the Order in response to owner results (for example, an open replacement obligation keeps the Order open). It is a coordinating call into the Sales-owned reconciliation function inside the caller's transaction.
- A replacement is distinct from a refund, a shipment correction, and rejected output; none of those is modelled as a replacement.

*Implementation location today:* the obligation lives in `fulfillment/replacementObligations.ts` and `infrastructure/fulfillment/postgresReplacementObligations.ts`. In one transaction that adapter locks the Order's invoices and handoffs (lock only), inserts the obligation and its events, calls Sales' reconciliation function and Billing's create-or-read replacement-Invoice operation (both are coordination through the owner and are the intended pattern), and **inserts Production work rows itself**. That last write is recorded as boundary debt (BD-2). Billing's replacement Invoice is created by Billing's own operation.

## Cutover and V1/V2 writer authority

**Cutover is not a business module.** It owns no business fact. It is a body of *evidence gates and procedures* that decide when V2 may become the writer for a domain, and the code that asserts those gates.

- **Governing rule.** V1 and V2 must never be simultaneous authorities for payments, Stripe, QuickBooks, delivery/email, orders, prepress, production, fulfillment, inventory, or lifecycle. This restates the M1+ rule below ("retain V1 as sole writer until a domain gate passes... avoid dual writes") and is documented with its evidence in `v2/audits/M7_1_WRITER_AUTHORITY_MAP.md`.
- **Gates.** `v2/src/modules/cutover/` holds pure, fail-closed functions that evaluate an operator-collected evidence manifest (write-free runtime gate, cutover evidence gate, writer assertion, production executor contract). They discover and stop nothing; a missing or unknown authority fails closed. The `v2/scripts/assert*` and `prepare*` scripts and the `v2/audits/M7_*` documents are the procedure and evidence.
- **Runtime release.** V2 background workers (QuickBooks, invoice email, proof email) start only when `V2_MUTATION_WORKERS_ENABLED=true`; absence or a malformed value keeps them off.
- **Enforcement level.** The gates prove the gate logic and the recorded evidence, not that a running V1 process is actually stopped. This is a property of the procedure, not an ownership gap.
- **V1 bridges.** V2 production code imports V1 in exactly four places, each a whitelisted single-file bridge: canonical product publication (which sets the active PBV2 pointer), organization logo storage, and two QuickBooks provider bridges. A bridge is a documented coexistence seam, not an ownership exception; a bridged V1 function that writes state owned by another module is still boundary debt (BD-5).
- **Physical home vs owner.** Many V2 modules currently store their own facts in legacy V1-origin tables (Customers, Products, Settings, Authentication, Inventory). A V2 module writing *its own* state to a legacy table is a coexistence fact, not a violation. Which facts each V1 table holds and who owns each is the scope of the writer-authority map.

## Cross-module transaction policy

One PostgreSQL core permits atomic cross-module operations where integrity requires them. A coordinating application operation can, for example, create Sales Order and lines, request Billing Draft Invoice and lines, record Audit, enqueue durable work, and commit together.

Atomic coordination does not change persistence ownership: the coordinator calls each module's named operation/port; it does not write foreign tables, reuse foreign repositories, or duplicate foreign rules. Operation requests use organization + operation + business request identity (never actor-scoped) for durable idempotency. External effects occur after commit from durable outbox/reconciliation work with deterministic correlation; no fire-and-forget provider calls.

## Good and forbidden interactions

**Good**

- Inbound preserves source/review, then calls Sales.createOrder with its submission identity and keeps only the returned reference.
- Sales converts a Quote without repricing or deleting it; through contracts it creates Order, Draft Invoice, Audit, and durable work atomically.
- Pricing asks Nesting for sheet requirement; Recipe/BOM derives material requirement; Inventory owns reserve/consume effects.
- Production reports output and asks Inventory to consume; Routing evaluates the result and authorizes the next step.
- Communications determines an issued-invoice notice; Integrations delivers it and returns a receipt.

**Forbidden**

- PBV2 directly reserves stock, creates shipment, or changes route because V1 metadata currently blends those concerns.
- A Sales route updates invoice/payment persistence or maintains a second mutable invoice copy.
- Production independently marks Fulfillment or route progress complete.
- Portal implements second Pricing, Proof, Billing, or authority rules.
- A Stripe/carrier/Onyx adapter directly writes business records or decides a refund/shipment validity.
- Reporting/Search mutates operational truth; Audit becomes blanket record versioning.

## V1 anti-corruption and reuse

V1 is behavior evidence, not V2 ownership. Every reuse is classified **reuse as-is**, **reuse behind V2 contract**, **reconstruct**, or **remove**. Potential contract-bound reuse includes the pure PBV2 evaluator, calculation utilities, stable value types, selected validators/UI components/integration infrastructure, and V1/POC characterization contracts. It does not authorize reuse of route-local logic, broad repositories, giant orchestration services, scattered authorization checks, mixed routing/production logic, duplicated Sales/Billing state, V1 mutation routes, or the v2-poc runtime.

M0 already prohibits production v2 imports from V1 routes/services/index/workers and v2-poc; it prohibits interfaces importing repositories/raw DB and keeps policy pure. M1+ must extend boundary tests without weakening M0 to accommodate V1 coupling. Compatibility repositories contain legacy schema representations only.

## Repository reality check

Read-only inspection identifies focused reconstruction inputs, not work to fix now.

- **PBV2 mixes non-pricing concerns.** shared/pbv2/validator/validatePublish.ts validates tree.meta.shippingConfig; shared/pbv2/rollMediaLayout.ts performs production/nesting-oriented layout; and server/lib/duplicateProductTransform.ts duplicates workflow intent, primary-material, nesting, and production-job flags.
- **Artwork truth is distributed.** server/services/artwork/LineItemArtworkReadResolver.ts resolves across legacy attachments, assets, and workflow files; server/routes/orderLineItemFiles.routes.ts directly updates assets, attachments, and line-item files; server/routes/prepressFiles.routes.ts retires line-item files.
- **Routing is outside a Routing owner.** server/services/productionRoutingService.ts, server/services/productionRoutingResolver.ts, server/routes/prepress.routes.ts, and server/routes/orders.routes.ts each embody internal workflow decisions.
- **Orders are a cross-domain mutation hub.** server/routes/orders.routes.ts imports fulfillment, Billing, workflow/routing, proofing, Artwork, PBV2 material effects, reservations, storage, and material adjustment concerns.
- **Sales/Billing and common state are coupled/duplicated.** server/services/orders/canonicalOrderOperations.ts and server/invoicesService.ts synchronize drafts from orders; shared/schema.ts holds overlapping quote/order/invoice customer, totals, shipping, payment, and status fields. Some fields are valid historical snapshots, so V2 must distinguish them from current mutable copies.
- **Authority is scattered.** Role conditionals appear in server/routes/quotes.routes.ts, server/routes/orders.routes.ts, server/services/productionRunService.ts, and production/quote UI components, while Assistant authority lives under server/services/assistant/.
- **Integrations can mutate business tables.** server/quickbooksService.ts and server/services/quickbooksSyncQueueWorker.ts update Customers, Orders, Invoices, and Payments directly.
- **Fulfillment and Shipping are co-located.** server/routes/fulfillment.routes.ts groups pickup with shipment/package/mark-shipped operations.

These are important ownership conflicts, not a file-by-file criticism. Existing V1 hardening remains behavior evidence for the future contracts.

*Status of these V1 observations (added with the reconciliation).* They describe **V1** and remain accurate for V1. In V2 as implemented: the Routing owner exists and holds the route lifecycle; Artwork, Prepress, Production, Fulfillment, Billing, and Sales are separate modules; QuickBooks synchronization is a V2 queue that writes only its own tables; and shipment/pickup are separate concepts in code even though Shipping's code is hosted in the Fulfillment directories. The V1 QuickBooks direct-write concern survives in exactly one V2-reachable path, the invoice importer (BD-5). The V2 concerns are tracked in [Known boundary debt](#known-boundary-debt), not here.

## Relationship to M0 and implications for M1+

M0 is unchanged: it is a separately buildable/deployable V2 shell with no commercial mutation route and V1 as sole writer. It establishes trusted Principal issuance, pure AuthorityPolicy, organization-scoped repositories, operation-specific idempotency/attribution, durable work, additive migrations with physical postconditions, and boundary tests.

M1+ introduces vertical slices through this owner map, not a general V1 adapter. M1 should establish the commercial spine through Customers/CRM, Products, Pricing behind its contract, Sales, and Billing draft-invoice coordination. It must retain V1 as sole writer until a domain gate passes, use read-only shadow/parity only, avoid dual writes, use compatibility repositories, and record external work transactionally after commit. No startup DDL or copied POC DDL is permitted.

## Known boundary debt

### Ordering campaign retirement evidence

At campaign base `570160ee3515b7cf1404fe2fdbfb41a5905f0e06`, the historical
findings below remain the evidence record. In the campaign working tree,
independently reviewed ownership corrections have retired:

- **BD-1:** Shipping calls Billing's `applyShippingChargeInTransaction` on the
  caller's existing transaction client. Billing alone composes frozen Invoice
  tax and writes additional charges, financial revisions, and totals.
- **BD-2:** Prepress and Fulfillment call Production's case-specific
  `PostgresSuccessorWorkCreation` operations on that same client. Production
  creates ordinary/rework/replacement work and updates its rework-cycle link.
  This extraction preserves current cases; it does not decide BDR-4's future
  successor-work policy, quantity, cancellation, or lineage semantics.
- **BD-4:** Proofing requests the narrow Auth `ensureForProofIssue` operation.
  Auth controls the existing proof-recipient binding, fixed permission-set
  assignment, and authority revision. General Portal access/invitation/credential
  lifecycle ownership and linked-contact customer-binding policy remain BDR-3.
- **BD-3:** Prepress and Sales call Routing's `PostgresOwnerTransitions` for
  scoped frozen-route inspection and transitions; the owner chooses destination
  and next step. Production calls Prepress's `PostgresReworkPreparation` for the
  new preparation unit and retains its own rework-cycle update. All operations
  share the caller's transaction and retain existing capability gates.

Exact retired caller fingerprints have been removed, not renamed as allowed
foreign writes. The two unchanged `customer_portal_access` statements now have
exact legacy-physical-home evidence only inside the bounded Auth operation;
other Portal lifecycle writers remain deferred. New occurrences or mutations
still fail. BD-1 through BD-4 are retired; BD-5, BD-6, and BD-7 are unchanged.
The historical locations in the table must not be used as permission to recreate
the retired debt. Current operation locations are the new owner adapters under
`infrastructure/billing`, `infrastructure/production`, and
`infrastructure/authorization`, `infrastructure/routing`, and
`infrastructure/prepress`.

This section records places where the implementation at `origin/dev @ 63f19bd39a5c9c799aae3f5335709d346077c96a` writes state that this document assigns to a different owner. It exists so the debt is visible, not so it is excused.

**Rules for reading this section**

- Recording debt **does not authorize** the behavior and **does not create an exception** to any ownership statement above. The ownership statements govern.
- New code must not add to this debt. A change that would add a further cross-owner write is a boundary violation regardless of its similarity to an item here.
- Each item names its evidence so it can be re-checked. Retire an item only when the writer no longer performs the write; do not retire it by editing this document.
- Reads, lock-only coordination, calls to the owner's own operation inside one transaction, immutable snapshots, and declared projections are **not** debt and are not listed.

Items BD-1 to BD-5 are the five confirmed ownership violations. BD-6 and BD-7 are recorded because [Decision 4](#decision-4-inventory-coexistence) and [Decision 1](#decision-1-recipebom) make the current state unacceptable as a permanent architecture.

| ID | Debt | Owner of the state | Writer today | Evidence |
| --- | --- | --- | --- | --- |
| **BD-1** | Fulfillment's shipping-allocation adapter recomputes Invoice tax and writes Invoice additional charges, an Invoice revision, and the Invoice totals | Billing ([Decision 2](#decision-2-shipping)) | `infrastructure/fulfillment/postgresShipmentShippingAllocation.ts` (`addCharge`) writes `v2_billing_invoice_additional_charges`, `v2_billing_invoice_revisions`, and `v2_billing_invoices` | Billing has its own writer of the same charge table (`infrastructure/billing/postgresBillingDraftInvoiceTransaction.ts`). Intended pattern: Shipping supplies the authoritative shipping fact and Billing applies it. |
| **BD-2** | Prepress and Fulfillment insert Production work rows without going through Production's creation operation | Production | `infrastructure/prepress/postgresPrepressTransaction.ts` (rework successor); `infrastructure/fulfillment/postgresReplacementObligations.ts` (replacement work) | Production's own creator: `infrastructure/production/postgresProductionTransaction.ts` `createOrGetWork`. The document does not describe successor work; see Business decision BDR-4. |
| **BD-3** | Route-instance step advances written outside Routing; Prepress-unit rows inserted by Production | Routing (step advance); Prepress (prepress units) | `infrastructure/prepress/postgresPrepressTransaction.ts` and `infrastructure/sales/postgresOrderWorkflowTransaction.ts` update `v2_route_instances`; `infrastructure/production/postgresProductionTransaction.ts` inserts `v2_prepress_units` | Routing's own writer: `infrastructure/routing/postgresRoutingLifecycleTransaction.ts`. |
| **BD-4** | Proofing find-or-creates portal access, grants the portal permission set, and bumps the organization authority revision when a proof is issued | Authentication / Permissions (assignments, authority revision); Portal access lifecycle (BDR-3) | `infrastructure/proofing/postgresProofingTransaction.ts` writes `customer_portal_access`, `v2_portal_permission_set_assignments`, `v2_permission_organization_state` | The proof's delivery job is Proofing's own fact; the access and permission facts are not. |
| **BD-5** | The V2 QuickBooks "import invoices" operation calls the retained V1 importer, which writes V1 `invoices` and `payments` | Billing (invoices, payments); Customers | `infrastructure/accounting/quickBooksBillingQueue.ts` (`importInvoices`) calls `importQBInvoicesByIds` in `server/quickbooksService.ts`; reachable through `POST .../import/invoices` in `v2/src/interfaces/http/quickBooksIntegrationRoutes.ts` | The bridge is whitelisted by filename, so the boundary script passes. The V2-facing `syncV2*` functions do not write those V1 tables; this path does. |
| **BD-6** | V2 Inventory writes the V1 counter `materials.stock_quantity` in the same transaction as the V2 movement, and reads it for availability; no reconciliation between the two was found | Inventory ([Decision 4](#decision-4-inventory-coexistence)) | `infrastructure/inventory/postgresInventoryLedgerTransaction.ts` | Not a foreign mutation (Inventory owns both) but duplicate mutable authority. Required end state: a documented compatibility projection or bridge with reconciliation and a defined cutover path. |
| **BD-7** | The neutral unit vocabulary lives in the Products module, so Inventory and Production import Products for a unit type | Neutral vocabulary in `modules/shared` ([Decision 1](#decision-1-recipebom)) | `RecipeUnit` in `products/productRecipes.ts`, imported by `inventory/inventoryLedger.ts` and `production/materialConsumption.ts` | A dependency-direction defect, not a data write. |

Not debt, but related and recorded so they are not mistaken for it: Sales' update of `v2_production_works.ordered_quantity` is a declared projection of the commercial line quantity (code comment at `infrastructure/sales/postgresOrderTransaction.ts`); Fulfillment's calls to Sales' reconciliation function and Billing's replacement-Invoice operation are coordination through the owner; `FOR UPDATE` locks on Billing and Fulfillment rows are lock-only.

## Business decisions required

These are conflicts in the evidence that this document deliberately does **not** resolve. Each lists the competing models and their consequences. A decision belongs to the business owner and is recorded here when made.

### BDR-1: Who owns PBV2 tree authoring and pricing-rule authoring

*Concerns C and D of the [ownership-by-concern table](#pricing--pbv2--products-ownership-by-concern-evidence-reconciliation).*

**Evidence.** This document's Pricing / PBV2 section assigns "questions/options, conditions, defaults, required selections" and "manage pricing structures and formulas" to Pricing / PBV2, and its Products section assigns Products only "PBV2 and Recipe/BOM links" and "must not own price execution." The PBV2 / Pricing Ownership Audit says PBV2 is a component inside the Pricing / PBV2 module. In the implementation, product-scoped tree authoring (options, base price, tiers, matrix, option pricing, formula selection) is performed by the Products lifecycle service under `product.edit`, while the Formula Library is a Pricing service under `pricing.configure`, and publish requires `pricing.publish`. The resolver that turns the tree into `PricingRules` is in Products.

| Model | Description | Consequences |
| --- | --- | --- |
| **M-A. Pricing owns the tree** | Pricing / PBV2 owns tree structure and pricing sections; Products holds the association and orchestrates publish through a Pricing port | Matches the document text and the PBV2 audit. Requires moving or wrapping the largest authoring surface in the repository, splitting one JSON tree between two authors or handing the whole tree to Pricing, and aligning capabilities (`product.edit` versus `pricing.configure`). |
| **M-B. Products owns the tree as an aggregate** | The Product Version aggregate includes the PBV2 tree; Pricing owns the Formula Library, evaluation, and `PricingResult` and consumes a resolved rules input | Matches the implementation. Requires amending this document's Pricing and Products sections and the PBV2 audit's "PBV2 is a component inside Pricing" statement, and stating that "must not own price execution" is the only Products/Pricing line. |
| **M-C. Section ownership inside one tree** | Products owns structure (questions, options, conditions, defaults); Pricing owns the pricing sections (base, tier, matrix, impacts, formula selection) | Fits the tree's own two concerns. Requires a versioned tree contract naming which sections each owner may write, and separate capability checks for each. |

*Also open under this decision:* who owns the resolver that interprets the tree into `PricingRules`, and who owns `v2_product_version_formula_revision_bindings` (Products copies the ACTIVE binding into a new Draft; the Formula domain performs the historical freeze).

**Needed before the Ordering rebuild?** Not for creating Orders, because the runtime seam (`resolveActivePricingInput`, `PricingPort.calculate`, `SellingPriceDecision`) is consistent. Needed before extending pricing authoring further.

### BDR-2: The second material-requirement source

[Decision 1](#decision-1-recipebom) names the Product Version recipe as the authoring source for material requirements. The requirement resolver also derives requirements from PBV2 `choice.inventoryConsumption` (source kind `pbv2_inventory_consumption`), which the PBV2 audit classifies as overloaded configuration ("competing material-requirement logic").

| Model | Consequences |
| --- | --- |
| **Retain as an explicit, provenance-tagged source** | No behavior change; two authoring paths for one fact stay live and must be reconciled by the freeze at conversion. |
| **Migrate into the Product Version recipe and retire the source kind** | One authoring path, matching Decision 1; needs a migration of existing configurations. |

### BDR-3: Ownership of portal access and credential lifecycle

Portal access, invitation tokens, and password-reset tokens are written by four directories (Authentication, Team Access under Settings, Communications, and Proofing). This document says Portal "must not own identity authority" and Authentication owns permission sets. It does not say who owns `customer_portal_access` or the invite lifecycle.

| Model | Consequences |
| --- | --- |
| **Authentication owns portal access and invitation lifecycle** | One operation ("ensure portal access", "issue invitation") called by Proofing, Communications, and Team Access; removes BD-4. |
| **Portal owns it** | Requires reversing the "must not own identity authority" statement. |
| **Customers owns the contact relationship; Authentication owns the credential** | Splits the row; needs a contract between them. |

### BDR-4: Successor (rework and replacement) Production work

BD-2 exists because this document does not describe how rework or replacement creates Production work.

| Model | Consequences |
| --- | --- |
| **Production exposes one "create successor work" operation** that Prepress and Fulfillment call | Removes BD-2; matches the coordination-through-the-owner pattern already used for Sales and Billing. |
| **This document authorizes Prepress and Fulfillment to create successor work under stated conditions** | Codifies the current writes; weakens "one fact, one owner" for Production work. |

### BDR-5: Audit writing shape

Domains write `v2_audit_events` inline in their own transaction. This document reserves Audit / History as a platform module but does not say whether a domain may write the shared table directly or must call an Audit-owned port.

| Model | Consequences |
| --- | --- |
| **Direct inline writes are permitted for the shared table** | Preserves atomicity with the operation; states an explicit shared-table exception. |
| **An Audit port, called inside the transaction** | Single writer; adds a dependency to fifteen adapters. |

### BDR-6: Where Shipping is structured

[Decision 2](#decision-2-shipping) settles *who owns* Shipping facts. It does not decide whether Shipping gets its own module directory. This is an implementation-structure question; it is listed so it is not mistaken for an ownership question.

### Evidence limits

Unverified at this commit and therefore not asserted above: the per-command routing of AI commands to owner operations; the trigger condition for Production's insert of Prepress units; V1 `client/` money-math duplication; triggers in migrations and dynamically built SQL.

## Open questions and required next audit

The module-level questions above are intentionally unresolved. Program-level questions include legal/provider needs for exact PDF-binary retention, Search and Reporting projection freshness, and whether Installation later earns module status through independent crews, appointments, sites, equipment, travel, photos, signoff, and scheduling. Until then, installation is a Product/Route fact, and apparel/fabrication/decorating/graphics/engraving work types use the existing shared modules.

The originally required next tasks, the **PBV2 / Pricing Ownership Audit**, the **Authentication / Permissions Audit**, and the **Routing Ownership Audit**, have been completed (see [PBV2_PRICING_OWNERSHIP_AUDIT.md](PBV2_PRICING_OWNERSHIP_AUDIT.md), [AUTHENTICATION_PERMISSIONS_OWNERSHIP_AUDIT.md](AUTHENTICATION_PERMISSIONS_OWNERSHIP_AUDIT.md), [ROUTING_OWNERSHIP_AUDIT.md](ROUTING_OWNERSHIP_AUDIT.md), and [PRODUCT_ADMINISTRATION_AUDIT.md](PRODUCT_ADMINISTRATION_AUDIT.md)). They are architecture/reconstruction audits only; none authorizes a production migration, business rewrite, or extraction.

The open program-level items are now the [Business decisions required](#business-decisions-required) (BDR-1 to BDR-6) and the retirement of the [Known boundary debt](#known-boundary-debt) (BD-1 to BD-7). Enforcement of this document's ownership rules is mechanical only for import layering today; table-level ownership is not yet machine-checked (see the non-authoritative [V2 ownership audit](../audits/V2_OWNERSHIP_AUDIT_origin-dev-63f19bd3.md)).
