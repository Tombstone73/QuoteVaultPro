# M1.2 Pricing Parity Adapter

## Purpose and boundary

M1.2 implements `V2PricingParityAdapter`, the first calculation-only V2 business capability. `PricingPort.calculate(request)` accepts the M1.1 scoped Product/configuration DTO and resolved pricing rules, and returns a deterministic `PricingResult`. It has no repository, HTTP, Sales, Billing, Routing, Inventory, or commercial-write dependency.

The future M1.3 Product compatibility reader validates organization, Product lifecycle, active configuration association, Formula Library version/content, and resolved selections **before** calling Pricing. Pricing evaluates only those explicit inputs. A caller may supply immutable `NestingEstimateEvidence`; Pricing does not create production nests or persist plans.

## Reuse and exclusions

The M1.2 nesting seam adapts the reviewed pure `shared/pbv2/formulaHelpers.calculateSheetYield` helper into pricing evidence. Its rotation, mixed-layout, billable-area, and sheet-count behavior is covered by parity vectors. Formula/matrix/tier and option precedence are reconstructed into the V2 DTO shape, because V1's equivalent routines are private or coupled to `PricingService` and legacy tree/session shapes.

Explicitly excluded: `PricingService.priceLineItem`, `evaluatePricingPreviewFromTree`, V1 routes, repositories, DB reads, Product/Material lookup, Sales snapshots/overrides, Invoice math, shipping, routing, environment-controlled logging, and mutable singleton state.

## Calculation model

1. Validate organization/Product/configuration lineage and normalized quantity/dimensions. Declared inches, feet, and millimeters normalize to inches (deterministically quantized to twelve decimal places) and preserve both source and normalized evidence. A geometry rule—area rate, area option, formula, or square-foot tier—without resolved effective dimensions fails rather than silently calculating zero; fixed Product dimensions must already be supplied by the future compatibility reader.
2. Use declared matrix stable choice values, then the selected matrix-row tier or declared product tier. A matrix-row tier basis overrides the Product tier basis when the V1 configuration declares one.
3. For computed-sheet tiers, use only supplied sheet-count evidence; no raw-quantity fallback is allowed.
4. Calculate base: per-piece, per-square-foot, flat fee, or a resolved dollar-valued formula. Formula results are converted to integer cents at the named rounding stage.
5. Apply flat, per-unit, per-square-foot, percentage, and multiplier impacts. Characterized percentage/multiplier effects use the calculated base, so selected percentages are additive rather than compounded.
6. Apply the line-level minimum charge once; quantity-only profiles deliberately ignore stale geometry, area formulas, and line minimums.

`PricingResult.calculatedLineAmount` is authoritative. `calculatedUnitAmount` is display allocation only, with exact decimal unit cents and allocation policy recorded so non-divisible line totals do not pretend to be exact per-unit monetary truth. Components reconcile exactly to the calculated line cents. Selling-price overrides remain exclusively a Sales `SellingPriceDecision` and never enter `PricingCalculationRequest`.

## Historical evidence and determinism

Every result includes configuration id/version/content hash, normalized configuration, matrix/tier resolution, option-impact bases, supplied nesting evidence, evaluator/version, rounding stages, warnings, and a canonical `sha256` evidence fingerprint. Formula evidence preserves source, formula id, version, content hash, resolved expression, and resolved variables. A later Formula Library edit cannot reinterpret a historical result. The fingerprint omits absent optional fields deterministically and includes no timestamps, random values, or presentation-only metadata.

## Characterization catalog and results

All fixtures are product/tenant independent V1 behavior vectors, asserted through V2 inputs and semantic output/evidence rather than importing V1 runtime orchestration.

| Family | Characterized coverage | Result |
| --- | --- | --- |
| 4mm Coroplast | 24x18 quantities 8, 10, 91, 100, 101; computed sheet count, tier, fractional 137.5-cent rate | 4,400; 4,400; 32,960; 32,960; 36,256 cents |
| Coroplast rotation | 24x36 q5 normal vs rotation/mixed layout | 8,800 vs 4,400 cents |
| 13oz Banner | 36x42 sqft base plus pole-pocket option; feet/mm normalization and exact six-sqft mm tier boundary | 1,913 cents; correct 1,200-cent tier result |
| Contour Cut Stickers | 4x4 q100 caller-supplied roll billable-area estimate | 1,600 cents |
| Quantity-only / per-piece | stale 24x36 geometry, stale formula, and minimum ignored | 600 cents |
| Matrix | stable choice values; 4mm single q100/q101 row tier; row computed-sheet basis overrides product quantity basis; fixed effective dimensions | 44,000 / 33,330 cents; 30,000-cent row-basis vector |
| Formula | resolved `ceil` expression with version/hash | 700 cents |
| Option impacts | flat, per-unit, area, percentage, multiplier, additive percentage composition | discrete impact evidence and 13,500/275-cent assertions |
| Minimum / rounding | below-line minimum and 133.33-cent fractional rate | 444 / 4,267 cents |
| Adversarial fallbacks | missing computed-sheet basis; matrix row no match | explicit warning, never silent tier fallback |

The source catalog resides in `v2/src/modules/pricing/parityFixtures.ts`; executable fixtures are in `v2/tests/modules/pricingParityAdapter.test.ts` and retain source-suite provenance.

## Parity classification

All implemented fixture outcomes are `required_parity`. There are no `intentional_v2_correction`, `v1_legacy_behavior_not_carried`, or `human_product_decision_required` mismatches in this milestone. The adapter supports only arithmetic and `ceil` directly; `sheet_consumption_sqft` and `roll_nesting_billable_sqft` are intentionally converted to supplied, versioned Nesting estimate facts for this narrow M1.2 seam. Full tree visibility/default resolution remains outside this DTO boundary; M1.3 must resolve and validate those facts through scoped compatibility reads before invoking Pricing.

## Open decisions and next milestone

- The full Formula Library compatibility reader and the allowed formula-function vocabulary need a versioned specification.
- Full PBV2 visibility/default/rule resolution belongs in the scoped M1.3 Product/Pricing compatibility read path; it must not leak tree JSON into Sales.
- Matrix static-fallback warning taxonomy and choice-level base-rate conflict behavior need fixture expansion before broader product coverage.
- Roll-layout parity beyond the characterized pricing estimate belongs to the later Nesting module.

**Next milestone: M1.3 — Customer/Product Compatibility Reads.** It supplies organization-scoped CRM/Product/active-PBV2 reads and lifecycle validation. It does not add commercial writers or migrations.
