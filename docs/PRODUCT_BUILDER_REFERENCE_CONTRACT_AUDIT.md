# Product Builder Reference Contract Audit

## Decision

The Lovable Product Builder can converge primarily through UI composition over
existing V2 contracts.  No blocking Pricing, Recipe, Production, Routing, or
publication backend redesign is required first.  The implementation must not
copy the reference mock model as a persistence model: a few visible concepts
are either legacy convenience data, derived facts, or not implemented.

**Contract rule:** a Product Builder Draft composes ProductVersion authoring
contracts.  Pricing remains server-authoritative; Recipe defines physical
requirements; Materials/Inventory own stock and conversion; Routing owns route
templates; Production owns execution; publication is the only path from Draft
to immutable ACTIVE ProductVersion.

## Capability matrix

| Reference section | UI concept | Existing contract / owner | Class | Implementation mapping / risk |
| --- | --- | --- | --- | --- |
| Header / Basics | Product selector, active/draft/history | `ProductWorkspaceReads`, `ProductVersionLifecycle` | A | Server list/detail and version history are authoritative. |
| Header / Basics | New Product | No V2 Product-identity creation route found; current route creates a Draft from an existing Product | E | Keep this control out of the convergence scope or add a separate Product-identity creation milestone. |
| Basics | Name, category, description, measurement mode, workflow intent, proof/production flags | Draft General (`productRoutes`, `ProductVersionLifecycle`) | A | Draft-only mutation with revision protection. |
| Basics | Save Changes / dirty state | Separate Draft General, Options, Pricing, Matrix, Formula, Option-pricing, Recipe, Routing mutations | B | One UX save must sequence canonical mutations, retain each returned revision, stop on first failure, and refresh on stale state. |
| Options | Groups/options/choices/defaults | PBV2 tree; Draft Options API | A | Preserve stable option and choice values; conditions and matrix dimensions depend on them. |
| Options | Delete/edit an identity | Draft Options validates PBV2 tree; Recipe and Production validate their own references | B | Re-fetch dependent sections before save and surface server conflict/validation.  Do not promise a client-only cascading delete. |
| Pricing | Simple rate, minimum, quantity/square-foot tiers | Draft Pricing API | A | Canonical ProductVersion pricing metadata. |
| Pricing | Formula Library expression | Shared `pricing_formulas` / Formula read API | A | Show identity/expression read-only for library formulas. |
| Pricing | Product Formula inputs | Draft Formula API, `productFormulaInputs.ts` | A | Editable only when formula exposes supported ProductVersion inputs; never duplicate or edit shared expression. |
| Pricing | Matrix dimensions/cells/tiers | Draft Matrix API | B | Support N dimensions in data; present sliced 2-D views.  Do not reduce to two persisted axes. |
| Pricing | Computed-sheet matrix tiers | Resolver supports them; Draft Matrix editor deliberately treats them read-only | C | Preserve/display, but do not offer an unsafe generic editor. |
| Pricing | Option price impacts | Draft Option-pricing API | A | Map reference adders to `fixed`, `per_item`, `per_square_foot`, `percent_of_base`, or `multiplier`. |
| Pricing preview | Local `computePreview` | Canonical server resolver and `V2PricingParityAdapter` | F | Replace mock computation entirely with server preview; React only renders the result. |
| Materials / Recipe | Component, quantity, unit, per-line/per-piece/per-area | `ProductRecipeApplicationService` / Recipe components | A | Use stable material IDs and Recipe units. |
| Materials / Recipe | Option condition / choice | Recipe component condition using Product Option ID + immutable choice value | A | Picker must store IDs/values, not labels. |
| Materials / Recipe | `Replaces primary material` | `replacesPbv2Compatibility` suppresses a matching legacy PBV2 compatibility requirement only | F | Rename to **Replace matching legacy PBV2 compatibility requirement** and show only where applicable. It is not primary-material substitution. |
| Materials / Recipe | `Normalize to inventory unit` toggle | Material requirement resolver + Material inventory/consumption units + sheet normalizer | F | Remove the toggle. Normalization is canonical, automatic, and may reject unsupported relationships. |
| Materials / Recipe | Primary material | Legacy `products.primary_material_id` convenience/read projection | G | It is not a Recipe component or consumption authority. Display as legacy/catalog context only until an explicit domain decision. |
| Materials / Recipe | Weight / basis | Canonical `materials.weight_*` metadata | G | Material-owned read-only source data; no ProductVersion duplicate. |
| Materials / Recipe | Product fallback weight | No ProductVersion fallback-weight contract found | D/E | Treat as mock; only add after a Shipping/Fulfillment decision establishes its owner and use. |
| Materials / Recipe | Shipping policy | No ProductVersion shipping-policy contract found | F | Shipping/Fulfillment owns shipment decisions; do not persist beside Recipe. |
| Materials / Recipe | Trim allowance | Formula inputs such as `piece_allowance_x/y`, billing increments, and nesting configuration where supported | B | Map only to formula-specific Product inputs; do not add generic Recipe trim columns. |
| Production | Unit requirements, side/page/layer and conditions | `ProductionUnitSpecification`, `productionRequirements.ts` | A | Preserve arbitrary keyed rules with optional front/back, page, layer, and option condition. |
| Production | Station/destination | Product authoring does not own execution destination | F | Product Builder may display policy/context, but Production/Routing own operational assignment. |
| Routing | Route required/no route/unconfigured and selected template | Product Draft Routing; Routing template authoring | A | Product selects a template; server snapshots name/revision/fingerprint/steps. |
| Routing | Edit steps / duplicate-customize | Routing module | F | Navigate to Routing workspace. Never edit route steps from Product Builder. |
| Review / Publish | Cross-section summary and Publish | Draft read ports + publication service | A | Server validation/publication remains authoritative; ACTIVE is never edited in place. |
| Right rail | Pricing/material/production/routing resolution | PricingResult, Recipe resolver, production resolver, routing projection | G | Show only canonical projections; no second persisted model. |

## Recipe and Materials contract matrix

| Reference concept | Actual support and owner | Editable in Product Builder? | Reference accuracy / implementation recommendation |
| --- | --- | --- | --- |
| Material | Recipe component references a tenant Material by ID; Material owns catalog, stock units, and weight | Yes, Draft Recipe | Accurate after mapping picker to Material IDs. |
| Requirement basis | `per_line`, `per_piece`, `per_area` | Yes | Map labels precisely; `per_area` requires `square_foot`. |
| Factor | Decimal component quantity | Yes | Accurate. |
| Unit | `each`, `square_foot`, `linear_foot`, `sheet`, `roll` | Yes, constrained | Picker, not free text. |
| Option condition / choice | `selected` condition with Option ID and choice value | Yes | Accurate only with stable IDs/values. |
| Replaces primary | Compatibility suppression, not primary replacement | Narrow conditional support | Rename and limit as described above. |
| Normalize to inventory unit | Resolver calls `normalizeMaterialReservation` from Material operational metadata | No toggle | Reference semantics are inaccurate. |
| Primary material | Legacy Product pointer used in catalog projection | No Draft Recipe mutation | Read-only compatibility context; not a single canonical consumption material. |
| Multiple/additional consumables | Multiple Recipe components and PBV2 compatibility requirements | Yes | Supported; all applicable components resolve and freeze independently. |
| Material weight / weight basis | `materials.weight_value`, `weight_unit`, `weight_basis`, `weight_oz_per_basis` | Material domain, not this Builder | Read-only material data; current Recipe resolver does not produce shipping weight. |
| Fallback weight / unit | No Product fallback contract | No | Mock pending explicit Shipping/Fulfillment architecture decision. |
| Shipping policy | No ProductVersion contract | No | Wrong placement; Shipping/Fulfillment decision, not Recipe. |
| Trim allowance width / height | Some Formula Library input definitions (`piece_allowance_x/y`) and formula/nesting semantics | Formula-input dependent | Do not make generic Recipe fields. |

### Actual resolution semantics

Recipe resolution is physical, not commercial.  It filters conditional
components by the frozen selected configuration, calculates per-area and
per-piece quantities, then uses the Material normalizer to convert known
requests into the configured inventory/consumption unit.  Unsupported pairs
fail safely; Product names never imply a conversion.  Order conversion freezes
the resolved requirements; Inventory reserves/receives/releases and Production
reports actual consumption against those frozen facts.

The system therefore supports the described banner, rigid-sign,
thickness-selected substrate, and multi-consumable patterns when they can be
expressed as Recipe components and/or existing PBV2 compatibility rules.  A
static inventory-only Product may use `no_route` and a Recipe as appropriate;
it is not forced through production.  There is no single-primary-material
replacement algorithm, no winner selection for multiple replacements, and no
fallback when a mock replacement condition has no match.

## Pricing diagnostic matrix

| Diagnostic fact | Current status | Mapping |
| --- | --- | --- |
| Dimensions, quantity, selected options | Already accepted by canonical Draft preview | Inputs to server preview; display submitted/resolved values. |
| Formula identity/expression and Product inputs | Already returned by Draft Formula read | Show shared expression read-only and ProductVersion inputs separately. |
| Area, unit/line total, minimum flag, tier, breakdown, warnings | Already returned by `ProductDraftPricingPreview` | Render directly. |
| Matrix dimensions/rows/rates | Already returned by Draft Matrix read | Render selected row/key from an additive server projection, not client inference. |
| Nesting estimate, computed sheets, billable area, selected sheet/size tier, exact matrix cell/rate, option impacts | Internally available during `resolveActivePbv2PricingInput` / pricing adapter; not all exposed by preview DTO | **Non-blocking additive diagnostic projection**. Add server-returned evidence before promising the full reference rail. |
| Raw formula runtime internals or mutable Formula Library configuration | Not appropriate as client authority | Do not expose as editable state. |

## Backend capabilities the reference omits

- Immutable ProductVersion history, Draft concurrency revisions, idempotent
  request identity, audit attribution, and publish replay behavior.
- Formula source states: embedded editable, library Product-input editable,
  library reference read-only, and unsupported legacy.
- Matrix rows with N persisted dimensions, and read-only computed-sheet tiers.
- Product workflow intent, proof/production flags, storefront visibility, and
  the full production-unit page/layer schema.
- Route-template revision/fingerprint snapshotting and the rule that Routing
  owns template authoring.
- Product Recipe legacy-PBV2 compatibility replacement semantics.

## Save orchestration contract

The reference's single Save Changes affordance may coordinate section APIs but
must not replace them with a giant Product JSON write.  It should:

1. retain a baseline revision per section;
2. validate local shape only, then save sections in dependency order: General,
   Options, Formula/Pricing/Matrix/Option impacts, Recipe, Production (inside
   General), Routing;
3. use a new durable request ID for each canonical mutation and the latest
   returned Draft revision for the next mutation;
4. stop and surface partial success on first failure; reload authoritative
   Draft state rather than pretending rollback;
5. on `STALE_STATE`, retain unsaved local edits for resolution and require a
   user refresh/review; and
6. gate Publish on the canonical review/read results and server response.

## Required backend work before convergence

### Blocking

None for convergence of the existing Draft authoring flow.

### Non-blocking

- Add a server-owned pricing diagnostic projection if the approved right rail
  requires computed sheets, nesting, selected matrix cell/rate, and complete
  option-impact evidence.
- Decide separately whether V2 needs Product identity creation (not merely
  Draft creation from an existing Product) in the Product Builder.

### Future / separate domains

- Product shipping policy and fallback shipping weight, if required, need a
  Shipping/Fulfillment-owned design.
- A true primary-material/replacement model requires an explicit Recipe and
  Materials architecture decision; do not infer it from the legacy pointer.

## UI convergence plan

Use the reference layout, sectioning, right rail, review presentation, and
responsive composition.  Bind each section to the canonical Draft read/mutate
contracts above.  Replace every mock calculator/resolver with server data;
keep Material, Inventory, Routing, and Formula Library boundaries visible in
the UI.  At narrow widths the production shell must collapse its sidebar so
the Builder's main form and diagnostic rail remain reachable.

## Evidence inspected

- `reference/lovable-ui/src/routes/_shell.product-builder.tsx` and
  `components/app/product-editor/*`
- `v2/ui/src/ProductWorkspace.tsx`, `v2/ui/src/api.ts`, and
  `v2/ui/src/productProductionUnits.ts`
- `v2/src/interfaces/http/productRoutes.ts`
- `v2/src/modules/products/{productVersionLifecycle,productFormulaInputs,productRecipes,productRouting}.ts`
- `v2/src/modules/materials/materialRequirementResolver.ts`
- `v2/src/modules/shared/productionRequirements.ts`
- `v2/infrastructure/products/postgresProductVersionLifecycle.ts` and
  `postgresProductWorkspaceReads.ts`
- V2 material-unit and weight migrations `0054`, `0055`, and `0115`.
