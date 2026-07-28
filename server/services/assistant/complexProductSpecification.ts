import { createHash } from "node:crypto";
import type { ProductOptionPricingMatrix } from "@shared/productOptionPricingMatrix";

export type ComplexProductOptionGroup = {
  proposalKey: string; name: string; required: true; selectionMode: "single";
  values: Array<{ value: string; label: string }>;
};
export type ComplexProductMatrix = {
  kind: "two_dimensional_per_sqft"; rowKey: string; columnKey: string;
  rowValues: string[]; columnValues: string[]; cells: Record<string, number>;
};
export type ComplexProductSpecification = {
  kind: "configurable_product"; name: string; category: string; description: string;
  taxable: boolean; requiresDimensions: true; materialForm: "sheet";
  sheet: { widthIn: number; heightIn: number; allowRotation: boolean };
  route: string; minimumChargeCents: number; optionGroups: [ComplexProductOptionGroup, ComplexProductOptionGroup];
  pricing: ComplexProductMatrix; review: { assumptions: string[]; warnings: string[]; blockers: string[]; unsupportedRelationships: string[] };
};

const normalize = (value: string) => value.trim().replace(/\s+/g, " ");
const cellKey = (row: string, column: string) => `${normalize(row)}\u0000${normalize(column)}`;

export function centsFromCurrency(value: string): number {
  const parsed = Number(value.trim().replace(/^\$/, "").replace(/,/g, ""));
  if (!Number.isFinite(parsed) || parsed < 0 || Math.round(parsed * 100) !== parsed * 100) throw new Error(`Invalid non-negative currency value: ${value}`);
  return Math.round(parsed * 100);
}

export function parseTwoDimensionalPricingMatrix(input: string, rowKey: string, columnKey: string): ComplexProductMatrix {
  const lines = input.trim().split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !/^\|?\s*[-:]+/.test(line));
  const rows = lines.map((line) => line.replace(/^\||\|$/g, "").split(line.includes("|") ? "|" : ",").map(normalize));
  if (rows.length < 2 || rows.some((row) => row.length < 2)) throw new Error("A matrix needs one header row and at least one data row.");
  const [header, ...body] = rows; const columns = header.slice(1);
  if (!header[0] || !columns.every(Boolean) || new Set(columns).size !== columns.length) throw new Error("Matrix columns must be unique and non-empty.");
  const rowValues: string[] = []; const cells: Record<string, number> = {};
  for (const row of body) {
    if (row.length !== columns.length + 1 || !row[0]) throw new Error("Every matrix row must provide one value for each column.");
    if (rowValues.includes(row[0])) throw new Error(`Duplicate matrix row value: ${row[0]}`);
    rowValues.push(row[0]);
    columns.forEach((column, index) => { const key = cellKey(row[0], column); if (Object.hasOwn(cells, key)) throw new Error("Duplicate matrix cell."); cells[key] = centsFromCurrency(row[index + 1]); });
  }
  return { kind: "two_dimensional_per_sqft", rowKey, columnKey, rowValues, columnValues: columns, cells };
}

export function validateComplexProductSpecification(spec: ComplexProductSpecification): string[] {
  const errors: string[] = [];
  if (!normalize(spec.name) || !normalize(spec.category)) errors.push("Product name and category are required.");
  if (!Number.isInteger(spec.minimumChargeCents) || spec.minimumChargeCents < 0) errors.push("Minimum charge must be integer cents.");
  if (spec.sheet.widthIn <= 0 || spec.sheet.heightIn <= 0) errors.push("Sheet dimensions must be positive.");
  const keys = new Set<string>();
  for (const group of spec.optionGroups) { if (!group.proposalKey || keys.has(group.proposalKey)) errors.push("Option group keys must be unique."); keys.add(group.proposalKey); const values = group.values.map((value) => normalize(value.value).toLowerCase()); if (!group.values.length || new Set(values).size !== values.length) errors.push(`Option values for ${group.name} must be non-empty and unique.`); }
  const [rowGroup, columnGroup] = spec.optionGroups;
  if (spec.pricing.rowKey !== rowGroup.proposalKey || spec.pricing.columnKey !== columnGroup.proposalKey) errors.push("Matrix dimensions must refer to the two declared option groups.");
  const expectedRows = rowGroup.values.map((value) => value.value); const expectedColumns = columnGroup.values.map((value) => value.value);
  if (JSON.stringify(spec.pricing.rowValues) !== JSON.stringify(expectedRows) || JSON.stringify(spec.pricing.columnValues) !== JSON.stringify(expectedColumns)) errors.push("Matrix order and option-value order must match.");
  for (const row of expectedRows) for (const column of expectedColumns) { const value = spec.pricing.cells[cellKey(row, column)]; if (!Number.isInteger(value) || value < 0) errors.push(`Missing or invalid matrix cell: ${row} × ${column}.`); }
  return errors;
}

export function specificationFingerprint(spec: ComplexProductSpecification): string { return createHash("sha256").update(JSON.stringify(spec)).digest("hex"); }

export function buildCanonicalComplexProductTree(spec: ComplexProductSpecification): Record<string, unknown> {
  const errors = validateComplexProductSpecification(spec); if (errors.length) throw new Error(errors.join(" "));
  const nodes: Record<string, unknown> = {}; const rootNodeIds: string[] = [];
  spec.optionGroups.forEach((group, groupIndex) => { const id = `ai_${group.proposalKey}`; rootNodeIds.push(id); nodes[id] = { id, kind: "question", type: "INPUT", status: "ENABLED", key: group.proposalKey, label: group.name, ui: { sortOrder: groupIndex + 1 }, input: { type: "select", required: true, selectionKey: group.proposalKey, valueType: "ENUM", constraints: { select: { allowEmpty: false } } }, choices: group.values.map((value, index) => ({ id: `${id}_${index + 1}`, value: value.value, label: value.label, sortOrder: index + 1 })) }; });
  const matrix: ProductOptionPricingMatrix = { dimensions: [spec.pricing.rowKey, spec.pricing.columnKey], rows: spec.pricing.rowValues.flatMap((row) => spec.pricing.columnValues.map((column) => ({ id: `matrix_${row}_${column}`.replace(/[^a-z0-9_]/gi, "_"), when: { [spec.pricing.rowKey]: row, [spec.pricing.columnKey]: column }, variables: { base_price: spec.pricing.cells[cellKey(row, column)] } }))) };
  return { schemaVersion: 2, status: "DRAFT", rootNodeIds, nodes, edges: [], pricingMatrix: matrix, meta: { pricingV2: { unitSystem: "imperial", tierBasis: "line_item_quantity", base: { perSqftCents: null, perPieceCents: null, minimumChargeCents: spec.minimumChargeCents } }, requiresDimensions: true, productIntake: { draftRouting: { stationName: spec.route }, sheet: { widthIn: spec.sheet.widthIn, heightIn: spec.sheet.heightIn, materialForm: spec.materialForm, allowRotation: spec.sheet.allowRotation }, complexProductReview: spec.review } } };
}
