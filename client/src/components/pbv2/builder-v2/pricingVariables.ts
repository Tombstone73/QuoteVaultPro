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
  { key: "linear_feet", description: "Calculated linear footage" },
  { key: "selected_option_price", description: "Sum of selected option prices" },
];