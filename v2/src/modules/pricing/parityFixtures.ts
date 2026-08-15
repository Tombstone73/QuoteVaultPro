export type ParityClassification = "required_parity" | "intentional_v2_correction" | "v1_legacy_behavior_not_carried" | "human_product_decision_required";
export type PricingParityFixture = Readonly<{ id: string; productFamily: string; behaviors: readonly string[]; classification: ParityClassification }>;

/** Definitions only: M1.2 supplies fixture inputs and adapter assertions. */
export const pricingParityFixtures: readonly PricingParityFixture[] = [
  { id: "banner-sqft-options", productFamily: "13oz Banner", behaviors: ["custom_dimensions", "per_square_foot", "minimum_charge", "grommet_option_impacts", "percent_and_multiplier_rounding"], classification: "required_parity" },
  { id: "coroplast-sheet-tier", productFamily: "4mm Coroplast", behaviors: ["fixed_and_custom_dimensions", "computed_sheet_use", "rotation", "quantity_tier_boundaries", "fractional_rate_evidence"], classification: "required_parity" },
  { id: "contour-sticker-nesting", productFamily: "Contour Cut Stickers", behaviors: ["formula", "declared_nesting_estimate", "sheet_usage_evidence"], classification: "required_parity" },
  { id: "quantity-only-piece", productFamily: "Quantity-only per-piece", behaviors: ["per_piece", "stale_geometry_ignored", "quantity_boundary"], classification: "required_parity" },
  { id: "matrix-product", productFamily: "Matrix Product", behaviors: ["stable_choice_values", "matrix_row", "fallback_warning", "fixed_dimensions"], classification: "required_parity" },
  { id: "formula-product", productFamily: "Formula Product", behaviors: ["resolved_expression", "formula_variables", "rounding_stages"], classification: "required_parity" },
  { id: "commercial-edge-cases", productFamily: "Cross-cutting", behaviors: ["half_cent_rounding", "minimum_boundary", "square_foot_tier_boundary", "manual_unit_override", "manual_total_override", "same_key_replay", "cross_tenant_rejection"], classification: "required_parity" },
];

/** Stable V1 characterization vectors, deliberately product/tenant independent. */
export const coroplastGoldenVectors = [
  { id: "coroplast-24x18-q8", source: "PricingService.goldenRegression:4x8", widthIn: 24, heightIn: 18, quantity: 8, expected: { sheets: 1, tierMinQuantity: 1, tierRate: "1.375", lineCents: 4400 } },
  { id: "coroplast-24x18-q10", source: "PricingService.goldenRegression:4x8", widthIn: 24, heightIn: 18, quantity: 10, expected: { sheets: 1, tierMinQuantity: 1, tierRate: "1.375", lineCents: 4400 } },
  { id: "coroplast-24x18-q91", source: "PricingService.goldenRegression:4x8", widthIn: 24, heightIn: 18, quantity: 91, expected: { sheets: 10, tierMinQuantity: 10, tierRate: "1.03", lineCents: 32960 } },
  { id: "coroplast-24x18-q100", source: "PricingService.goldenRegression:4x8", widthIn: 24, heightIn: 18, quantity: 100, expected: { sheets: 10, tierMinQuantity: 10, tierRate: "1.03", lineCents: 32960 } },
  { id: "coroplast-24x18-q101", source: "PricingService.goldenRegression:4x8", widthIn: 24, heightIn: 18, quantity: 101, expected: { sheets: 11, tierMinQuantity: 10, tierRate: "1.03", lineCents: 36256 } },
] as const;

/** M1.2 deterministic V1 characterization sources, asserted through V2 DTOs. */
export const pricingCharacterizationVectors = [
  { id: "banner-36x42-pole-pocket", source: "PricingService.bannerProduct.test.ts", expectedLineCents: 1913, evidence: ["square_foot", "flat_option"] },
  { id: "contour-4x4-q100", source: "PricingService.formula.test.ts", expectedLineCents: 1600, evidence: ["roll_nesting_billable_sqft", "physical_consumption"] },
  { id: "quantity-only-stale-geometry", source: "PricingService.basePrice.test.ts", expectedLineCents: 600, evidence: ["per_piece", "stale_geometry_ignored", "minimum_ignored"] },
  { id: "matrix-4mm-single-q100-q101", source: "PricingService.pricingMatrix.test.ts", expectedLineCents: [44000, 33330], evidence: ["stable_choice_values", "matrix_tier"] },
  { id: "formula-ceil-24x36", source: "PricingService.formula.test.ts", expectedLineCents: 700, evidence: ["resolved_expression", "formula_version_hash"] },
  { id: "option-impact-composition", source: "PricingService.choicePricingOverride.test.ts + numericOptionPricing.test.ts", expectedLineCents: 13500, evidence: ["flat", "per_unit", "per_square_foot", "percent", "multiplier", "non_stacking_percent"] },
  { id: "minimum-and-fractional-rounding", source: "PricingService.basePrice.test.ts + sheetConsumption.test.ts", expectedLineCents: [444, 4267], evidence: ["line_minimum", "fractional_cents", "final_round"] },
] as const;
