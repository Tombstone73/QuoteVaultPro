export type PricingVariableCategory = "Dimensions" | "Quantity" | "Pricing" | "Derived" | "Options";

/**
 * Canonical PBV2 pricing variables.
 *
 * Contract lock-in (must never change semantics):
 * - `total_sqft` is canonical billing geometry.
 * - `finished_width`/`finished_height` are post-trim dimensions.
 * - Meanings of these keys are stable and backward-compatible across PBV2.
 */
export type CanonicalPricingVariableKey =
  | "ordered_width"
  | "ordered_height"
  | "finished_width"
  | "finished_height"
  | "sqft"
  | "total_sqft"
  | "finished_sqft"
  | "total_finished_sqft"
  | "computed_sheets"
  | "billed_sheets"
  | "sheet_count"
  | "sheet_sqft"
  | "billed_sheet_sqft"
  | "pieces_per_sheet"
  | "full_sheets"
  | "partial_sheet_piece_count"
  | "partial_sheet_finished_sqft"
  | "partial_sheet_billable_sqft"
  | "total_sheet_count"
  | "q"
  | "linear_feet";

export interface PricingVariableDefinition {
  key: string;
  label: string;
  description: string;
  example?: string | number;
  category: PricingVariableCategory;
  aliases: string[];
}

export const PBV2_PRICING_VARIABLES: PricingVariableDefinition[] = [
  {
    key: "w",
    label: "Width",
    description: "Ordered item width input in inches.",
    example: 24,
    category: "Dimensions",
    aliases: ["width"],
  },
  {
    key: "ordered_width",
    label: "Ordered Width",
    description: "Explicit ordered width input before finished-size trim allowances are applied.",
    example: 24,
    category: "Dimensions",
    aliases: [],
  },
  {
    key: "h",
    label: "Height",
    description: "Ordered item height input in inches.",
    example: 36,
    category: "Dimensions",
    aliases: ["height"],
  },
  {
    key: "ordered_height",
    label: "Ordered Height",
    description: "Explicit ordered height input before finished-size trim allowances are applied.",
    example: 36,
    category: "Dimensions",
    aliases: [],
  },
  {
    key: "trim_allowance_x",
    label: "Trim Allowance W",
    description: "Width-side trim allowance added to ordered width before sqft calculation.",
    example: 0.25,
    category: "Dimensions",
    aliases: ["trim_allowance"],
  },
  {
    key: "trim_allowance_y",
    label: "Trim Allowance H",
    description: "Height-side trim allowance added to ordered height before sqft calculation.",
    example: 0.25,
    category: "Dimensions",
    aliases: [],
  },
  {
    key: "finished_width",
    label: "Finished Width",
    description: "Post-trim finished width used for canonical geometry.",
    example: 24.25,
    category: "Dimensions",
    aliases: ["fw"],
  },
  {
    key: "finished_height",
    label: "Finished Height",
    description: "Post-trim finished height used for canonical geometry.",
    example: 36.25,
    category: "Dimensions",
    aliases: ["fh"],
  },
  {
    key: "q",
    label: "Quantity",
    description: "Number of pieces being priced.",
    example: 1,
    category: "Quantity",
    aliases: ["quantity"],
  },
  {
    key: "base_price",
    label: "Base Price Rate",
    description: "Effective base price per square foot (dollars) after pricing tiers.",
    example: 1.25,
    category: "Pricing",
    aliases: ["p", "basePricePerSqft", "pricePerSqft", "unitPrice", "price"],
  },
  {
    key: "original_base_price",
    label: "Original Base Price",
    description: "Configured base price per square foot before quantity tiers and matrix overrides.",
    example: 1.25,
    category: "Pricing",
    aliases: [],
  },
  {
    key: "tier_base_price",
    label: "Tier Base Price",
    description: "Quantity-tier base price per square foot when a tier applies; otherwise the effective base rate.",
    example: 1.1,
    category: "Pricing",
    aliases: ["tier_rate"],
  },
  {
    key: "effective_base_price",
    label: "Effective Base Price",
    description: "Base price per square foot after quantity tier resolution and before matrix base_price overrides.",
    example: 1.1,
    category: "Pricing",
    aliases: [],
  },
  {
    key: "sqft",
    label: "SqFt (Per Item)",
    description: "Finished square footage for one item: (finished_width × finished_height) / 144.",
    example: 6,
    category: "Derived",
    aliases: [],
  },
  {
    key: "total_sqft",
    label: "Total SqFt",
    description: "Canonical billing geometry total square footage: sqft × quantity.",
    example: 24,
    category: "Derived",
    aliases: [],
  },
  {
    key: "finished_sqft",
    label: "Finished SqFt",
    description: "Finished square footage for one item. Same value as sqft; included to make formula basis explicit.",
    example: 3,
    category: "Derived",
    aliases: [],
  },
  {
    key: "total_finished_sqft",
    label: "Total Finished SqFt",
    description: "Finished square footage across all pieces. Same value as total_sqft; included to make formula basis explicit.",
    example: 30,
    category: "Derived",
    aliases: [],
  },
  {
    key: "computed_sheets",
    label: "Computed Sheets",
    description: "Computed sheet usage for the current dimensions and quantity. Use for sheet-count pricing formulas.",
    example: 1,
    category: "Derived",
    aliases: [],
  },
  {
    key: "billed_sheets",
    label: "Billed Sheets",
    description: "Billed sheet-equivalent quantity derived from sheet yield settings.",
    example: 1,
    category: "Derived",
    aliases: [],
  },
  {
    key: "sheet_count",
    label: "Sheet Count",
    description: "Whole or computed sheet count exposed for sheet-count pricing.",
    example: 1,
    category: "Derived",
    aliases: [],
  },
  {
    key: "sheet_sqft",
    label: "Sheet SqFt",
    description: "Production sheet area in square feet, such as 48 x 96 / 144 = 32.",
    example: 32,
    category: "Derived",
    aliases: [],
  },
  {
    key: "billed_sheet_sqft",
    label: "Billed Sheet SqFt",
    description: "Billable sheet-yield square footage. Use billed_sheet_sqft * base_price for sheet-yield sqft pricing.",
    example: 32,
    category: "Derived",
    aliases: [],
  },
  {
    key: "pieces_per_sheet",
    label: "Pieces Per Sheet",
    description: "Actual layout yield for one production sheet using the selected orientation.",
    example: 10,
    category: "Derived",
    aliases: [],
  },
  {
    key: "full_sheets",
    label: "Full Sheets",
    description: "Number of fully consumed production sheets for the current quantity.",
    example: 9,
    category: "Derived",
    aliases: [],
  },
  {
    key: "partial_sheet_piece_count",
    label: "Partial Sheet Pieces",
    description: "Number of pieces placed on the final partial sheet, if any.",
    example: 1,
    category: "Derived",
    aliases: [],
  },
  {
    key: "partial_sheet_finished_sqft",
    label: "Partial Finished SqFt",
    description: "Finished square footage represented by the final partial sheet only.",
    example: 3,
    category: "Derived",
    aliases: [],
  },
  {
    key: "partial_sheet_billable_sqft",
    label: "Partial Billable SqFt",
    description: "Billable square footage for the final partial sheet after minimum and increment rules.",
    example: 32,
    category: "Derived",
    aliases: [],
  },
  {
    key: "total_sheet_count",
    label: "Total Sheet Count",
    description: "Whole production sheet count from actual layout yield. This matches computed_sheets for sheet-yield pricing.",
    example: 10,
    category: "Derived",
    aliases: [],
  },
  {
    key: "linear_feet",
    label: "Linear Feet",
    description: "Linear feet derived from width in inches.",
    example: 2,
    category: "Derived",
    aliases: [],
  },
];

export const PBV2_PRICING_VARIABLE_CATEGORY_ORDER: PricingVariableCategory[] = [
  "Dimensions",
  "Quantity",
  "Pricing",
  "Derived",
  "Options",
];
