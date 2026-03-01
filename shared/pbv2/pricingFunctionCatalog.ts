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
];
