export interface PricingFunctionDefinition {
  key: string;
  signature: string;
  description: string;
  example: string;
}

export const PBV2_PRICING_FUNCTIONS: PricingFunctionDefinition[] = [
  {
    key: "ceil",
    signature: "ceil(x)",
    description: "Rounds a number up to the nearest integer.",
    example: "ceil(36.6753) => 37",
  },
  {
    key: "floor",
    signature: "floor(x)",
    description: "Rounds a number down to the nearest integer.",
    example: "floor(36.6753) => 36",
  },
  {
    key: "round",
    signature: "round(x)",
    description: "Rounds to the nearest integer.",
    example: "round(36.5) => 37",
  },
  {
    key: "min",
    signature: "min(a, b, ...)",
    description: "Returns the smallest value.",
    example: "min(10, 3, 8) => 3",
  },
  {
    key: "max",
    signature: "max(a, b, ...)",
    description: "Returns the largest value.",
    example: "max(10, 3, 8) => 10",
  },
  {
    key: "abs",
    signature: "abs(x)",
    description: "Returns the absolute value.",
    example: "abs(-4.2) => 4.2",
  },
  {
    key: "sheet_consumption_sqft",
    signature:
      "sheet_consumption_sqft(w, h, q, sheet_width, sheet_length, usable_drop_min, billable_length_increment, minimum_billable_sqft)",
    description:
      "Calculates billable square footage for sheet or roll material. Tests normal and rotated orientations and picks the most material-efficient layout. Applies the usable-drop rule: if the leftover side strip is narrower than usable_drop_min it is treated as waste and the full sheet width is charged; otherwise only the used width is charged. Consumed length is rounded up to the nearest billable_length_increment. Returns at least minimum_billable_sqft.",
    example:
      "sheet_consumption_sqft(24, 36, 4, 48, 96, 6, 12, 0) => 24",
  },
];
