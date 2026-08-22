# Product Builder authoring completeness audit

**Audit date:** 2026-08-22
**Scope:** V2 Product Builder, ProductVersion Draft contracts, canonical publish
validation, and the V1-parity pricing spine at
`8abdf372fcfd748d3bebf51e4a41939bbc4afb11`.

This is a source and contract audit. It made no Product, ProductVersion, Quote,
Order, Invoice, Inventory, Recipe, Routing, Formula Library, or `MAIN` change.
The configured `TEST_DATABASE_URL` was not used.

## Decision

**ACTION REQUIRED.** The Builder is safe for the narrow, already-characterized
Draft configurations it exposes, but it cannot yet author several launch-relevant
canonical pricing states which the current V2 pricing spine supports. In
particular, a service fee cannot be configured, and advanced tiers/matrix
structure cannot be created or safely completed in the Builder. These are
authoring gaps, not pricing-engine regressions.

Classification used below:

| Code | Meaning |
| --- | --- |
| A | Fully authorable: read, stage, save, reload, review, and publish are canonical. |
| B | Readable but not authorable. |
| C | Partially authorable: a safe subset is editable, but supported states are not. |
| D | Backend capability not exposed by Builder. |
| E | Reference control with no canonical V2 contract. |
| F | Correctly owned by another domain. |
| G | Future/optional. |

## Capability matrix

| Capability | Canonical owner | Backend support | Builder authoring | Publish validation | Class / priority | Action |
| --- | --- | --- | --- | --- | --- | --- |
| Product name, description, category, measurement/workflow, proof/production policy | Draft `meta.general` | Yes | Read/edit/save/reload | General + tree validation | A | — |
| Simple per-piece or per-square-foot rate and minimum | `meta.pricingV2.base` | Yes | Read/edit/save/reload/preview | Base-price validation | A | — |
| Quantity **or** square-foot tiers | `meta.pricingV2` | Yes | One family read/edit/save | Tier validation | A | — |
| Dual quantity + square-foot tiers | `meta.pricingV2` / adapter tier families | Yes | Displayed as advanced/read-only; writer replaces one family with the other | Server can validate/publish | D / **P0** | Add a dual-family editor that preserves both families. |
| Computed-sheet tiers | Formula/nesting + `pricingV2` | Yes | Visible selector is rejected by the writer; existing states are read-only | Formula/matrix publish validation | D / **P0** | Add an explicit computed-sheet tier editor; retain server nesting authority. |
| Flat-fee/service fee | Fee profile + `formulaVariables.flatFee` | Yes, resolver fails missing value | Workflow can be selected; no Flat Fee Amount control or writer path | Missing value is rejected | D / **P0** | Expose a typed flat-fee Draft contract and review/publish finding. |
| Embedded Formula | `meta.pricingFormula` + Draft variables | Yes | Existing embedded expression and declared variables are editable | PBV2/formula validation | A | — |
| Formula Library reference with declared Product inputs | Formula Library + Draft input values | Yes | Inputs editable; expression intentionally reference-only | Formula reference/input validation | A | — |
| Formula Library reference without Product inputs | Formula Library | Yes | Read-only | Reference validation | B / P2 | Correct ownership; formula-library administration is outside Product Builder. |
| Legacy Product Formula adoption | Compatibility source → Draft embedded Formula | Yes | Exact server-owned expression is shown and may be adopted; then normal embedded editing | Publish blocks lost legacy Formula | A | — |
| Roll Formula | Formula evaluator + ProductVersion inputs | Yes | Can be displayed/edited only when already embedded or a library exposes the required inputs; no Formula picker/configuration flow | Formula validation | C / **P0** | Expose formula selection/input declaration workflow without duplicating Formula Library ownership. |
| Sheet inputs, allow rotation, Option-controlled rotation | ProductVersion Formula inputs + `pricingV2` | Yes | Read/edit/save/reload and server preview when Formula exposes sheet inputs | Rotation-option reference validation | A | — |
| Existing simple Matrix rates | PBV2 matrix | Yes | Existing non-Formula rates editable; N-D slices are viewable | Full reachable-combination validation | C / **P0** | Safe rate maintenance is present, but structural authoring is absent. |
| Matrix creation/dimensions/rows/cells | PBV2 matrix | Yes | No Builder controls to create matrix, choose dimensions, or add all rows | Fails incomplete reachable combinations | D / **P0** | Add a guided structural matrix authoring flow. |
| N-dimensional Matrix | PBV2 matrix | Yes | Sliced 2-D rate view only; no dimension/row construction | Full reachable-combination validation | C / **P0** | Extend the guided matrix flow to N dimensions. |
| Formula + Matrix / computed-sheet Matrix rows | PBV2 matrix + Formula | Yes | Read-only by intentional lifecycle contract | Server validates and prices/fails closed | B / **P0** | Deliberate advanced-authoring milestone; never permit destructive generic edits. |
| Basic Option Groups, choices, stable values, defaults | PBV2 option tree | Yes | Read/edit/save/reload; new temporary IDs are remapped safely | Option/default/reference validation | A | — |
| Boolean/number/text/textarea Option defaults | PBV2 option tree | Yes | Backend accepts them; Builder only edits choice-based defaults | Default validation | D / P1 | Add typed default inputs inside the current Option editor. |
| Option visibility/dependency rules | PBV2 option tree | Yes | Projected read-only as rule cards | PBV2 reference validation | D / P1 | Add a canonical rule editor, not a second rule format. |
| Basic fixed/per-item/per-square-foot/base-percent/multiplier impacts | PBV2 option impacts | Yes | Read/edit/save/reload for one supported impact | Tree and pricing validation | A | — |
| V1-compatible Formula/subtotal-percent/linear/inch impacts, multiple impacts, advanced overrides | PBV2 option impacts + adapter | Yes | Read-only or absent from impact selector/writer | Existing tree can publish; unsupported write is blocked | D / **P0** | Add typed advanced-impact editing in a dedicated milestone. |
| Recipe components, basis, unit, factor, option condition, multiples | Versioned Recipe | Yes | Read/edit/save/reload | Recipe condition/reference validation | A | — |
| Material normalization/stock | Material/Inventory | Yes | Preview only | N/A | F | Keep Material/Inventory-owned. |
| Production unit key and Option condition | Draft general `productionUnitSpecification` | Yes | Read/edit/save/reload | Condition validation | A | — |
| Production unit side/page/layer/order | Draft general `productionUnitSpecification` | Yes | Backend supports; Builder omits fields | Condition validation | C / P1 | Extend the existing production-unit editor. |
| Route policy and template selection | Versioned Routing specification | Yes | Read/edit/save/reload; template steps/revision previewed | Template/reference validation | A | — |
| Routing template topology/steps | Routing | Yes | Preview only | Routing-owned validation | F | Keep template authoring in Routing. |
| Taxable / tax category | Product identity classification → Billing/Tax | Existing `products.isTaxable`; not exposed by Draft | Disabled hard-coded false reference control | Quote/Order snapshot already consumes it | D / P1 | Expose the existing Product identity fact; retain Billing/Tax calculation ownership. |
| Allow $0.00 lines | Product commercial policy | Existing `products.allowZeroPrice`; not exposed by Draft | Disabled reference control | Sales/Billing validation consumes it | D / P1 | Expose the existing Product identity policy or a dedicated catalog policy UI. |
| Units preference | Org/user display or default-input policy | Dimension units normalize in pricing; no Product preference | Disabled context | N/A | F / P3 | Do not add ProductVersion state without a demonstrated commercial owner. |
| Product Type | Product identity / routing policy | Read projection only | Read-only | N/A | B / P1 | Add a Product identity mutation only if Product Type administration is required; it is not pricing math. |
| Shop/Common name | Product identity/catalog terminology | Existing `products.shopName`; not exposed by Draft | Disabled reference control | N/A | D / P1 | Add it to the Product-identity editing contract. |
| Primary material, shipping, weight/fallback/trim display | Recipe/Material/Shipping | Partial reads only | Read-only placeholders | N/A | F / P2 | Keep consumption in Recipe, physical facts in Material/Shipping; do not invent Product fields. |
| AI parsing hints/templates | Intake/catalog matching | No V2 contract | Disabled | N/A | G / P3 | Separate intake-matching capability. |

## Pricing and Formula findings

The Builder correctly stages simple base price/minimum and one conventional
tier family. `ProductBuilderReference.runSave` serializes these through the
revision-aware Draft lifecycle and updates its revision after every mutation.
The preview is server-calculated; React only stages inputs.

The pricing engine deliberately marks Formula, Matrix, dual-tier, and
computed-sheet states as advanced/read-only in
`postgresProductVersionLifecycle.pricingFromTree`. That protects existing
commercial configurations from lossy generic writes, but means the new-product
workflow cannot create every valid canonical family. A new Product can safely
be built for simple per-square-foot, per-piece/quantity-only, and an already
available embedded/input-bearing Formula. It cannot fully build Matrix,
service-fee, dual-tier, computed-sheet-tier, or Formula-selection/roll
configurations from scratch.

Formula handling is otherwise sound: library expressions are intentionally
read-only, declared ProductVersion inputs remain editable, embedded expressions
are editable, and legacy-only formulas can be server-adopted without accepting
a client-supplied expression. The publication guard prevents a Draft from
discarding a required active legacy Product Formula.

## Matrix and Option findings

The canonical engine and publish validator require a complete executable row
for each reachable Matrix selection and fail closed on an unmatched row. The
Builder can show a 2-D projection of an N-dimensional Matrix and slice extra
dimensions, but it cannot define dimensions, generate missing rows, or alter
matrix structure. Formula+Matrix and computed-sheet Matrix tiers are
intentionally read-only. Therefore the UI cannot accidentally publish an
incomplete Matrix, but it also cannot create one safely.

Options are substantially complete for routine authoring: stable values,
defaults, type/value preservation, and deletion protection for Matrix and
dependent references all use the Draft transaction. The impact editor covers
the routine five forms only. The restored adapter additionally supports the
evidenced V1 Formula/subtotal/linear/inch forms, but the Builder neither
models nor writes them. This is a genuine authoring exposure gap, not a reason
to add a second evaluator.

The Builder has one safe-but-incomplete dependency workflow: a newly added
Option receives a persisted ID on its Options save, but staged Formula rotation,
Recipe, or other dependent references still hold the temporary `new:` ID.
The later request fails safely. Saving/reloading before adding the dependency
works today; orchestration must either remap returned IDs or require that
explicit boundary.

## Recipe, Production, and Routing

Recipe is fully authorable for existing Materials: multiple components,
`per_line`/`per_piece`/`per_area`, factor and unit, option/choice conditions,
and compatibility replacement all save through the versioned Recipe contract.
Automatic inventory normalization remains Material-owned.

Production units are fully authorable for arbitrary keys and option conditions,
but the current Builder does not expose the backend-supported side, page,
layer key, or layer order fields. This is C/P1 for richer production specs.
Routing policy/template selection is fully authorable; ordered template steps
and revisions are correctly preview-only because Routing owns template
authoring. Publish-time revalidation of separate Recipe/Routing/Production
references should be added as P1 defense-in-depth: the Draft write paths
validate them today, while the central publish validation is primarily PBV2,
base-price, material, and Formula focused.

## Tax and commercial metadata

V1 stored Product-level taxability. V2 already retains that Product identity
fact as `products.isTaxable`, and Quote/Order flows consume and snapshot it,
but the Draft contract omits it and the Builder shows a disabled hard-coded
false control. A boolean is sufficient for V1 classification parity; a tax
category/code is the better future model. Product identity should classify the
line; Billing/Tax must determine jurisdiction, exemption, rate, taxable base,
and tax amount. The resolved classification should continue freezing in the
Quote/Order commercial snapshot. This is a **P1 product-identity exposure
gap**, not a Product Builder tax-calculation feature. No schema migration is
needed to expose the existing boolean; a future `taxCategory/taxCode` model
needs its own explicit contract/migration.

`products.allowZeroPrice` already carries V1-style “Allow $0.00 lines.” It is
not a PricingResult input; it is a Product commercial policy read by Sales/
Billing validation. The Builder's disabled control is therefore a P1 exposure
gap, not a request to put the policy into pricing math. Snapshot semantics for
historical commercial documents should be made explicit when the identity
writer is exposed.

Units are not a missing pricing fact: the canonical resolver receives explicit
line dimensions and normalizes them. Product Type is currently a read-only
catalog/routing context and has no demonstrated pricing role. Shop/Common name,
shipping, weights, fallback weight, and generic trim controls have no V2
ProductVersion owner; Recipe Formula inputs remain the correct owner for
pricing-relevant allowance/increment behavior.

## Save, Review, and publish integrity

Global **Save Changes** stages local state by section and writes serially:
general → options → formula → pricing → matrix → impacts → recipe → routing.
Each request includes the latest Draft revision and a new durable request ID;
the returned revision is propagated to the following request. On a stale or
partial failure the UI retains local edits, names completed sections, and
requires a refresh/reconciliation before another safe save. Successful saves
refetch every canonical Draft projection. This ordering correctly lets a new
Option exist before a Formula rotation-control reference is validated.

The limitation is atomicity: global Save is deliberately a sequence of
canonical section transactions, not one cross-domain transaction. A later
failure can leave earlier valid sections saved. That is safe and visible, but
P1 operational UX: Review should make the completed/unsaved distinction
unmissable before publish.

There is one P0 interaction: **Publish** is currently enabled for a persisted
Draft even when local sections are dirty, and invokes the canonical publisher
without calling `runSave`. It can therefore promote the older persisted Draft
and omit visible local edits. Preview is likewise server-authoritative but
uses only the persisted Draft; it does not mark a result stale after local
pricing/formula/options edits. Publish must be disabled or require a successful
save/reconciliation, and Preview must disclose persisted-versus-staged state.

Publish remains server-authoritative. It validates the PBV2 tree, base/Formula
requirements, default choices, reachable Matrix combinations, option/condition
references, rotation-control references, Recipe/Production/Routing references,
and stale lifecycle revisions. The client Review is an explanatory projection,
not the publishing authority.

## Prioritized next work

| Priority | Gap | Smallest correct milestone |
| --- | --- | --- |
| P0 | Publish can omit visible unsaved configuration. | Disable/guard publish until all dirty sections are saved or explicitly reconciled. |
| P0 | Flat Fee Amount cannot be authored for `service_fee`. | Typed ProductVersion fee pricing read/write/review control; server preview and publish finding remain authoritative. |
| P0 | Matrix structural authoring, N-D completion, row tiers, and computed-sheet rows absent. | Guided dimensions/row/tier authoring with server completeness validation; preserve intentionally read-only Formula states. |
| P0 | Dual and computed-sheet tiers are supported but cannot be authored. | Dedicated advanced-tier editor that preserves both tier families and server nesting semantics. |
| P0 | Advanced V1-compatible option impacts are engine-only. | Typed impact model/editor for Formula, subtotal percentage, linear/inch, multiple impacts, and supported overrides. |
| P0 | Formula source selection/roll configuration cannot be built from a blank Product. | Formula provenance picker plus declared Product input configuration, owned by Pricing/Formula Library. |
| P1 | Product tax classification absent. | Decide ProductVersion taxonomy and Quote/Order snapshot consumption with Billing/Tax. |
| P2 | Shop/Common name and allow-zero policy unresolved. | Establish owner/semantics before adding controls. |
| P2 | Primary material/shipping/weight presentation incomplete. | Add only real cross-domain projections; keep writes with their owning domains. |
| P3 | Units preference and AI hints. | Defer until a proven owner/use case exists. |

## Evidence and validation

Primary evidence: `v2/ui/src/ProductBuilderReference.tsx`,
`v2/ui/src/productBuilder/{basics,pricing-engine,matrix-pricing,optionGroups,recipe,production-routing}.tsx`,
`v2/src/modules/products/productVersionLifecycle.ts`,
`v2/infrastructure/products/postgresProductVersionLifecycle.ts`,
`shared/pbv2/validator/validatePublish.ts`, and the canonical pricing
contracts/adapter. The audit used source inspection and existing focused
contracts only; it did not create a Product or invoke a persistent test
database.
