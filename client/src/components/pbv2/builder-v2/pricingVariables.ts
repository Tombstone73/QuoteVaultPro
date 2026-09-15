export interface PricingVariable {
  key: string;
  description: string;
}

export const PRICING_VARIABLES: PricingVariable[] = [
  { key: "base_price", description: "Product base price" },
  { key: "width", description: "Width input value" },
  { key: "height", description: "Height input value" },
  { key: "quantity", description: "Selected quantity" },
  { key: "sqft", description: "Calculated square footage" },
  { key: "linear_feet", description: "Legacy ordered-width ÷ 12 linear footage; not roll consumption" },
  { key: "consumed_linear_feet", description: "Canonical roll length consumed, including production allowances and registration waste" },
  { key: "billed_linear_feet", description: "Canonical billable roll length after billing increment rounding" },
  { key: "selected_option_price", description: "Sum of selected option prices" },
];
