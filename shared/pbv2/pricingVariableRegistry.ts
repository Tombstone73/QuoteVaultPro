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
    description: "Item width input in inches.",
    example: 24,
    category: "Dimensions",
    aliases: ["w"],
  },
  {
    key: "height",
    label: "Height",
    description: "Item height input in inches.",
    example: 36,
    category: "Dimensions",
    aliases: ["h"],
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
    description: "Square footage for a single item: (width × height) / 144.",
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
