import { extractFormulaVariables } from "../../../../shared/pbv2/formulaHelpers.js";

export type ProductFormulaInput = Readonly<{
  key: string;
  label: string;
  unit?: "in" | "sq_ft";
  minimum?: number;
  exclusiveMinimum?: boolean;
}>;

/**
 * ProductVersion-scoped inputs supported by the current Formula Library
 * contract. Formula definitions remain shared and immutable; a formula may
 * opt into these inputs by declaring numeric defaults in `config.variables`.
 */
const supportedInputs: Readonly<Record<string, ProductFormulaInput>> = {
  sheet_width: { key: "sheet_width", label: "Sheet width", unit: "in", minimum: 0, exclusiveMinimum: true },
  sheet_length: { key: "sheet_length", label: "Sheet length", unit: "in", minimum: 0, exclusiveMinimum: true },
  usable_drop_min: { key: "usable_drop_min", label: "Usable drop minimum", unit: "in", minimum: 0 },
  billable_length_increment: { key: "billable_length_increment", label: "Billable length increment", unit: "in", minimum: 0, exclusiveMinimum: true },
  minimum_billable_sqft: { key: "minimum_billable_sqft", label: "Minimum billable area", unit: "sq_ft", minimum: 0 },
  printable_width: { key: "printable_width", label: "Printable width", unit: "in", minimum: 0, exclusiveMinimum: true },
  piece_allowance_x: { key: "piece_allowance_x", label: "Horizontal piece allowance", unit: "in", minimum: 0 },
  piece_allowance_y: { key: "piece_allowance_y", label: "Vertical piece allowance", unit: "in", minimum: 0 },
  billing_width_increment: { key: "billing_width_increment", label: "Billing width increment", unit: "in", minimum: 0, exclusiveMinimum: true },
  billing_length_increment: { key: "billing_length_increment", label: "Billing length increment", unit: "in", minimum: 0, exclusiveMinimum: true },
};

export const productFormulaInputsFromLibraryConfig = (config: unknown): readonly ProductFormulaInput[] =>
  Object.keys(extractFormulaVariables(config && typeof config === "object" && !Array.isArray(config) ? config as Record<string, unknown> : null))
    .flatMap((key) => supportedInputs[key] ? [supportedInputs[key]!] : []);

export const validateProductFormulaInput = (input: ProductFormulaInput, value: unknown): number | null => {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  if (input.minimum != null && (input.exclusiveMinimum ? value <= input.minimum : value < input.minimum)) return null;
  return value;
};
