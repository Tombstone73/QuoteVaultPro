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
