import { resolveSavedLineItemOptions } from "./lineItemOptionSelections";

export type DocumentSourceLine = {
  id?: string | null;
  orderLineItemId?: string | null;
  parentLineItemId?: string | null;
  displayOrder?: number | null;
  sortOrder?: number | null;
  product?: { name?: string | null } | null;
  productName?: string | null;
  name?: string | null;
  description?: string | null;
  width?: string | number | null;
  height?: string | number | null;
  specsJson?: unknown;
  optionSelectionsJson?: unknown;
  pbv2SnapshotJson?: unknown;
  selectedOptions?: unknown;
  materialUsages?: unknown;
  materialUsageJson?: unknown;
  productionNotes?: string | null;
};

export type DocumentLinePresentation<T> = {
  line: T;
  depth: number;
  name: string;
  description: string | null;
  dimensions: string | null;
  customerOptions: string[];
  productionOptions: string[];
  material: string | null;
  productionNotes: string | null;
};

export type DocumentLineGroup<T> = { rows: Array<DocumentLinePresentation<T>> };

const record = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const text = (value: unknown): string => typeof value === "string" ? value.trim() : "";
const number = (value: unknown): number | null => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};
const idLike = (value: string): boolean => /^[0-9a-f]{8}-[0-9a-f-]{20,}$/i.test(value) || /^node[_-]?[0-9a-f]{8,}$/i.test(value);
const omittedValue = (value: string): boolean => /^(?:no|none|false|off|not selected|n\/a)$/i.test(value);
const internalLabel = (value: string): boolean => /\b(?:internal|cost|margin|machine|printer|routing|labor|waste)\b/i.test(value);
const bogusZeroSize = (value: string): boolean => /^0(?:\.0+)?\s*(?:in|\")?\s*[×x]\s*0(?:\.0+)?\s*(?:in|\")?$/i.test(value);

function savedOptions(line: DocumentSourceLine): { customer: string[]; production: string[] } {
  const snapshot = record(line.pbv2SnapshotJson);
  const tree = record(snapshot?.treeJson);
  const options = resolveSavedLineItemOptions(line, tree as any, { includeDefaults: false });
  const production: string[] = [];
  const customer: string[] = [];
  const seen = new Set<string>();
  for (const option of options) {
    if (option.source !== "saved") continue;
    const label = text(option.optionLabel);
    const value = text(option.selectedLabel);
    if (!label || !value || idLike(label) || idLike(value) || omittedValue(value)) continue;
    const display = `${label}: ${value}`;
    const key = display.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    production.push(display);
    if (!internalLabel(label)) customer.push(display);
  }
  return { customer, production };
}

function savedMaterial(line: DocumentSourceLine): string | null {
  const rows = [line.materialUsages, line.materialUsageJson].flatMap((value) => Array.isArray(value) ? value : []);
  const names = rows.map((value) => {
    const usage = record(value);
    return text(usage?.materialName) || text(usage?.materialLabel) || text(usage?.name);
  }).filter(Boolean);
  return names.length ? Array.from(new Set(names)).join(", ") : null;
}

function present<T extends DocumentSourceLine>(line: T, depth: number): DocumentLinePresentation<T> {
  const specs = record(line.specsJson);
  const longDescription = text(record(specs?.lineItemNotes)?.descLong);
  const name = text(line.productName) || text(line.product?.name) || text(line.name) || text(line.description) || "Line item";
  const description = text(line.description);
  const descriptionParts = [description, longDescription].filter((value, index, values) =>
    value && value !== name && !bogusZeroSize(value) && values.indexOf(value) === index);
  const width = number(line.width);
  const height = number(line.height);
  const dimensions = width !== null && height !== null ? `${width} x ${height} in` : null;
  const options = savedOptions(line);
  return {
    line, depth, name, description: descriptionParts.join("\n") || null, dimensions,
    customerOptions: options.customer, productionOptions: options.production,
    material: savedMaterial(line), productionNotes: text(line.productionNotes) || null,
  };
}

/** Saved IDs alone establish parentage. Ambiguous, missing, and cyclic links remain standalone. */
export function projectDocumentLineGroups<T extends DocumentSourceLine>(
  lines: readonly T[], identity: "order" | "invoice",
): Array<DocumentLineGroup<T>> {
  const ordered = lines.map((line, index) => ({ line, index })).sort((a, b) =>
    (a.line.displayOrder ?? a.line.sortOrder ?? a.index) - (b.line.displayOrder ?? b.line.sortOrder ?? b.index)
      || a.index - b.index,
  ).map(({ line }) => line);
  const byId = new Map<string, T | null>();
  for (const line of ordered) {
    const id = identity === "invoice" ? text(line.orderLineItemId) : text(line.id);
    if (id) byId.set(id, byId.has(id) ? null : line);
  }
  const parentOf = (line: T): T | null => {
    const parent = byId.get(text(line.parentLineItemId)) ?? null;
    if (!parent || parent === line) return null;
    const visited = new Set<T>([line]);
    let cursor: T | null = parent;
    while (cursor) {
      if (visited.has(cursor)) return null;
      visited.add(cursor);
      cursor = byId.get(text(cursor.parentLineItemId)) ?? null;
    }
    return parent;
  };
  const children = new Map<T, T[]>();
  for (const line of ordered) {
    const parent = parentOf(line);
    if (parent) children.set(parent, [...(children.get(parent) ?? []), line]);
  }
  const groups: Array<DocumentLineGroup<T>> = [];
  const append = (line: T, depth: number, rows: Array<DocumentLinePresentation<T>>) => {
    rows.push(present(line, depth));
    for (const child of children.get(line) ?? []) append(child, depth + 1, rows);
  };
  for (const line of ordered) {
    if (parentOf(line)) continue;
    const rows: Array<DocumentLinePresentation<T>> = [];
    append(line, 0, rows);
    groups.push({ rows });
  }
  return groups;
}
