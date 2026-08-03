import { createHash } from "node:crypto";
import type { ProductOptionPricingMatrix } from "@shared/productOptionPricingMatrix";

export type ComplexProductOptionGroup = {
  proposalKey: string; name: string; required: true; selectionMode: "single";
  values: Array<{ value: string; label: string }>;
};
export type ComplexProductMatrix = {
  /** Legacy per-square-foot envelopes remain valid; per-piece uses the same
   * canonical option matrix and PBV2 base_price rows. */
  kind: "two_dimensional_per_sqft" | "two_dimensional_per_piece" | "two_dimensional_unresolved"; rowKey: string; columnKey: string;
  rowValues: string[]; columnValues: string[]; cells: Record<string, number>;
};
export type ComplexProductSpecification = {
  kind: "configurable_product"; name: string; category: string; description: string;
  /** Production choices are intentionally independent of product definition.
   * Their absence must remain visible rather than being replaced with defaults. */
  taxable: boolean; requiresDimensions?: boolean; measurementMode?: "dimensions_required" | "fixed_size" | "quantity_only"; measurementModeSource?: "explicit" | "inferred"; materialForm?: "sheet";
  sheet?: { widthIn: number; heightIn: number; allowRotation?: boolean };
  route?: string; minimumChargeCents?: number; minimumChargeSource?: "explicit" | "inferred"; optionGroups: [ComplexProductOptionGroup, ComplexProductOptionGroup];
  pricing: ComplexProductMatrix; review: { assumptions: string[]; warnings: string[]; blockers: string[]; unsupportedRelationships: string[] };
  /** Present only when this proposal was created from a persisted Product Intake
   * session. Do not synthesize provenance for a conversation-created draft. */
  productIntakeProvenance?: { sessionId: string; productName: string; confidence: number };
  proposalVersion?: number;
};

const normalize = (value: string) => value.trim().replace(/\s+/g, " ");
/** JSONB-safe, collision-resistant matrix-cell identity. PostgreSQL rejects NUL
 * characters in JSON strings, so an in-memory control-character delimiter must
 * never be used in a persisted proposal. */
export const complexProductMatrixCellKey = (row: string, column: string) => `${encodeURIComponent(normalize(row))}:${encodeURIComponent(normalize(column))}`;

export type ParsedPricingMatrixTable = {
  rowHeader: string;
  rowValues: string[];
  columnValues: string[];
  cells: Record<string, number>;
};

export function centsFromCurrency(value: string): number {
  const normalizedValue = value.trim().replace(/^\$/, "").replace(/,/g, "");
  if (!normalizedValue) throw new Error(`Invalid non-negative currency value: ${value}`);
  const parsed = Number(normalizedValue);
  if (!Number.isFinite(parsed) || parsed < 0 || Math.round(parsed * 100) !== parsed * 100) throw new Error(`Invalid non-negative currency value: ${value}`);
  return Math.round(parsed * 100);
}

function isMarkdownAlignmentRow(cells: string[]): boolean {
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell.trim()));
}

/** Small CSV reader shared by configurable-product and inactive-draft matrix
 * input. It deliberately supports only the RFC4180 quoting needed for a
 * single table row; multiline quoted cells are not meaningful matrix labels. */
function parseDelimitedMatrixRow(line: string, delimiter: "|" | ","): string[] {
  const content = delimiter === "|" ? line.trim().replace(/^\||\|$/g, "") : line.trim();
  const values: string[] = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < content.length; index += 1) {
    const character = content[index]!;
    if (character === '"') {
      if (quoted && content[index + 1] === '"') { value += '"'; index += 1; continue; }
      if (!quoted && value.trim().length > 0) throw new Error("A quoted matrix cell must begin at the start of its cell.");
      quoted = !quoted;
      continue;
    }
    if (character === delimiter && !quoted) { values.push(normalize(value)); value = ""; continue; }
    value += character;
  }
  if (quoted) throw new Error("A matrix row contains an unclosed quoted cell.");
  values.push(normalize(value));
  return values;
}

/** Parse the practical Markdown/CSV table grammar used by configurable
 * products. The result deliberately retains display labels; callers map them
 * to their own canonical option identities rather than guessing semantics. */
export function parsePricingMatrixTable(input: string): ParsedPricingMatrixTable {
  const sourceLines = input.trim().split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const start = sourceLines.findIndex((line, index) => {
    const delimiter = line.includes("|") ? "|" : line.includes(",") ? "," : null;
    return delimiter !== null && index + 1 < sourceLines.length && sourceLines[index + 1]!.includes(delimiter);
  });
  if (start < 0) throw new Error("A matrix table needs one header row and at least one data row.");
  const delimiter: "|" | "," = sourceLines[start]!.includes("|") ? "|" : ",";
  const tableLines: string[] = [];
  for (let index = start; index < sourceLines.length; index += 1) {
    const line = sourceLines[index]!;
    if (!line.includes(delimiter)) break;
    if (delimiter === "," && line.includes("|") && !/^\|.*\|$/.test(line)) throw new Error("A pricing matrix cannot mix CSV and Markdown row separators.");
    tableLines.push(line);
  }
  const rows = tableLines.map((line) => parseDelimitedMatrixRow(line, delimiter)).filter((cells) => !isMarkdownAlignmentRow(cells));
  if (rows.length < 2 || rows.some((row) => row.length < 2)) throw new Error("A matrix needs one header row and at least one data row.");
  const [header, ...body] = rows; const columns = header.slice(1);
  const normalizedColumns = columns.map((column) => column.toLocaleLowerCase());
  if (!header[0] || !columns.every(Boolean) || new Set(normalizedColumns).size !== columns.length) throw new Error("Matrix columns must be unique and non-empty.");
  const rowValues: string[] = []; const cells: Record<string, number> = {};
  for (const row of body) {
    if (row.length !== columns.length + 1 || !row[0]) throw new Error("Every matrix row must provide one value for each column.");
    if (rowValues.some((value) => value.toLocaleLowerCase() === row[0].toLocaleLowerCase())) throw new Error(`Duplicate matrix row value: ${row[0]}`);
    rowValues.push(row[0]);
    columns.forEach((column, index) => { const key = complexProductMatrixCellKey(row[0], column); if (Object.hasOwn(cells, key)) throw new Error("Duplicate matrix cell."); cells[key] = centsFromCurrency(row[index + 1]); });
  }
  return { rowHeader: header[0]!, rowValues, columnValues: columns, cells };
}

export function parseTwoDimensionalPricingMatrix(input: string, rowKey: string, columnKey: string): ComplexProductMatrix {
  const table = parsePricingMatrixTable(input);
  const { rowValues, columnValues: columns, cells } = table;
  return { kind: "two_dimensional_per_sqft", rowKey, columnKey, rowValues, columnValues: columns, cells };
}

export function pricingUnitForComplexProductMatrix(matrix: ComplexProductMatrix): "per_piece" | "per_square_foot" | null {
  if (matrix.kind === "two_dimensional_unresolved") return null;
  return matrix.kind === "two_dimensional_per_piece" ? "per_piece" : "per_square_foot";
}

export const measurementModeQuestion = "Should customers enter width and height, use a fixed size, or only enter a quantity?";

export function measurementModeForComplexProductSpecification(spec: ComplexProductSpecification): "dimensions_required" | "fixed_size" | "quantity_only" | "unresolved" {
  if (spec.measurementMode) return spec.measurementMode;
  if (spec.requiresDimensions === true) return "dimensions_required";
  if (spec.requiresDimensions === false) return "quantity_only";
  return "unresolved";
}

export function validateComplexProductSpecification(spec: ComplexProductSpecification): string[] {
  const errors: string[] = [];
  if (!normalize(spec.name) || !normalize(spec.category)) errors.push("Product name and category are required.");
  if (spec.minimumChargeCents !== undefined && (!Number.isInteger(spec.minimumChargeCents) || spec.minimumChargeCents < 0)) errors.push("Minimum charge must be integer cents.");
  if (spec.sheet && (spec.sheet.widthIn <= 0 || spec.sheet.heightIn <= 0)) errors.push("Sheet dimensions must be positive.");
  if (spec.pricing.kind === "two_dimensional_unresolved") errors.push("Are these prices per piece or per square foot?");
  else if (measurementModeForComplexProductSpecification(spec) === "unresolved") errors.push(measurementModeQuestion);
  const keys = new Set<string>();
  for (const group of spec.optionGroups) { if (!group.proposalKey || keys.has(group.proposalKey)) errors.push("Option group keys must be unique."); keys.add(group.proposalKey); const values = group.values.map((value) => normalize(value.value).toLowerCase()); if (!group.values.length || new Set(values).size !== values.length) errors.push(`Option values for ${group.name} must be non-empty and unique.`); }
  const [rowGroup, columnGroup] = spec.optionGroups;
  if (spec.pricing.rowKey !== rowGroup.proposalKey || spec.pricing.columnKey !== columnGroup.proposalKey) errors.push("Matrix dimensions must refer to the two declared option groups.");
  const expectedRows = rowGroup.values.map((value) => value.value); const expectedColumns = columnGroup.values.map((value) => value.value);
  if (JSON.stringify(spec.pricing.rowValues) !== JSON.stringify(expectedRows) || JSON.stringify(spec.pricing.columnValues) !== JSON.stringify(expectedColumns)) errors.push("Matrix order and option-value order must match.");
  for (const row of expectedRows) for (const column of expectedColumns) { const value = spec.pricing.cells[complexProductMatrixCellKey(row, column)]; if (!Number.isInteger(value) || value < 0) errors.push(`Missing or invalid matrix cell: ${row} × ${column}.`); }
  return errors;
}

export function specificationFingerprint(spec: ComplexProductSpecification): string { return createHash("sha256").update(JSON.stringify(spec)).digest("hex"); }

export function buildCanonicalComplexProductTree(spec: ComplexProductSpecification): Record<string, unknown> {
  const errors = validateComplexProductSpecification(spec); if (errors.length) throw new Error(errors.join(" "));
  const nodes: Record<string, unknown> = {}; const rootNodeIds: string[] = []; const edges: Array<Record<string, unknown>> = [];
  spec.optionGroups.forEach((group, groupIndex) => { const id = `ai_${group.proposalKey}`; const groupId = `ai_group_${group.proposalKey}`; rootNodeIds.push(id); nodes[groupId] = { id: groupId, kind: "group", type: "GROUP", status: "ENABLED", key: `${group.proposalKey}_group`, label: group.name, displayOrder: groupIndex + 1, input: { type: "select", required: true } }; nodes[id] = { id, kind: "question", type: "INPUT", status: "ENABLED", key: group.proposalKey, label: group.name, ui: { sortOrder: groupIndex + 1 }, input: { type: "select", required: true, selectionKey: group.proposalKey, valueType: "ENUM", constraints: { select: { allowEmpty: false } } }, choices: group.values.map((value, index) => ({ id: `${id}_${index + 1}`, value: value.value, label: value.label, sortOrder: index + 1 })) }; edges.push({ id: `ai_edge_${group.proposalKey}`, fromNodeId: groupId, toNodeId: id, status: "DISABLED" }); });
  const matrix: ProductOptionPricingMatrix = { dimensions: [spec.pricing.rowKey, spec.pricing.columnKey], rows: spec.pricing.rowValues.flatMap((row) => spec.pricing.columnValues.map((column) => ({ id: `matrix_${row}_${column}`.replace(/[^a-z0-9_]/gi, "_"), when: { [spec.pricing.rowKey]: row, [spec.pricing.columnKey]: column }, variables: { base_price: spec.pricing.cells[complexProductMatrixCellKey(row, column)] } }))) };
  const pricingUnit = pricingUnitForComplexProductMatrix(spec.pricing);
  if (!pricingUnit) throw new Error("Are these prices per piece or per square foot?");
  const perPiece = pricingUnit === "per_piece";
  const hasSheet = Boolean(spec.sheet);
  const productIntake = {
    ...(spec.productIntakeProvenance ?? {}),
    ...(spec.route ? { draftRouting: { stationName: spec.route } } : {}),
    ...(hasSheet ? { sheet: { widthIn: spec.sheet!.widthIn, heightIn: spec.sheet!.heightIn, materialForm: spec.materialForm ?? "sheet", allowRotation: spec.sheet!.allowRotation ?? false } } : {}),
    complexProductReview: spec.review,
  };
  return { schemaVersion: 2, status: "DRAFT", rootNodeIds, nodes, edges, pricingMatrix: matrix, meta: { pricingProfileKey: perPiece ? "qty_only" : "default", pricingV2: { unitSystem: "imperial", tierBasis: "line_item_quantity", base: { perSqftCents: null, perPieceCents: null, ...(spec.minimumChargeCents === undefined ? {} : { minimumChargeCents: spec.minimumChargeCents }) }, optionMatrixPricingUnit: pricingUnit }, requiresDimensions: measurementModeForComplexProductSpecification(spec) === "dimensions_required", productIntake } };
}
