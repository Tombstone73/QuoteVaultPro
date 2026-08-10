import { complexProductMatrixCellKey, parsePricingMatrixTable } from "./complexProductSpecification";
import type { InactivePbv2PricingMatrixReplacement } from "./inactivePbv2PricingMatrixEditService";

type JsonRecord = Record<string, unknown>;

const normalize = (value: string) => value.trim().replace(/\s+/g, " ").toLocaleLowerCase();
const asRecord = (value: unknown): JsonRecord | null => value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : null;
const clone = <T>(value: T): T => {
  const structured = globalThis.structuredClone as ((input: T) => T) | undefined;
  return structured ? structured(value) : JSON.parse(JSON.stringify(value)) as T;
};

type DimensionChoice = { value: unknown; text: string };
type Dimension = { key: string; label: string; choices: DimensionChoice[] };

function matchingValue(value: string, choices: DimensionChoice[], kind: "row" | "column"): unknown {
  const matches = Array.from(new Map(choices
    .filter((choice) => normalize(choice.text) === normalize(value))
    .map((choice) => [JSON.stringify(choice.value), choice.value])).values());
  if (!matches.length) throw new Error(`The ${kind} label \"${value}\" is not a choice on the bound PBV2 DRAFT.`);
  if (matches.length > 1) throw new Error(`The ${kind} label \"${value}\" is ambiguous on the bound PBV2 DRAFT.`);
  return matches[0]!;
}

function readDimensions(treeJson: JsonRecord, dimensions: string[]): Dimension[] {
  const rawNodes = treeJson.nodes;
  const nodes = Array.isArray(rawNodes) ? rawNodes : Object.values(asRecord(rawNodes) ?? {});
  const byKey = new Map<string, Dimension>();
  for (const node of nodes) {
    const record = asRecord(node);
    if (!record) continue;
    const input = asRecord(record.input) ?? asRecord(record.data);
    const key = typeof input?.selectionKey === "string" ? input.selectionKey : null;
    if (!key || !dimensions.includes(key)) continue;
    const choices = Array.isArray(record.choices) ? record.choices.flatMap((choice) => {
      const choiceRecord = asRecord(choice);
      if (!choiceRecord || !Object.hasOwn(choiceRecord, "value")) return [];
      const value = choiceRecord.value;
      const label = typeof choiceRecord.label === "string" ? choiceRecord.label : String(value);
      return [{ value, text: label }, { value, text: String(value) }];
    }) : [];
    if (!choices.length) throw new Error(`The PBV2 matrix dimension \"${key}\" has no explicit choices.`);
    byKey.set(key, { key, label: typeof record.label === "string" ? record.label : key, choices });
  }
  const result = dimensions.map((key) => byKey.get(key));
  if (result.some((dimension) => !dimension)) throw new Error("Every pricing matrix dimension must have an explicit PBV2 INPUT and choices.");
  return result as Dimension[];
}

function matrixAt(treeJson: JsonRecord): InactivePbv2PricingMatrixReplacement {
  const topLevel = treeJson.pricingMatrix;
  const nested = asRecord(treeJson.meta)?.pricingMatrix;
  const value = topLevel ?? nested;
  const matrix = asRecord(value);
  if (!matrix || !Array.isArray(matrix.dimensions) || !Array.isArray(matrix.rows)) throw new Error("The bound PBV2 DRAFT has no supported pricing matrix to replace.");
  if (!matrix.dimensions.every((dimension) => typeof dimension === "string") || !matrix.rows.every((row) => asRecord(row))) throw new Error("The bound PBV2 pricing matrix is malformed.");
  return clone(matrix) as InactivePbv2PricingMatrixReplacement;
}

function matchForRow(row: JsonRecord): JsonRecord | null {
  for (const key of ["when", "match", "combination"]) {
    const match = asRecord(row[key]);
    if (match) return match;
  }
  return null;
}

/**
 * Converts a two-dimensional Markdown/CSV price table to the existing PBV2
 * replacement contract. It only maps labels already present in the exact
 * bound DRAFT and copies each existing row as a template, so table syntax
 * cannot invent a dimension, option choice, pricing unit, or tier behavior.
 */
export function matrixReplacementFromTable(input: string, treeJson: JsonRecord): InactivePbv2PricingMatrixReplacement {
  const table = parsePricingMatrixTable(input);
  const existing = matrixAt(treeJson);
  if (existing.dimensions.length !== 2) throw new Error("Markdown and CSV matrix replacement currently requires an exact two-dimensional PBV2 matrix; use JSON for other matrix shapes.");
  const dimensions = readDimensions(treeJson, existing.dimensions);
  const rowHeaderMatches = dimensions.filter((dimension) => normalize(dimension.label) === normalize(table.rowHeader) || normalize(dimension.key) === normalize(table.rowHeader));
  if (!rowHeaderMatches.length) throw new Error(`The table row header \"${table.rowHeader}\" does not identify a bound PBV2 matrix dimension.`);
  if (rowHeaderMatches.length > 1) throw new Error(`The table row header \"${table.rowHeader}\" is ambiguous between PBV2 matrix dimensions.`);
  const rowDimension = rowHeaderMatches[0]!;
  const columnDimension = dimensions.find((dimension) => dimension.key !== rowDimension.key)!;
  const rowValues = table.rowValues.map((label) => matchingValue(label, rowDimension.choices, "row"));
  const columnValues = table.columnValues.map((label) => matchingValue(label, columnDimension.choices, "column"));
  if (new Set(rowValues.map((value) => JSON.stringify(value))).size !== rowValues.length) throw new Error("The table repeats a PBV2 matrix row choice.");
  if (new Set(columnValues.map((value) => JSON.stringify(value))).size !== columnValues.length) throw new Error("The table repeats a PBV2 matrix column choice.");

  const existingRows = new Map<string, JsonRecord>();
  for (const sourceRow of existing.rows) {
    const record = asRecord(sourceRow)!;
    const match = matchForRow(record);
    if (!match) throw new Error("The bound PBV2 pricing matrix has a row without a supported option combination.");
    const key = complexProductMatrixCellKey(String(match[rowDimension.key]), String(match[columnDimension.key]));
    if (existingRows.has(key)) throw new Error("The bound PBV2 pricing matrix has duplicate option combinations.");
    existingRows.set(key, record);
  }

  const rows = table.rowValues.flatMap((rowLabel, rowIndex) => table.columnValues.map((columnLabel, columnIndex) => {
    const rowValue = rowValues[rowIndex]!;
    const columnValue = columnValues[columnIndex]!;
    const key = complexProductMatrixCellKey(String(rowValue), String(columnValue));
    const sourceRow = existingRows.get(key);
    if (!sourceRow) throw new Error(`The bound PBV2 pricing matrix has no existing cell for ${rowLabel} / ${columnLabel}; use JSON for an explicit structural matrix change.`);
    const variables = asRecord(sourceRow.variables);
    if (!variables || !Object.hasOwn(variables, "base_price")) throw new Error(`The ${rowLabel} / ${columnLabel} cell is not a scalar base-price cell; use JSON for its explicit pricing structure.`);
    return { ...clone(sourceRow), variables: { ...clone(variables), base_price: table.cells[complexProductMatrixCellKey(rowLabel, columnLabel)]! } };
  }));

  return { ...(existing.id ? { id: existing.id } : {}), dimensions: clone(existing.dimensions), rows };
}
