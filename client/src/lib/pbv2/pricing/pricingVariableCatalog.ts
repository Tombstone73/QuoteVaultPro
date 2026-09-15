export type PricingVariableCategory = "Dimensions" | "Quantity" | "Pricing" | "Derived" | "Options";

export interface PricingVariableCatalogEntry {
  key: string;
  label: string;
  description: string;
  example?: string | number;
  category: PricingVariableCategory;
}

export const PRICING_VARIABLE_CATALOG: PricingVariableCatalogEntry[] = [
  {
    key: "width",
    label: "Width",
    description: "Item width from preview input.",
    example: 24,
    category: "Dimensions",
  },
  {
    key: "height",
    label: "Height",
    description: "Item height from preview input.",
    example: 36,
    category: "Dimensions",
  },
  {
    key: "quantity",
    label: "Quantity",
    description: "Number of units being priced.",
    example: 1,
    category: "Quantity",
  },
  {
    key: "base_price",
    label: "Base Price",
    description: "Base calculated amount before option add-ons.",
    example: 12.5,
    category: "Pricing",
  },
  {
    key: "selected_option_price",
    label: "Selected Option Price",
    description: "Combined price impact of selected options.",
    example: 3.75,
    category: "Pricing",
  },
  {
    key: "sqft",
    label: "Square Feet",
    description: "Computed area in square feet based on dimensions.",
    example: 6,
    category: "Derived",
  },
  {
    key: "linear_feet",
    label: "Linear Feet (Legacy)",
    description: "Legacy ordered-width ÷ 12 linear footage; not roll consumption or billed roll length.",
    example: 2,
    category: "Derived",
  },
  {
    key: "consumed_linear_feet",
    label: "Consumed Linear Feet",
    description: "Actual roll length consumed by canonical roll layout, including allowances and registration waste.",
    example: 3.875,
    category: "Derived",
  },
  {
    key: "billed_linear_feet",
    label: "Billed Linear Feet",
    description: "Customer-billable roll length after canonical billing-length increment rounding.",
    example: 4,
    category: "Derived",
  },
  {
    key: "selected_option_values",
    label: "Selected Option Values",
    description: "Map of option IDs to selected values in preview state.",
    example: "{ \"lamination\": \"gloss\" }",
    category: "Options",
  },
];

export const PRICING_VARIABLE_CATEGORY_ORDER: PricingVariableCategory[] = [
  "Dimensions",
  "Quantity",
  "Pricing",
  "Derived",
  "Options",
];
