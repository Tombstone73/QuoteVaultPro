export type PricingVariableCategory = "Dimensions" | "Quantity" | "Pricing" | "Derived" | "Options";

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
    key: "width",
    label: "Width",
    description: "Ordered item width input in inches.",
    example: 24,
    category: "Dimensions",
    aliases: ["w", "ordered_width"],
  },
  {
    key: "height",
    label: "Height",
    description: "Ordered item height input in inches.",
    example: 36,
    category: "Dimensions",
    aliases: ["h", "ordered_height"],
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
    description: "Finished width after trim allowance: ordered width + trim allowance.",
    example: 24.25,
    category: "Dimensions",
    aliases: ["fw"],
  },
  {
    key: "finished_height",
    label: "Finished Height",
    description: "Finished height after trim allowance: ordered height + trim allowance.",
    example: 36.25,
    category: "Dimensions",
    aliases: ["fh"],
  },
  {
    key: "quantity",
    label: "Quantity",
    description: "Number of pieces being priced.",
    example: 1,
    category: "Quantity",
    aliases: ["q"],
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
    description: "Total square footage: sqft × quantity.",
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
