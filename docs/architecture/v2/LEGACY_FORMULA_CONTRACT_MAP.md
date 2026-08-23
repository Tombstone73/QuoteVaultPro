# Legacy Formula contract map

Date: 2026-08-23  
Scope: Titan Graphics Formula-freeze inventory, source contracts, and freeze
planning only. This document authorizes no Formula, ProductVersion, Product,
or Draft mutation.

## Decision summary

The read-only inventory found 161 Formula-backed ProductVersions: 25 ACTIVE,
14 DRAFT, and 122 DEPRECATED. None is bound to a FormulaRevision yet.

The formula-domain model correctly supports an initial append-only binding for
an otherwise unbound ACTIVE or DEPRECATED ProductVersion. That binding freezes
the already-effective Formula without rewriting `pbv2_tree_versions.tree_json`.
However, the application has no canonical, audited historical-freeze command;
the only current write path is Draft-only. Do not use raw SQL. A small
Formula-binding freeze operation is required before any ACTIVE/DEPRECATED
backfill.

| Class | Family / expression | Count (A/D/H) | Decision |
| --- | --- | ---: | --- |
| A | `ceil((((w + .25) * (h + .25)) * q) / 144) * p` | 9 / 3 / 37 | Reusable final-dollar Formula; empty ProductVersion input contract. |
| A | `total_sqft * p` | 2 / 1 / 5 | Separate reusable final-dollar Formula; empty ProductVersion input contract. |
| A, gated | Parametric `sheet_consumption_sqft(...) * base_price` | 8 / 6 / 71 | Reusable library Formula once every binding's five typed input values are proven. |
| B | Padded contour expression using `base_price` | 1 / 0 / 1 | Product-scoped initially; do not infer AST equivalence to the sticker Formula. |
| B | Posters `((ceil(...)*p)+1)+1` | 0 / 1 / 0 | Product-scoped; retain its exact $2 post-calculation adjustment. |
| C | `flatFee` | 2 / 2 / 2 | Canonicalize to `service_fee` plus Flat Fee Amount, not a FormulaRevision. |
| C | `q * unitPrice` | 1 / 0 / 3 | Quantity-only pricing; Formula is ignored by the canonical resolver. |
| C | `ceil((((w+.25)*(h+.25))/144)*q)` | 1 / 1 / 1 | Geometry-only stale metadata on a quantity-only Product; not a final-dollar Formula. |
| D | Magnetic `sheet_consumption_sqft(w,h,q,24,96,12,12,2)` | 1 / 0 / 2 | Its legacy output means *billable area*, while FormulaRevision evaluation means final dollars. Do not bind unchanged. |

`A/D/H` means ACTIVE / DRAFT / DEPRECATED. There are no inventory rows with
an existing FormulaRevision binding and no planner-detected provenance conflict.
The six non-Formula Drafts are excluded from Formula freeze work.

## Ownership rules

The canonical runtime scope owns `w`, `h`, `q`, `total_sqft`, `p`,
`base_price`, and `unitPrice`. They are derived from the pricing request,
ProductVersion base/tier/matrix state, and selection resolution; they must not
be declared ProductVersion Formula inputs.

Likewise, rotation belongs to `tree.meta.pricingV2.allowRotation` and its
optional `rotationControl`. Legacy `allow_rotation=0|1` values are a
compatibility bridge only. They must not be copied into FormulaRevision input
declarations or binding values.

Formula output is final dollars unless an explicit output-basis contract says
otherwise. The current FormulaRevision evaluator converts the expression's
final-dollar result to cents. That is why the Magnetic billable-area Formula is
not currently representable unchanged.

## Formula contracts

### 1. Padded aggregate-area Formula — reusable

Expression:

```text
ceil((((w + .25) * (h + .25)) * q) / 144) * p
```

This computes an aggregate padded area, rounds that aggregate area up once,
then applies the resolved per-square-foot base rate. Normal Formula minimum
handling follows Formula evaluation. It is not interchangeable with a
per-item ceil calculation.

Affected inventory includes Concept 204 Low Tac, Posters historical versions,
Reflective Vinyl, Stickers, Stickers - Clear Background, Stickers (Copy),
Substance 2755, and Window Perf. Its exact-string / final-dollar contract is a
candidate for one initially **product-scoped** identity; promotion to My
Formula Library is a commercial-governance decision after usage review.

| Input key | Type | Display label | Description | Required | Default | Min / max | Unit / semantic | Evidence | Confidence |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| — | — | — | No ProductVersion-owned inputs. | — | — | — | Runtime supplies `w`, `h`, `q`, `p`. | canonical formula scope; V1/V2 parity evaluator | High |

### 2. Total finished area Formula — reusable, separate

Expression:

```text
total_sqft * p
```

This is final dollars: canonical finished total area times the resolved base
rate. Matrix/tier/base-rate overrides resolve before `p`. It is a separate
Formula identity from the padded Formula because its expression and geometry
semantics differ.

Affected inventory: Banner and Window Cling.

| Input key | Type | Display label | Description | Required | Default | Min / max | Unit / semantic | Evidence | Confidence |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| — | — | — | No ProductVersion-owned inputs. | — | — | — | Runtime supplies `total_sqft`, `p`. | pricing-variable registry and compatibility parity test | High |

### 3. Parametric sheet-consumption Formula — reusable, gated

Expression:

```text
sheet_consumption_sqft(w,h,q,sheet_width,sheet_length,usable_drop_min,billable_length_increment,minimum_billable_sqft) * base_price
```

The helper returns billable sheet square feet; multiplication by `base_price`
makes the expression final dollars. `w`, `h`, `q`, and `base_price` are runtime
values. This identity is a candidate for **My Formula Library** only after
binding values are captured and validated for every ProductVersion.

Affected Products: ACM, Cardstock, Coroplast, Flatbed Basic, Foam Board,
OppBogga Recyclable Display Board, PVC, and Styrene. The legacy library pointer
is `fb47ea57-a9f9-452a-8fa1-57326ce4891c`; it is provenance evidence, not a
Formula-domain identity or revision.

| Input key | Type | Display label | Description | Required | Default | Minimum | Maximum | Unit / semantic | Evidence | Confidence |
| --- | --- | --- | --- | --- | --- | ---: | --- | --- | --- | --- |
| `sheet_width` | number | Sheet width | Production sheet width. | Yes | UNKNOWN | > 0 | UNKNOWN | inches | `calculateSheetYield` positive assertion | High |
| `sheet_length` | number | Sheet length | Production sheet length. | Yes | UNKNOWN | > 0 | UNKNOWN | inches | `calculateSheetYield` positive assertion | High |
| `usable_drop_min` | number | Usable drop minimum | Minimum leftover dimension considered reusable. | Yes | UNKNOWN | 0 | UNKNOWN | inches | helper clamps negative values to zero | High |
| `billable_length_increment` | number | Billing length increment | Increment used to round consumed sheet length. | Yes | UNKNOWN | > 0 | UNKNOWN | inches | helper uses positive increment; canonical contract must reject zero rather than silently normalize | High |
| `minimum_billable_sqft` | number | Minimum billable area | Minimum billable area for a partial sheet. | Yes | UNKNOWN | 0 | UNKNOWN | square feet | helper applies `max(measured, minimum)` | High |

No 4x8 values are Formula defaults. The inventory's observed values (including
Coroplast's `48/96/0/1/32`) are ProductVersion binding values. The current
inventory deliberately omitted legacy Formula Library config values, so it
cannot yet prove a complete five-value binding map. Legacy numeric rotation
values do not fill that gap.

### 4. Magnetic fixed-sheet Formula — ambiguous

Expression:

```text
sheet_consumption_sqft(w,h,q,24,96,12,12,2)
```

The V1 evidence marks its output as **billable area**; the base rate is applied
outside the expression. FormulaRevision currently treats expression output as
final dollars. Binding this literal text would therefore change price. It is a
product-scoped compatibility case, not a deduplication candidate.

| Input key | Type | Display label | Description | Required | Default | Min / max | Unit / semantic | Evidence | Confidence |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| — | — | — | Geometry is literal in the expression; no PV inputs. | — | — | — | Billable-area output, not final dollars. | V1 sheet-consumption tests / legacy Formula metadata | High |

Required decision: either add an explicit Formula output-basis model with
parity coverage, or adopt an approved final-dollar expression through a
separate Product-scoped migration. Do neither automatically.

### 5. Contour padded Formula — product-scoped

Expression:

```text
ceil(((w + 0.25) * (h + 0.25)) * q / 144) * base_price
```

This is final dollars and has no ProductVersion-owned inputs. `base_price` is a
runtime alias. Its source text is not the same as the standard sticker Formula;
there is no canonical AST-equivalence or rewrite contract, so keep it
product-scoped and preserve the exact expression.

| Input key | Type | Display label | Description | Required | Default | Min / max | Unit / semantic | Evidence | Confidence |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| — | — | — | No ProductVersion-owned inputs. | — | — | — | Runtime supplies dimensions, quantity, rate. | V2 pricing adapter | High |

### 6. Posters surcharge Formula — product-scoped

Expression:

```text
((ceil((((w + .25) * (h + .25)) * q) / 144) * p) + 1) + 1
```

This is the exact Posters Draft expression and means the standard padded
calculation plus $2 after rate application. It must remain distinct from
ordinary Posters historical versions and from the standard sticker identity.

| Input key | Type | Display label | Description | Required | Default | Min / max | Unit / semantic | Evidence | Confidence |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| — | — | — | No ProductVersion-owned inputs. | — | — | — | Runtime supplies dimensions, quantity, rate. | exact Draft expression | High |

### 7. Flat fee — canonical non-Formula pricing

Expression: `flatFee`

This is represented canonically by `workflowIntent=service_fee` and
`flatFeeCents`. The price is one charge per line; quantity and dimensions do not
multiply it. Do not create Formula identities, revisions, or bindings merely
to preserve this string.

| Input key | Type | Display label | Description | Required | Default | Minimum | Maximum | Unit / semantic | Evidence | Confidence |
| --- | --- | --- | --- | --- | --- | ---: | --- | --- | --- | --- |
| `flatFeeCents` | integer | Flat Fee Amount | ProductVersion service-fee amount. | Yes for `service_fee` | UNKNOWN | 0 | UNKNOWN | integer cents, one charge per line | canonical Draft pricing and parity tests | High |

Installation has observed legacy evidence of $74.99 and may be normalized only
after its workflow/profile is confirmed. RUSH and Shipping have no
authoritative amount; they remain human commercial decisions.

### 8. Quantity-only / geometry-only stale Formula expressions

Expressions:

```text
q * unitPrice
ceil((((w + 0.25) * (h + 0.25)) / 144) * q)
```

The first appears on quantity-only Products, for which the resolver already
uses canonical per-piece pricing and ignores stale Formula text. The second is
geometry only and lacks a rate, so it cannot be a final-dollar Formula. Both
should canonicalize to their existing non-Formula pricing owners, not to a
FormulaRevision. No Formula input declarations are appropriate.

### 9. Roll nesting — future reusable Formula, absent from inventory

No Titan ProductVersion currently resolves
`roll_nesting_billable_sqft`. The engine and V1 parity fixtures support this
future final-dollar form:

```text
roll_nesting_billable_sqft(w,h,q,printable_width,piece_allowance_x,piece_allowance_y,billing_width_increment,billing_length_increment) * base_price
```

| Input key | Type | Display label | Description | Required | Default | Minimum | Maximum | Unit / semantic | Evidence | Confidence |
| --- | --- | --- | --- | --- | --- | ---: | --- | --- | --- | --- |
| `printable_width` | number | Printable roll width | Available printable roll width. | Yes | UNKNOWN | > 0 | UNKNOWN | inches | roll layout helper | High |
| `piece_allowance_x` | number | Width allowance | Added production width allowance. | Yes | UNKNOWN | 0 | UNKNOWN | inches | roll layout helper | High |
| `piece_allowance_y` | number | Length allowance | Added production length allowance. | Yes | UNKNOWN | 0 | UNKNOWN | inches | roll layout helper | High |
| `billing_width_increment` | number | Billing width increment | Width billing round-up increment. | Yes | UNKNOWN | > 0 | UNKNOWN | inches | roll layout helper | High |
| `billing_length_increment` | number | Billing length increment | Length billing round-up increment. | Yes | UNKNOWN | > 0 | UNKNOWN | inches | roll layout helper | High |

Rotation remains ProductVersion-owned. Physical width, material identity, and
registration waste are production/consumption concerns, not Formula arguments
in this pricing helper.

## Safe deduplication

Only exact expression plus exact output meaning, typed contract, pricing
profile, and helper semantics may share a FormulaRevision. Product binding
values are independent only when they satisfy that shared contract.

1. Standard padded sticker Formula: one reviewed reusable identity is safe in
principle, with `declaredInputs: []`.
2. `total_sqft * p`: one separate reusable identity is safe in principle, with
`declaredInputs: []`.
3. Parametric sheet Formula: one library identity is safe in principle, but no
binding may be created until all five values are positively recovered for each
version.
4. All other expressions remain product-scoped, non-Formula, or ambiguous as
classified above. Do not algebraically normalize `p`/`base_price` expressions.

## ProductVersion freeze strategy

### ACTIVE

Freeze the current effective Formula with a first append-only binding before
permitting edits to a mutable legacy Formula. The binding must capture the
resolved expression, an approved immutable revision, and validated binding
values. It must not change tree JSON or promote a new version.

### DRAFT

Use normal Draft Formula authoring: choose a FormulaRevision and validated
ProductVersion input values; Draft bindings may be retargeted before publish.
Do not publish until preview parity is exact.

### DEPRECATED

Freeze via the same append-only first-binding operation after ACTIVE behavior
is proven. Do not create replacement Drafts and do not mutate the historical
tree.

### Binding-model assessment

The storage model permits a first INSERT for an unbound ACTIVE or DEPRECATED
version: the binding PK permits only one row and its trigger intentionally
blocks UPDATE/DELETE for non-DRAFT versions. Resolver precedence makes this
metadata authoritative over mutable library/embedded/legacy provenance.

The missing piece is the application operation. Existing code can only upsert a
binding for a locked DRAFT. Add a canonical historical-freeze command with
tenant scope, RBAC, CSRF, durable request identity, exact replay comparison,
row locking, typed input validation, audit attribution, and an INSERT-only
rule. It must reject an existing different binding and never write tree JSON.

## Human-review gates

1. Recover and validate all sheet-family binding values, including values
currently supplied by legacy Formula Library config.
2. Decide whether to introduce an output-basis contract for Magnetic's
billable-area Formula or migrate it to an approved final-dollar expression.
3. Confirm Installation workflow/profile before flat-fee normalization.
4. Supply authoritative fees for RUSH and Shipping; do not infer them.
5. Review Posters' $2 Draft divergence before any publication.
6. Decide Library visibility only after Formula identity governance review;
product-scoped is the safe initial default except the validated sheet family.

## Evidence

- V1 evaluator and source: `server/services/pricing/PricingService.ts`.
- Canonical Formula helper and sheet yield: `shared/pbv2/formulaHelpers.ts`.
- Canonical runtime variable ownership: `shared/pbv2/formulaScope.ts` and
  `shared/pbv2/pricingVariableRegistry.ts`.
- Roll semantics: `shared/pbv2/rollMediaLayout.ts`.
- Canonical V2 calculation: `v2/src/modules/pricing/v2PricingAdapter.ts`.
- Formula domain and typed binding values: `v2/src/modules/pricing/formulaDomain.ts`.
- Append-only binding schema: `server/db/migrations_v2/0225_v2_formula_domain_foundation.sql`.
- Inventory planner: `v2/scripts/reportLegacyFormulaFreezeInventory.ts`.

## No mutations

This is a source/documentation planning artifact. Formula identities,
revisions, bindings, Products, ProductVersions, Drafts, and Formula Library
records were not changed.
