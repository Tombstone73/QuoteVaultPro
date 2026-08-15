# PBV2 / Pricing Ownership Audit

## Status, scope, and evidence

This is an architecture and repository-forensics audit for V2. It defines the future Pricing / PBV2 boundary without implementing an extraction, M1, migrations, runtime changes, database writes, or deployment.

It follows the authoritative [V2 module ownership boundaries](V2_MODULE_OWNERSHIP_BOUNDARIES.md), [reconstruction master plan](../V2_RECONSTRUCTION_MASTER_PLAN.md), [reuse/rewrite inventory](../V2_REUSE_REWRITE_INVENTORY.md), [cutover/rollback plan](../V2_CUTOVER_ROLLBACK_PLAN.md), and [M0 foundation](M0_FOUNDATION.md). Completed POC evidence confirms that the pure option evaluator can be reused behind a V2 adapter, while V2 operations, authority, persistence, and side effects must be reconstructed behind M0 contracts.

## 1. Executive conclusion

PBV2 should survive as the structural configuration and evaluation core of the **Pricing / PBV2** module. Its proven behavior—questions, defaults, conditional visibility, required selections, option impacts, base/tier/matrix/formula price calculation, and pricing resolution—is valuable. It is not, however, a self-contained V2 module today.

The dominant V1 runtime entry point, PricingService.priceLineItem, is an orchestration seam that reads Product, tree, formula-library, and Material records; invokes legacy profiles and nesting; derives shipping weight; builds a Sales snapshot; and applies a manual override. Preserve its pricing behavior through parity fixtures, but do not reuse that application boundary. Reuse proven persistence-free calculation assets behind V2 Pricing and Nesting contracts after removing environment/logging side effects.

The V2 shape is:

    Products supplies product identity and active configuration reference
        -> PBV2 resolves validated configuration facts
        -> Pricing.calculate(resolved configuration, pricing context)
        -> PricingResult
        -> Sales records calculated result and, if authorized, its selling-price decision

Sales must not know PBV2 tree internals. PBV2 must not own stock, reservations, consumption, routing, production, fulfillment, shipping execution, generic product lifecycle, or AI intake provenance.

## 2. Current PBV2 physical responsibility map

| Physical component | Current role | V2 disposition |
| --- | --- | --- |
| products PBV2 pointer and legacy fields | Product links active tree; also stores legacy formula/profile, material, nesting, workflow, imagery, tax fields | Products keeps identity/lifecycle and configuration association; split other concerns |
| pbv2_tree_versions | Organization/product-scoped DRAFT, ACTIVE, DEPRECATED, ARCHIVED tree JSON | Pricing/PBV2 owns configuration semantics/lifecycle; Products owns association/publish orchestration |
| pricing_formulas | Organization-scoped reusable expressions | Pricing owns formula library |
| optionTreeV2 JSON | Configuration plus pricing and non-pricing metadata/effects | Keep pricing structure; move leaks by concern |
| Product Intake tables | Session, question/answer, AI diagnostics, source/provenance, created Product/tree links | Products + AI collaboration; not active pricing runtime |
| option-group templates | Reusable template trees plus workflow/pricing/intent/preview metadata | Pricing retains pricing fragments only; split/reject operational metadata |
| quote/order PBV2 snapshots | Sold/quoted configuration and pricing evidence | Sales-owned historical commercial checkpoint |
| order material / reservation records | Material use, reservations, adjustments, production consumption | Recipe/BOM and Inventory; not PBV2 |

Important references: shared/schema.ts defines pricing_formulas, products, pbv2_tree_versions, Product Intake, and Sales-line snapshots; server/db/migrations/0022_pbv2_tree_versions.sql introduced tree versions; migrations/0036_pbv2_quote_line_items.sql and /0023_add_order_line_item_pbv2_snapshot.sql add commercial snapshots.

## 3. Current authoritative pricing paths

### Dominant PBV2 commercial path

PricingService.priceLineItem in server/services/pricing/PricingService.ts is the principal V1 PBV2 runtime calculation path.

1. Tenant-load Product, selected active/override tree, formula-library record, and material rows.
2. Resolve dimensions, fixed dimensions, quantity-only behavior, defaults, conditional/required selections, and pricing-matrix variables.
3. Derive base/tier/formula price, including legacy profile and sheet/roll calculation inputs.
4. Call evaluateOptionTreeV2 for selected option price impacts.
5. Round to cents, build PBV2 snapshot/breakdown, and return line total.
6. If supplied, a manual override short-circuits the calculated total but still builds a snapshot.

Quotes call it through several routes, including server/routes/quotes.routes.ts. Orders do likewise in server/routes/orders.routes.ts. Inbound Orders and AI direct intake also call it through server/services/inboundOrders/InboundOrderService.ts, assistant/quoteDraftIntakeService.ts, and assistant/orderIntakeService.ts.

### Preview path

evaluatePricingPreviewFromTree in the same file performs a related read-only calculation for draft trees. Product routes and AI product-management code call it directly. It accepts resolved tree/formula/material facts rather than performing Product/tree persistence reads. It is useful parity evidence but is still not the V2 interface.

### Materially distinct legacy paths

V1 does **not** enforce one complete pricing authority across all code:

- The PBV2 commercial and preview paths share substantial math but have different loading and input behavior.
- server/pricingService.ts retains a legacy tier/wholesale/retail/customer modifier and tax family, and server/quoteOrderPricing.ts orchestrates tax/transaction totals.
- server/PricingPipeline.js and legacy profile behavior remain adjacent legacy calculation infrastructure.

Therefore the practical finding is one **dominant PBV2 price evaluator family**, plus active legacy commercial/tax utilities and retained legacy pipeline/profile code. V2 must prove which legacy behavior is still customer-relevant before retirement; it must not claim V1 has one enforced calculation authority.

### Price behavior presently covered

The PBV2 family supports per-square-foot, per-piece, fee/quantity-only behavior, fixed dimensions, minimum charge, quantity and square-foot tiers, matrix rows/tier bases, formula-library/manual formulas, numeric and choice-level impacts, percentage/multiplier/fixed/per-unit effects, selection visibility/rules, computed-sheet-use inputs, roll rotation/layout, manual override, and cents breakdown/snapshots. Formula/matrix/tier precedence and rounding are behavior to preserve by fixture, not re-specify casually.

## 4. Current persistence and lifecycle model

products currently holds a PBV2 active-tree pointer, while DRAFT is discovered from pbv2_tree_versions. The tree table has organization/product ownership, status, treeJson, and audit fields. Publishing/replacement behavior is currently coordinated by product/PBV2 services and builder routes; pricingProfileConfig.pbv2Override can choose a version through server/lib/pbv2OverrideConfig.ts.

This is physically mixed with a legacy product optionTreeJson and numerous Product columns. The active pointer is not historical pricing truth. Quote lines hold a non-null tree/version snapshot; order lines retain nullable version/snapshot for compatibility; conversion copies snapshots rather than repricing in server/storage/orders.repo.ts. These are intentionally preserved Sales historical facts, not mutable PBV2 state.

### Minimum future PBV2 lifecycle

- One configuration definition may be DRAFT, ACTIVE, DEPRECATED, or ARCHIVED.
- A Product references the one configuration approved for new commercial calculations.
- Normal calculation resolves only the Product-associated ACTIVE configuration. An explicit historical configuration is authorized only through an existing Sales checkpoint; a DRAFT configuration is available only through a distinct scoped editor-preview operation.
- Normal Product edits do not create a full commercial history version.
- Sales creates immutable commercial checkpoints when a quote is sent, accepted/converted, or invoice issued.
- Existing Quotes/Orders never silently reprice when a Product/PBV2 configuration changes.

The exact publish authorization and deprecation/archival retention policy remain product decisions, but V2 needs no second mutable product copy or one new version per ordinary product edit.

## 5. Current consumers

| Consumer | Current relationship | V2 classification |
| --- | --- | --- |
| Quotes and Orders | Direct priceLineItem calls and PBV2 snapshots | Legitimate Pricing consumer through Sales operation |
| Product Builder / preview | Direct preview and tree mutation | Pricing configuration editor; never runtime contract |
| Inbound Orders | Price candidate/review lines directly | Legitimate Pricing consumer; final order through Sales |
| AI | Direct calculation and product-intake proposal paths | Legitimate scoped caller; no pricing rule owner |
| Invoice synchronization | Copies commercial sold-line fields but V1 invoice lines do not carry PBV2 tree/snapshot columns | Consumer of Sales/Billing facts; must not reprice |
| Inventory/Prepress/Production | Material effects, weight, component/reservation work | Must consume resolved facts/Recipe/BOM/Inventory, not PBV2 |
| Routing | Workflow tags and Product Intake route inference | Must consume Product/resolved facts; Routing owns movement |
| Shipping | Weight/shipping config in snapshots | Must consume physical facts/shipment contract, not PBV2 |
| Reporting/Portal | Indirect sales/product display | Read DTO consumer, not evaluator owner |

## 6. Pure reusable assets and reuse classification

| Asset | Classification | Reason |
| --- | --- | --- |
| evaluateOptionTreeV2 in server/services/optionTreeV2Evaluator.ts | REUSE BEHIND V2 CONTRACT | Persistence-free option-impact, visibility, and effective-selection calculation; has legacy-shape fallbacks plus process-environment logging to remove/contain |
| optionTreeV2Runtime, validators, formula scope/helpers, matrix resolver, pricing adapter | REUSE BEHIND V2 CONTRACT | Deterministic/strongly tested units; expose only through Pricing |
| PricingService priceLineItem | RECONSTRUCT | DB/Drizzle, Product/Material/formula loading, legacy profile, nesting, shipping weight, snapshot, override, and logging coupling |
| PricingService preview | RECONSTRUCT AS V2 ADAPTER | Valuable calculation composition but V1 input shape and mixed responsibilities |
| golden/snapshot/validator tests | REUSE BEHIND V2 CONTRACT | Characterization/parity evidence |
| rollMediaLayout and useful sheet calculators | REUSE BEHIND V2 NESTING CONTRACT | Reusable geometry, not PBV2/Pricing ownership |
| legacy pricingService, quoteOrderPricing, PricingPipeline | CHARACTERIZE THEN REMOVE OR CONTAIN | Retained competing/legacy behavior; do not import as V2 Pricing |
| PBV2 material effects/reservations | RECONSTRUCT BEHIND RECIPE/INVENTORY | Wrong current ownership and competing interpretations |

The POC specifically validates a clean adapter around evaluateOptionTreeV2. It does not authorize importing V1 PricingService, routes, repositories, or the V2 POC runtime into production V2.

## 7. Configuration versus price evaluation

PBV2 is the versioned configuration language: option/question structure, conditional visibility, defaults, required selection rules, valid dimensions/quantity behavior needed for pricing, embedded price-side formula/tier/matrix definitions, and resolution of selected facts. PBV2 owns the embedded definition and its identity; Pricing owns evaluation precedence, rounding, reusable Formula Library, and PricingResult semantics.

Pricing is the application boundary that accepts resolved configuration and declared calculation context, applies the evaluator, returns a deterministic PricingResult, and owns formula-library evaluation, matrix/tier precedence, and rounding semantics. It must not require a Sales caller to load or interpret tree JSON. A runtime-equivalent calculation context declares measurement mode, pricing profile/key/configuration, primary-material reference, and required material facts; a tree alone is not a complete commercial calculation input.

Recommended contract shape:

    Products.resolveSellableConfiguration(productRef)
      -> { configurationRef, PBV2 definition, Product pricing facts }
    PBV2.resolve(configuration, explicit selections, dimensions, quantity)
      -> ResolvedProductConfiguration
    Pricing.calculate(resolved configuration, pricing context)
      -> PricingResult { calculated money, breakdown, evaluator/config identity, resolved price inputs }
    Sales.applyCommercialDecision(PricingResult, authorized override?)
      -> SellingPrice decision and historical checkpoint

Tax calculation, invoice finalization, and payment processing remain outside Pricing. Pricing returns product price; Sales/Billing apply their own commercial, tax, and financial rules through explicit operations.

## 8. Non-pricing concerns currently inside PBV2

### Product, media, and lifecycle concerns

Tree metadata currently contains productImages, dimension/measurement hints, and product-oriented metadata. Products owns catalog lifecycle, Product Type, measurement classification, fixed dimensions, storefront availability, and product publishing; Assets owns reusable images. Pricing may consume resolved facts but must not own their lifecycle.

### Product Intake and AI provenance

Product Intake is already separately persisted in product_intake_sessions, questions/answers, and AI diagnostics. It records source fingerprint, confidence, decisions, generated Product/tree references, and diagnostics. productIntakeDraftService currently derives formula, material, nesting, route, production/proof, and other facts while creating a draft.

That is proposal/review/provenance orchestration, not active PBV2 runtime truth. Products owns accepted Product creation/provenance; AI owns proposal/model context; Audit owns meaningful accepted-operation history. Preserve audit-worthy source linkage, but do not embed large intake/session/provenance records in active pricing configuration. stripImportedProductIntakeReferences is evidence that some intake metadata is already treated as import-local review data.

### Template metadata

pbv2_option_group_templates includes workflow_metadata, pricing_metadata, intent_metadata, preview_config, and whole templates. Retain reusable pricing configuration fragments under Pricing; move template association/availability to Products and route/workflow semantics to Routing. Reject cross-domain payloads at the V2 Pricing boundary rather than preserving a generic metadata bag.

## 9. Recipe/BOM and Inventory boundary

PBV2 currently overloads configuration for manufacturing requirements:

- PRICE-node materialEffects in shared/pbv2/pricingAdapter.ts produce skuRef, quantity, and UOM.
- Choices expose materialOverride and inventoryConsumption in shared/optionTreeV2.ts.
- Effects contain setMaterial and materialUsage.
- Orders enrich PBV2 material effects, snapshot them, and create reservations through server/lib/pbv2InventoryReservations.ts.
- Prepress independently recomputes choice inventory consumption in server/services/prepressPlannedMaterials.ts.
- Production/prepress paths record usage, changes, and stock effects.

This is competing material-requirement logic. It is not a reason to keep accounting in PBV2.

### Target Recipe/BOM contract

Recipe/BOM is initially a Products-owned manufacturing-definition capability, co-designed with Inventory. It does not yet justify a speculative top-level module because V1 has no authoritative recipe revision, effective-date, component-quantity/formula, lifecycle, or configured-product requirement model.

PBV2 exposes resolved variables only, for example selected substrate, selected laminate, grommet count, dimensions, quantity, sides, and price-relevant configuration. Recipe/BOM evaluates Product-owned rules into MaterialRequirement items, including material identity, quantity expression, UOM, waste policy, and recipe identity. Inventory validates Material identity/units and exclusively owns availability, reservations, movements, adjustments, and actual consumption. Production reports actual use through Inventory.

A recipe change after a Sale must not rewrite history. Sales records the resolved configuration and PricingResult; when material planning becomes authoritative, the line/work item also needs a resolved RecipeRequirement checkpoint containing recipe identity/version and resulting requirements. Do not snapshot entire mutable Product/PBV2 state at every edit.

## 10. Nesting boundary

PricingService currently uses server/NestingCalculator.js, shared/pricingProfiles.ts flatGoodsCalculator, shared/pbv2/rollMediaLayout.ts, and rollMaterialEffects.ts. V1 therefore contains multiple layout implementations with partially overlapping purposes. Pricing needs an **estimate** such as sheets, billable area, or a tier basis; Production will need an actual job nest, instructions, and actual consumption.

The geometry in rollMediaLayout—rotation, margins, allowances, fit, billable area, and linear-foot estimate—is a strong reusable Nesting candidate. It is not PBV2-owned merely because formulas reference it.

Future operations are distinct:

- Nesting.estimateForPricing(geometry, constraints) returns deterministic billable/required quantity facts for Pricing.
- Nesting.planForProduction(jobs, material/machine constraints) returns actual operational nesting output for Production.

PBV2 provides dimensions and selected configuration facts. Pricing and Production call Nesting independently. Preserve parity before selecting or consolidating a V1 layout implementation.

## 11. Routing, Production, Prepress, and Artwork boundary

Current PBV2 choices carry workflowTags; Effect supports requireArtwork, setSides, setProductionNote, and related operational effects; Product Intake records productionRoute and infers routes from text. These classify differently:

| Current concept | V2 disposition |
| --- | --- |
| selected sides, finishing, double-sided, grommet requirement | Resolved product/configuration fact; Products/Recipe may define meaning |
| required artwork | Product artwork policy, consumed by Artwork/Prepress |
| production note/configuration | Resolved Product/Recipe/Production input; Production owns execution state |
| station/printer/production route | Product Type/default route input and Routing template decision |
| workflow tag and transition | Routing only |
| proof/prepress/production completion | Artwork/Prepress/Production report facts; Routing decides movement |

PBV2 may resolve a selected fact. It must never instantiate a route, select a next workflow step, mutate station/job state, or move work.

## 12. Shipping and weight boundary

PBV2 tree metadata currently has shippingConfig/base-weight fields; selections may have weightImpact; PricingService loads material weight and records resolved weight debugging/snapshots. A configured product can legitimately resolve physical facts such as selected substrate, estimated weight, or shippable status. It cannot own shipment, package, carrier/service choice, rate, label, tracking, or carrier handoff.

Target ownership:

- Products owns durable product physical classification and default shippability.
- Recipe/BOM and Inventory Materials own authoritative component/material characteristics, including weight where applicable.
- PBV2 resolves selected configuration variables and may contribute a price-side physical estimate only through an explicit input/result.
- Shipping owns package/shipment/carrier/rate execution and consumes authoritative physical facts.
- Pricing may consume a declared physical estimate only when price rules genuinely require it.

The precise allocation of base weight between Product and Recipe/BOM is an open product decision. Shipping policy and carrier calculations do not belong in PBV2.

## 13. Calculated Price versus Selling Price

Pricing owns **Calculated Price**: a deterministic, explainable result for a specified configuration, dimensions, quantity, price configuration identity, and declared pricing inputs. It includes monetary result, breakdown, evaluator/config identity, formula/matrix/tier resolution, and relevant rounding information.

Sales owns **Selling Price**: the commercial amount offered/agreed for a Quote or Order. Sales may apply an explicit authorized negotiated unit/total override, discount, or price lock to a calculated result. It must store override reason/type, actor/authority, time, and source calculated result. An override must not overwrite, hide, or retrospectively mutate Pricing's calculated result.

Current evidence supports this split: shared/lineItemPriceOverrides.ts and Quote/Inbound paths normalize line-level overrides, while PricingService accepts overridePriceCents as a short circuit. In V2 the override decision moves out of the pricing evaluator input and into a named Sales operation.

## 14. Historical pricing contract and Sales/Billing implications

The minimum reliable historical pricing checkpoint for a commercial line is:

- Product and PBV2 configuration identity/reference used.
- Normalized ResolvedProductConfiguration relevant to the sale: selected/effective options, resolved dimensions, quantity, and pricing-relevant derived facts.
- PricingResult: calculated amount/breakdown, tier/matrix/formula resolution and identity/expression as needed to reproduce/explain the result, evaluator/version identity, currency, and rounding policy. A mutable formula-library ID alone is insufficient: preserve the resolved expression/configuration and tree identity/content used.
- Sales selling-price decision: calculated amount reference, override/discount/lock decision where present, resulting unit/line amount, authority, and reason.
- Tax decision/snapshot owned by Sales/Billing, not PBV2.
- For manufacturing work, later resolved RecipeRequirement identity/result separately from the price result.

This is deliberately smaller than copying every mutable Product field. Quote sent preserves this checkpoint. Quote conversion preserves the accepted Quote commercial snapshot and does not reprice; the POC quote-conversion evaluation proves that pattern. Order edits create a new current commercial result only when pricing-relevant facts change and record a concise audit event. Issued Invoice preserves issued financial/document data and invoice-line selling/tax amounts; it should reference the Sales commercial checkpoint, not contain a second mutable PBV2 tree. V1 invoice_line_items do not carry PBV2 tree/snapshot columns, so absence of immutable PBV2 lineage on an invoice line is a compatibility/history constraint to address by reference rather than by duplicating a mutable tree.

## 15. Validation and test assets

Strong future characterization assets include:

- server/services/pricing/tests/PricingService.goldenRegression.test.ts for formula library, matrix tiers, rotation, sheet yield, and runtime parity.
- PricingService.snapshotPersistence.test.ts for preview versus persisted Quote/Order result.
- Focused formula, formula-scope, formula-variable, base-price, matrix, option-rule, numeric-option, choice-override, and sheet-consumption suites in server/services/pricing/tests.
- shared/pbv2/tests for validators, formula helpers, matrix sanitizing/drafts, roll layout, variable catalog, component discounts, and runtime context.
- shared/tests/productOptionPricingMatrix.test.ts and shared/tests/pbv2OrderEntryRuntime.test.ts.
- server/tests/inboundOrderPricing.test.ts and quote/order contract tests for caller behavior.

The V2 parity inventory must cover per-square-foot, per-piece, quantity-only/fee, minimum charge, quantity and square-foot tiers, matrix, formulas, fixed and custom dimensions, conditional options, choice/numeric/percentage/non-stacking impacts, manual override, computed-sheet usage, rotation, snapshot persistence, foreign-organization rejection, same-organization cross-product rejection, and inactive-configuration rejection. Rounding fixtures must assert stages, not only totals: half-cent and negative adjustments, mixed modern/legacy impacts, percent-on-options-subtotal ordering, fractional per-square-foot geometry, and base-plus-options boundaries.

Known gaps: no proven single source for legacy pipeline/profile behavior; multiple nesting implementations need comparative fixtures; material requirement/reservation identity is not coherently characterized; and formula runtime/library version semantics need an explicit V2 fixture matrix.

## 16. Explicit KEEP / MOVE / REMOVE inventory

| Concern | Classification | Target owner |
| --- | --- | --- |
| Option/question structure, defaults, conditional visibility, required rules | KEEP IN PBV2 | Pricing / PBV2 |
| Base price, tiers, matrices, formulas, option price impacts | MOVE TO PRICING BOUNDARY | Pricing / PBV2 |
| Formula library | MOVE TO PRICING BOUNDARY | Pricing |
| Resolved configuration and deterministic price breakdown | KEEP IN PBV2 / MOVE TO PRICING BOUNDARY | PBV2 resolution + Pricing result |
| Product identity, lifecycle, Type, availability, publishing association | MOVE TO PRODUCTS | Products |
| Product image metadata | MOVE TO ASSETS | Products + Assets |
| Fixed dimensions/measurement classification | MOVE TO PRODUCTS | Products; Pricing consumes facts |
| materialId, materialOverride, inventoryConsumption, materialUsage, waste, materialEffects | MOVE TO RECIPE/BOM | Products Recipe/BOM with Inventory contract |
| reservations, stock, movement, actual consumption | MOVE TO INVENTORY / MATERIALS | Inventory |
| sheet/roll layout, rotation, yield, billable/actual nest | MOVE TO NESTING | Nesting |
| workflowTags, routes, station selection, transitions | MOVE TO ROUTING | Routing |
| production notes/execution configuration | MOVE TO PRODUCTION | Production; inputs from Products/Recipe |
| requireArtwork | MOVE TO PRODUCTS | Product artwork policy; Artwork/Prepress consume |
| shippingConfig/carrier/rate behavior | MOVE TO SHIPPING | Shipping; physical facts from Products/Recipe |
| base/configuration-derived weight estimate | REQUIRES PRODUCT DECISION | Products versus Recipe/BOM; Shipping consumes |
| Product Intake session, confidence, source/fingerprint, AI diagnostics | MOVE TO AI / PRODUCT INTAKE | Products + AI + Audit |
| template workflow/intent metadata | MOVE TO PRODUCTS / ROUTING / AI | Split by semantic owner |
| pricing adapter and pure helpers | REUSE AS PURE SHARED UTILITY | Behind Pricing/Nesting contracts |
| shared to server evaluator re-export | RECONSTRUCT | Eliminate reverse dependency during scoped extraction |
| legacy PricingPipeline and obsolete compatibility branches | REMOVE AS OBSOLETE / LEGACY after parity | Retire only with evidence |
| childItemEffects commercial structure | REQUIRES PRODUCT DECISION | Sales bundle versus Product composition/Recipe |

## 17. Proposed V2 target architecture

PBV2 is a **component inside the Pricing / PBV2 module**, not a sibling business module. It owns a versioned configuration language and resolution semantics. Pricing owns formula library, matrix/tier semantics, deterministic calculation, validation of price configuration, and the PricingResult contract.

Products owns product identity/lifecycle and one association to pricing configuration. It does not evaluate price. Products may coordinate safe configuration publishing, but the Pricing module validates the configuration it owns.

Sales is Pricing's commercial caller. It receives a stable DTO and never reaches a PBV2 repository/tree. Sales owns Quote/Order current commercial state, sent/accepted/conversion checkpoints, and negotiated selling-price overrides. Billing owns invoices/payments and copies/references issued commercial financial history, never reruns Pricing to change issued money.

Recipe/BOM, initially within Products, consumes PBV2 resolved facts to return material requirements. Inventory owns material truth and stock effects. Nesting owns reusable estimates and production nests. Routing owns route templates/instances/transitions. Shipping owns shipping execution. AI/Product Intake owns generation/review/provenance; Assets owns media.

## 18. Safe future extraction sequence

1. Freeze and expand characterization/parity fixtures for the calculator families and historical snapshots; include cent/rounding assertions.
2. Define V2 Pricing DTOs: sellable configuration read, ResolvedProductConfiguration, Pricing.calculate request/result, and Sales commercial-decision request.
3. Extract/adapt pure evaluator, validation, formula/matrix/tier helpers behind the Pricing boundary without V1 routes, DB, Product, Material, or process logging.
4. Build a compatibility reader that resolves current Product + Product-associated active/historical tree + formula-library into the DTO; prove cross-tenant, same-organization cross-product, and lifecycle rejection.
5. Recreate PriceLineItem orchestration as a V2 Pricing application operation, preserving math behavior but leaving Sales snapshot and override ownership to Sales.
6. Prove preview/runtime parity and Quote/Order snapshot compatibility on a disposable DEV-shaped clone; shadow-read/calculation only.
7. Introduce the clean Sales-to-Pricing call for the V2 commercial slice, with durable request/idempotency and explicit calculated-versus-selling price.
8. Extract non-pricing configuration facts through Products, Recipe/BOM, Nesting, Routing, Shipping, Artwork, and AI contracts one category at a time; do not dual-write mutable facts.
9. Retire V2 dependence on legacy PBV2 orchestration only after parity, cutover, and compatibility-read evidence.

## 19. Risks and exit criteria

### Five highest-risk extraction points

1. Formula/matrix/tier precedence and exact cents rounding can change subtly if helpers are recomposed.
2. PricingService hides database dependencies on Product legacy fields, formula library, material rows, and active-tree override resolution.
3. Current sheet/roll calculations mix pricing estimate, material geometry, and production consumption; selecting one implementation too early risks price drift.
4. Historical snapshots contain more than a current tree pointer; careless normalization can reprice sent/accepted work or overwrite negotiated sales truth.
5. PBV2 material effects and Prepress/Production recomputation use incompatible identities/semantics, including reservation keys not consistently line-item-specific.

### Exit criteria before extraction begins

- Approved ownership map and open decisions resolved or explicitly deferred with compatibility strategy.
- Representative parity fixture suite and accepted legacy-behavior register exist.
- V2 DTOs name all required inputs/results and own rounding/evaluator identity explicitly.
- Compatibility reader is organization and Product-association scoped, rejects inactive configuration for normal pricing, and permits historical identity only from a Sales checkpoint without V1 business service imports.
- Sales override and historical checkpoint contract is approved.
- Recipe/BOM, Nesting, Routing, and Shipping seams are declared so PBV2 non-pricing data is not silently copied forward.
- Disposable clone plan proves calculation, snapshot, tenant, idempotency, and failure behavior before any V2 domain writer cutover.

## 20. Open product decisions

- Which physical weight facts belong on Product versus Recipe/BOM, and when does a price calculation need them?
- Is childItemEffects a Sales bundle/commercial-line feature, Product composition, or Recipe/BOM component behavior?
- What exact legacy customer-tier/markup/discount behavior remains supported versus deliberately retired?
- What is the Formula Library compatibility/version policy after an expression changes?
- Which route/product facts are persistent Product Type data versus configuration-resolved facts?
- What minimum proof/prepress/production requirements should be product policy versus selected configuration?
- What legal/provider requirements, if any, require exact document binary retention rather than immutable data/render-on-demand?
- When does Recipe/BOM acquire sufficient independent lifecycle to become a top-level module?

## 21. Adversarial review findings resolved

A fresh review challenged the proposed boundary against hidden V1 dependencies. The audit resolves the findings as follows:

- Configuration reads must validate organization, Product association, and lifecycle. Current V1 loadTreeVersion is organization-scoped but does not verify Product association/status, and quote routes accept a tree override; V2 normal pricing must not repeat that same-tenant cross-product/inactive-tree exposure.
- PBV2 owns versioned embedded formula/tier/matrix definitions; Pricing owns their precedence and evaluation. Formula Library is mutable in V1, so historical PricingResult preserves the resolved expression/configuration rather than only a library ID.
- The option evaluator has no DB/Product read, but it is not side-effect-free because it reads process environment and emits logs. It is a persistence-free reuse candidate only after that behavior is removed or contained.
- Preview requires explicit resolved Product/material inputs in addition to a tree. V2 contracts must name those inputs rather than pretending that tree JSON alone is sufficient.
- Current invoice lines preserve commercial data without PBV2 snapshots. V2 references the immutable Sales checkpoint for pricing lineage instead of inventing a second mutable invoice copy.
- Exact rounding stage parity is an extraction gate because V1 rounds impacts and totals at more than one point.

## 22. Explicit answers

- **Is there currently one authoritative pricing evaluator?** No. priceLineItem is the dominant PBV2 commercial path and shares math with preview, but V1 retains active legacy pricing/tax utilities and legacy pipeline/profile code. There is no enforced single authority across all callers.
- **Can the proven pricing evaluator be reused without V1 orchestration?** Yes, behind a V2 contract. evaluateOptionTreeV2 and adjacent persistence-free helpers are the clearest candidates after logging/environment behavior is contained; priceLineItem itself is reconstructed.
- **Is PBV2 doing Routing work?** Yes: workflow tags, route/station/proof/prepress/production intent are embedded or inferred. PBV2 may emit facts; Routing owns movement.
- **Is PBV2 doing Inventory work?** Yes: material effects, overrides, inventory consumption, reservations, and material rollups are coupled into PBV2/Order/Prepress paths. Recipe/BOM and Inventory own the future behavior.
- **Is PBV2 doing Nesting work?** Yes: it reaches sheet/roll layout helpers and exposes computed sheet/roll results. Nesting owns the reusable calculations.
- **Is PBV2 doing Shipping work?** Yes: shipping config and weight impacts are stored/evaluated there. It may resolve physical facts but Shipping owns workflows/rates.
- **Does active PBV2 runtime need Product Intake metadata?** No evidence shows that it does. Active pricing requires the validated pricing configuration and declared inputs, not session/provenance/AI diagnostics.
- **What must a historical Quote/Order preserve?** Configuration identity, normalized resolved configuration, PricingResult/breakdown with formula/matrix/tier/evaluator/rounding evidence, and Sales selling-price decision. Preserve a resolved recipe result separately when manufacturing planning needs it.
- **What must an issued Invoice preserve?** Issued invoice/line financial, tax, and commercial selling-price data sufficient to reproduce the issued document, with references to its Sales checkpoint; no mutable PBV2 dependency.
- **Can V2 Sales consume Pricing without PBV2 internals?** Yes. It consumes ResolvedProductConfiguration and PricingResult DTOs only.
- **What should be the first implementation prompt after this audit?** “Create the V2 Pricing contract and parity-fixture plan: define scoped read DTOs, ResolvedProductConfiguration, Pricing.calculate request/result, calculated-versus-selling price command, and tests that adapt the existing PBV2 golden/snapshot fixtures. Do not add production writers or migrations.”
