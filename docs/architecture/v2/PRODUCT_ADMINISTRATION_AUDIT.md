# Product Administration audit and V2 implementation blueprint

**Status:** audit complete; no Product behavior, schema, data, deployment, or `main` branch changes were made.
**Scope:** repository evidence as of 2026-08-18.

## Evidence reviewed

The routed V1 staff surfaces are `client/src/App.tsx`, `client/src/pages/products.tsx`,
`client/src/pages/ProductEditorPage.tsx`, and `client/src/pages/product-builder-v2.tsx`.
Their supporting editors are `client/src/components/ProductForm.tsx`,
`client/src/components/PBV2ProductBuilderSectionV2.tsx`, and
`client/src/components/pbv2/builder-v2/*`.

The V1 transport and guarded operations are in `server/routes/products.routes.ts`,
`server/services/products/canonicalProductConfigurationOperations.ts`,
`canonicalProductPricingOperations.ts`, `canonicalPbv2OptionConfigurationOperations.ts`,
`canonicalProductMaterialOperations.ts`, `canonicalProductLifecycleOperations.ts`, and
`canonicalProductPublishOperations.ts`.

The present V2 Product reader is `v2/ui/src/ProductWorkspace.tsx`,
`v2/src/interfaces/http/productRoutes.ts`,
`v2/infrastructure/products/postgresProductWorkspaceReads.ts`, and
`v2/infrastructure/compatibility/postgresProductsRead.ts`. The relevant V2 domain DTOs
are in `v2/src/modules/products/contracts.ts` and
`v2/src/modules/products/pbv2CompatibilityResolution.ts`.

The checked-in Lovable source has a useful **mock** catalog and read view in
`reference/lovable-ui/src/routes/_shell.products.tsx` and
`reference/lovable-ui/src/routes/_shell.products.$id.tsx`. Its
`_shell.product-builder.tsx` is a mock guided builder, not an approved production
editing contract; it must not dictate V2 behavior.

## 1. V1 Product Administration inventory

### Real routed administrator workflow

| Area | What an administrator can actually do today | Current representation |
| --- | --- | --- |
| Catalog | List all tenant Products; browser-filter name/category; add, edit, duplicate, delete; legacy CSV import/export | `ProductsPage`, `/api/products` |
| Identity and availability | Edit name, shop name, description, category, Product Type, service flag, measurement mode, workflow intent, active state, production/proof/tax/zero-price flags | Product columns and `ProductForm` |
| Pricing | Choose profile, formula library, or manual formula; set profile configuration, flat fee, sheet dimensions, rotation, minimums, base pricing, quantity/square-foot tiers, matrix rows/tier basis, option impacts, and preview a draft | Product fields plus PBV2 tree metadata |
| PBV2 options | Add/remove/reorder groups, inputs, choices and choice order; set required/default/enabled state; edit select, multiselect, boolean, number, text, textarea, and dimension inputs; configure simple visibility, option rules, and pricing matrices; import/export JSON; reuse option-group templates | `pbv2_tree_versions.tree_json` |
| Materials | Assign one primary Material; choose material on some legacy option/thickness definitions; show Product-linked Material IDs in the legacy list reader | `products.primary_material_id`, legacy options, `material_product_links` |
| Production/artwork | Select Product Type; choose workflow intent; set proof/production requirements, artwork policy, product images, trim allowance, shipping/weight metadata, and product design configuration through a separate API | mixed Product fields/tree metadata/`product_design_configs` |
| Lifecycle | Save a DRAFT, validate, publish with warning confirmation, activate/deactivate, duplicate a Product or its PBV2 tree | `pbv2_tree_versions` and Product active pointer |
| Portability | Legacy CSV import/export and PBV2-aware owner-only JSON import/export, including tenant Material/Product Type/formula remapping | Product import/export routes |

### What is not a coherent Product-admin feature

* `product_variants`, `product_options`, `options_json`, legacy price breaks, and
  nested pricing-profile fields remain callable compatibility CRUD. They overlap with
  PBV2 but are not the active V2 commercial configuration model.
* A Product has only a **primary** Material mutation. Product-linked Materials,
  PBV2 material effects, and actual inventory consumption are separate concepts.
* Bundles are quote/order line-item relationships. PBV2 can emit child-item proposals,
  but there is no Product parent/child catalog model to carry forward.
* Actual nesting, run layout, station scheduling, stock movement, reservation, and
  fulfillment execution are not Product editor facts.

## 2. V2/PBV2 capability map

Classifications describe the V2 application boundary, not whether an old V1 route can
write a column.

| Area | V1 behavior | V2/PBV2 state | Recommendation |
| --- | --- | --- | --- |
| Active sellable Product and PBV2 configuration | Reads active Product, active tree, measurement, Product Type and pricing identity | **FULLY_SUPPORTED** for current sellability/quote-order compatibility reads; historical arbitrary-tree read returns `null` | Retain as the Sales read boundary. |
| V2 catalog/detail UI | V1 is broad editable catalog; Lovable mock has Product/category/pricing/route/SKU/basis/material-count/status | **READ_ONLY** and incomplete: active-only, active-PBV2-only, `LIMIT 100`; UI does not pass its supported `q`; exposes IDs/hash and omits status/counts | Reconstruct bounded list/detail read model first. |
| Identity/configuration | V1 edits name, description, category, Type, measurement/workflow/proof/production settings | **PARTIALLY_SUPPORTED**: guarded canonical operation exists, but no V2 HTTP mutation/read DTO or V2 UI | Add a scoped V2 writer only after P1 reads. |
| Lifecycle | V1 active/inactive and publish/activate | **PARTIALLY_SUPPORTED**: canonical lifecycle and publish operations have tenant, actor, stale, and validation guards; no V2 UI/transport | Expose only draft, publish, activate, deactivate actions with revisions. |
| PBV2 options/choices | V1 full tree editor plus template/JSON utilities | **PARTIALLY_SUPPORTED**: canonical DRAFT option mutation supports groups/inputs/choices/defaults/order/simple visibility; no V2 editor contract | Start with structured DRAFT mutations; retain unsupported complex paths out of first editor. |
| Scalar/matrix/tier pricing | V1 editor and preview support profiles, formulas, base, tiers, matrices and impacts | **PARTIALLY_SUPPORTED**: shared pricing operations and validators exist; V2 resolver deliberately rejects unproven combinations/impacts | Build one editor over the shared operations; do not create a second calculator. |
| Formula library/profile rotation | V1 can select/update Product pricing metadata and preview formulas | **PARTIALLY_SUPPORTED** in guarded V1 operations; **MISSING_MUTATION_CONTRACT** in V2 | Treat formula library as Pricing-owned, and keep profile migration explicit. |
| Primary Material | V1 can assign/change/clear one active tenant Material | **PARTIALLY_SUPPORTED**: guarded canonical mutation exists; no V2 UI/transport | Include a primary-material section, not a recipe editor. |
| Multi-material recipe/BOM | Legacy option data and PBV2 effects may imply consumption | **MISSING_DOMAIN_MODEL** | Define versioned Recipe/BOM separately before presenting a Materials tab as editable. |
| Product Type / route policy | V1 selects Type; current V2 resolves current route policy from Type | **PARTIALLY_SUPPORTED** | Product Admin selects Type/policy; Routing owns template topology/stations. |
| Proof/prepress/design policy | V1 Product fields/design config influence new line requirements | **PARTIALLY_SUPPORTED** and split across Product/design-config routes | Specify a small product workflow-policy projection before surfacing all controls. |
| Actual production/nesting | V1 editor contains sheet/roll metadata and preview math | **SHOULD_MOVE_TO_ANOTHER_DOMAIN** | Product may provide inputs/defaults; Nesting/Planning owns job-specific result. |
| Inventory stock/reservations/consumption | V1 has Material/option and downstream inventory paths | **SHOULD_MOVE_TO_ANOTHER_DOMAIN** | Inventory owns stock and movements; Recipe/BOM defines requirements. |
| Parent/child Products | V1 has line-item bundles and PBV2 child-item proposals, not product hierarchy | **LEGACY_ONLY / UNKNOWN_REQUIRES_DECISION** | Do not add a Product hierarchy; decide Product composition vs Sales bundles later. |
| Legacy variants/options/CSV | Traditional variants/options and CSV CRUD remain reachable | **DEPRECATED** for new Product configuration; export/import remains a controlled compatibility tool | Do not put them into the new editor. |
| Advanced PBV2 override | Admin-only override stores an archived replacement tree | **DEPRECATED** temporary/bypass control | Keep out of normal Product Admin and plan retirement after parity evidence. |

## 3. V1 capabilities that must not be copied

* The generic modal Product editor and the disconnected full-screen PBV2 builder.
* Two competing option stores (`options_json`/`product_options` and PBV2) or two
  competing price inputs for the same rule.
* Direct active-tree editing, generic JSON import, and temporary override controls in
  the routine workflow.
* Legacy `product_variants` as a new configuration authority.
* Product-level claims of actual sheet utilization, material stock, route progress, or
  production completion.
* Delete beside everyday Save. Deactivation plus retained versions is the ordinary
  lifecycle; destructive deletion needs its own later retention analysis.
* Browser-wide, unbounded client filtering. The current V1 all-products reader is not
  a V2 catalog contract.

## 4. Proposed V2 Product Administration structure

Use the existing Lovable visual language: compact full-width header, inline metadata,
tabs, dense tables, restrained panels, status pills, and no architectural helper copy.

1. **Products** — server-searchable catalog, status chips, and truthful columns:
   Product, Category, pricing summary, Product Type/route policy, SKU only when a
   real SKU projection exists, measurement basis, material count only after a real
   read projection, and lifecycle state. The approved mock list is a layout reference,
   not permission to invent fields.
2. **Product overview** — identity, lifecycle, Type/policy, measurement/workflow
   policy, primary Material, and a concise active/draft version summary.
3. **Pricing** — one current-DRAFT configuration surface: basis/base/minimum, tiers,
   matrix, formula selection, and a preview explicitly marked as draft preview.
4. **Options** — groups, inputs, choices, defaults, and supported conditional rules.
5. **Materials** — primary Material at first. A future Recipe/BOM is a separate
   versioned feature, not a table filled from stock records.
6. **Production** — Product Type and durable policy defaults only; links to Routing
   settings for reusable templates and to the appropriate design-policy surface.
7. **Versions** — active version, editable draft, validation findings, publish action,
   deprecation history, and clone/duplicate. Do not make historical Sales snapshots
   browseable/editable Product definitions.

The smallest safe first delivery is **P1: Products list plus read-only Product overview**.
It proves the visual system and bounded reads before adding any writer.

## 5. Product versioning lifecycle

1. Create/clone starts an inactive Product with a PBV2 `DRAFT`; no active pointer is
   assigned for a draft-only configurable Product.
2. All option/pricing structure changes target a tenant-scoped DRAFT. An existing
   ACTIVE tree can be copied into a new DRAFT; it is never edited in place.
3. Save validates draft structure and sanitizes stale pricing-matrix references.
   Save may retain an incomplete matrix while it is being authored; publish may not.
4. Publish validates schema v2, base pricing, option/rule/matrix integrity, referenced
   Materials, and the Formula Library reference. Warnings require explicit confirmation.
5. The exact **DRAFT -> ACTIVE** transition is one transaction: previous ACTIVE becomes
   `DEPRECATED`, the selected DRAFT becomes `ACTIVE`, the Product active-tree pointer
   changes, and optional activation occurs only after publish succeeds.
6. Deactivate removes a Product from normal new-sale selection without deleting its
   configuration. `DEPRECATED`/`ARCHIVED` versions remain retained.
7. Quotes and Orders retain their resolved configuration/pricing checkpoints. Product
   publication cannot silently reprice a historical quote, order, or invoice.

The current canonical publish operation already enforces the important stale revisions
and tenant/product association. The future V2 writer must preserve those predicates,
not reimplement a looser update.

## 6. Pricing architecture

The editor should edit one PBV2 pricing definition, using integer cents and the shared
pricing operations:

* **Base:** per-piece, per-square-foot, or flat-fee, plus optional minimum charge.
* **Tiers:** one explicit tier family with strictly ordered thresholds. Matrix-row tiers
  override product-level tiers only through the established evaluator.
* **Matrix:** one or two option axes; every required combination appears exactly once.
* **Formula:** Formula Library is Pricing-owned. Store the selected formula identity and
  validated configuration; do not copy formula text into unrelated controls.
* **Options:** fixed, per-unit, per-area, multiplier, and supported percentage impacts
  are configuration inputs. Sales only receives the calculated result and separately
  records an authorized selling-price decision.

The Product editor validates/persists configuration. The existing pricing evaluator
owns formula precedence, rounding, minimum charge, matrix/tier selection, and output.
No UI should compute a sale total as a second authority.

## 7. Materials and Production ownership

| Product Administration | Other owner |
| --- | --- |
| Product primary Material and a future versioned recipe reference | Inventory: stock, receipts, adjustments, lots, reservations, and actual consumption |
| Measurement mode, fixed dimensions, pricing/nesting inputs | Nesting/Planning: job-specific layout, rotation decision, yield, and run composition |
| Product Type and durable workflow requirements | Routing: templates, stations, topology, route instances/transitions |
| Artwork/proof policy defaults | Artwork/Prepress/Design: files, review, proof execution |
| Product configuration version/publish state | Sales: resolved quote/order configuration and frozen pricing/selling decision |

## 8. Missing contracts

### Read gaps

* V2 catalog lacks total count, inactive/draft/version status, Category, Type display,
  route presentation, SKU, formula/pricing summary, primary Material, recipe count,
  and version history.
* V2 has no Product workflow/design-policy read and no true Recipe/BOM projection.
* `resolveHistoricalPricingConfiguration` is intentionally unimplemented in the V2
  compatibility reader; historical reads must come from a Sales checkpoint.

### Mutation gaps

* No V2 Product create, patch, draft create/save, publish, activate/deactivate, clone,
  primary-Material, pricing, or option mutation HTTP contracts/UI.
* No V2 Formula Library or Product Type selection projection/mutation boundary for this
  workspace.
* No V2 optimistic revision/error DTO for concurrent Product Admin edits.

### Domain gaps

* Versioned multi-material Recipe/BOM and material requirement semantics.
* Clear ownership/lifecycle for Product design configuration and shipping/weight data.
* A decision on PBV2 child-item proposals versus Sales bundles/Product composition.
* A proven historical pricing-configuration reference only through Sales checkpoints.

### Schema/migration gaps

No schema change is justified by P1. Recipe/BOM, independent formula-version policy,
and any first-class Product workflow-policy projection require a separate approved model
and migration plan; do not add columns to imitate legacy JSON.

## 9. Risk register and safeguards

| Risk | Safeguard |
| --- | --- |
| Price drift/rounding change | Reuse Pricing evaluator; add golden, matrix/tier, minimum, fee, rotation, and override parity fixtures before writers. |
| Historical commercial mutation | Never resolve a current Product tree for a historical line; retain Sales checkpoints and immutable version references. |
| Invalid publication | Enforce schema/base/matrix/options/material/formula validation and explicit warning confirmation. |
| Concurrent administrator updates | Require Product/tree revisions on every mutation; return stale conflict and reload current draft. |
| Route mismatch | Product selects Type/policy only; validate required Type before publishing and leave route topology to Routing. |
| Inventory/recipe corruption | Ship only primary Material initially; do not infer consumption from price options. |
| Quantity-only priced as area | Keep measurement-mode validation and service-fee normalization; include explicit fixture cases. |
| Empty or malformed matrix | Permit incomplete authoring only in DRAFT; block publish on missing/duplicate/unknown rows and empty invalid tiers. |
| Unsafe compatibility controls | Exclude delete, raw JSON import, legacy override, and old options/variants from routine admin UI. |

## 10. Recommended implementation milestones

| Milestone | Scope | Main risk | Required validation |
| --- | --- | --- | --- |
| P1 | Lovable-style Products list and read-only overview over a bounded V2 Product read DTO | Misstating active/draft status or exposing raw IDs | tenant/read tests, pagination/search tests, visual comparison, responsive checks |
| P2 | V2 draft/version lifecycle read plus clone/create inactive draft | Orphan draft or activation bypass | lifecycle/publish/stale/tenant tests |
| P3 | General identity, measurement, Product Type, workflow and primary-Material mutation | Current Product changes leaking into historical commerce | canonical-operation contract tests and Sales checkpoint regression |
| P4 | Pricing editor for one DRAFT definition and preview | cents/precedence drift | golden pricing, tiers/matrix/formula/fee/quantity-only tests |
| P5 | Options/choices/defaults/visibility mutation | invalid selections or incompatible config changes | PBV2 validator and order-entry resolution tests |
| P6 | Product policy/read consolidation; approved design/artwork policy scope | placing operational state in Products | route/proof/prepress ownership tests |
| P7 | Versioned Recipe/BOM and its Inventory/Nesting integration | double consumption/stock corruption | separate migration, inventory, nesting, and production contract tests |

## 11. Recommended next Codex task

**P1 — reconstruct the Products List and read-only Product Overview against the
checked-in Lovable Products list/detail composition, backed by a new bounded V2 Product
read projection.** Include server-side search and truthful active/inactive/draft status;
do not add any Product mutation, schema migration, recipe editor, or publish action.

## Audit validation

Passed locally with `NODE_OPTIONS=--max-old-space-size=8192`:

* `v2/tests/interfaces/productRoutes.test.ts`
* `v2/tests/infrastructure/productWorkspaceReads.test.ts`
* `shared/tests/productMeasurementMode.test.ts`
* `shared/tests/productDraftIntent.test.ts`
* `shared/pbv2/tests/validator/validatePublish.test.ts`
* `shared/pbv2/tests/validator/validatePublish.optionRulesPricingMatrix.test.ts`

That run passed 69 assertions. The two focused DB-backed suites,
`PricingService.snapshotPersistence.test.ts` and `PricingService.goldenRegression.test.ts`,
did not start because this audit environment intentionally has no `DATABASE_URL`; no
conclusion about those suites is claimed.
