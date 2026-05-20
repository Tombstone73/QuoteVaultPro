import type { LineItemOptionSelectionsV2, PricingV2Tier } from "./optionTreeV2";
import { normalizeSelectionMap } from "./optionTreeV2Runtime";

export type ProductOptionPricingMatrixRow = {
  id?: string;
  when?: Record<string, unknown>;
  match?: Record<string, unknown>;
  combination?: Record<string, unknown>;
  variables?: Record<string, unknown>;
  values?: Record<string, unknown>;
  qtyTiers?: PricingV2Tier[];
};

export type ProductOptionPricingMatrix = {
  id?: string;
  dimensions: string[];
  rows: ProductOptionPricingMatrixRow[];
};

export type ProductOptionPricingMatrixErrorCode =
  | "PBV2_PRICING_MATRIX_MISSING_SELECTION"
  | "PBV2_PRICING_MATRIX_ROW_NOT_FOUND"
  | "PBV2_PRICING_MATRIX_INVALID_VARIABLE";

export type ProductOptionPricingMatrixErrorDetail = {
  code: ProductOptionPricingMatrixErrorCode;
  message: string;
  rowId?: string;
  optionGroup?: string;
  variable?: string;
};

export type ProductOptionPricingMatrixResolution = {
  variables: Record<string, number>;
  matchedRow?: ProductOptionPricingMatrixRow;
  ignoredVariables: string[];
  errors: ProductOptionPricingMatrixErrorDetail[];
};

export const PBV2_PRICING_MATRIX_PROTECTED_VARIABLES = new Set([
  "width",
  "w",
  "ordered_width",
  "height",
  "h",
  "ordered_height",
  "quantity",
  "q",
  "original_base_price",
  "tier_base_price",
  "tier_rate",
  "effective_base_price",
  "sqft",
  "total_sqft",
  "linear_feet",
  "finished_width",
  "fw",
  "finished_height",
  "fh",
  "trim_allowance",
  "trim_allowance_x",
  "trim_allowance_y",
]);

export function isProductOptionPricingMatrixCurrencyVariable(variableKey: string): boolean {
  const key = variableKey.trim().toLowerCase();
  return (
    key === "base_price" ||
    key.endsWith("_price") ||
    key.endsWith("_fee") ||
    key.endsWith("_cost") ||
    key.endsWith("_modifier")
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function valuesMatch(selected: unknown, expected: unknown): boolean {
  if (Array.isArray(selected)) return selected.includes(expected);
  return selected === expected;
}

function getRowMatch(row: ProductOptionPricingMatrixRow): Record<string, unknown> {
  return row.when ?? row.match ?? row.combination ?? {};
}

function getRowVariables(row: ProductOptionPricingMatrixRow): Record<string, unknown> {
  return row.variables ?? row.values ?? {};
}

function resolveMatrixVariableValue(key: string, rawValue: unknown): number {
  const value = Number(rawValue);
  if (
    isProductOptionPricingMatrixCurrencyVariable(key) &&
    Number.isInteger(value) &&
    Math.abs(value) >= 100
  ) {
    return value / 100;
  }
  return value;
}

export function extractProductOptionPricingMatrix(tree: unknown): ProductOptionPricingMatrix | null {
  if (!isRecord(tree)) return null;
  const meta = isRecord(tree.meta) ? tree.meta : {};
  const candidate = tree.pricingMatrix ?? meta.pricingMatrix;

  if (Array.isArray(candidate)) {
    return { dimensions: [], rows: candidate as ProductOptionPricingMatrixRow[] };
  }

  if (!isRecord(candidate)) return null;
  const dimensions = Array.isArray(candidate.dimensions)
    ? candidate.dimensions.filter(isNonEmptyString)
    : [];
  const rows = Array.isArray(candidate.rows)
    ? candidate.rows.filter(isRecord) as ProductOptionPricingMatrixRow[]
    : [];

  if (dimensions.length === 0 && rows.length === 0) return null;
  return {
    id: isNonEmptyString(candidate.id) ? candidate.id : undefined,
    dimensions,
    rows,
  };
}

export function resolveProductOptionPricingMatrix(input: {
  pricingMatrix?: ProductOptionPricingMatrix | null;
  selections?: LineItemOptionSelectionsV2 | Record<string, unknown>;
  protectedVariables?: Set<string>;
}): ProductOptionPricingMatrixResolution {
  const matrix = input.pricingMatrix;
  if (!matrix) {
    return { variables: {}, ignoredVariables: [], errors: [] };
  }

  const selections = normalizeSelectionMap(input.selections);
  const protectedVariables = input.protectedVariables ?? PBV2_PRICING_MATRIX_PROTECTED_VARIABLES;
  const dimensions = matrix.dimensions.filter(isNonEmptyString);
  const errors: ProductOptionPricingMatrixErrorDetail[] = [];

  for (const dimension of dimensions) {
    if (selections[dimension] === undefined || selections[dimension] === null || selections[dimension] === "") {
      errors.push({
        code: "PBV2_PRICING_MATRIX_MISSING_SELECTION",
        optionGroup: dimension,
        message: `${dimension} is required to resolve pricing matrix variables.`,
      });
    }
  }

  if (errors.length > 0) {
    return { variables: {}, ignoredVariables: [], errors };
  }

  const matchedRow = matrix.rows.find((row) => {
    const match = getRowMatch(row);
    const keys = dimensions.length > 0 ? dimensions : Object.keys(match);
    if (keys.length === 0) return false;
    return keys.every((key) => valuesMatch(selections[key], match[key]));
  });

  if (!matchedRow) {
    const selectedDescription = dimensions
      .map((dimension) => `${dimension}=${String(selections[dimension])}`)
      .join(", ");
    return {
      variables: {},
      ignoredVariables: [],
      errors: [{
        code: "PBV2_PRICING_MATRIX_ROW_NOT_FOUND",
        message: `No pricing matrix row matches the selected options${selectedDescription ? ` (${selectedDescription})` : ""}.`,
      }],
    };
  }

  const variables: Record<string, number> = {};
  const ignoredVariables: string[] = [];

  for (const [key, rawValue] of Object.entries(getRowVariables(matchedRow))) {
    if (!isNonEmptyString(key)) continue;
    if (protectedVariables.has(key)) {
      ignoredVariables.push(key);
      continue;
    }

    const value = resolveMatrixVariableValue(key, rawValue);
    if (!Number.isFinite(value)) {
      errors.push({
        code: "PBV2_PRICING_MATRIX_INVALID_VARIABLE",
        rowId: matchedRow.id,
        variable: key,
        message: `Pricing matrix variable ${key} must be a finite number.`,
      });
      continue;
    }

    variables[key] = value;
  }

  return {
    variables,
    matchedRow,
    ignoredVariables: ignoredVariables.sort((a, b) => a.localeCompare(b)),
    errors,
  };
}
