import { createHash } from "node:crypto";

export const productInactiveDraftBatchMaxSize = 25;

export type ProductDraftBatchRowStatus = "ready" | "clarification" | "unsupported" | "duplicate" | "invalid";
export type ProductDraftBatchRow = {
  rowNumber: number;
  productName: string;
  description: string;
  status: ProductDraftBatchRowStatus;
  reasons: string[];
  provenance: { name: "row"; description: "row" | "shared" };
};

export type ProductDraftBatchParseResult = {
  rows: ProductDraftBatchRow[];
  sharedDefaults: string[];
  errors: string[];
};

/** Normalization is deliberately conservative: it is used only to identify a
 * collision that must be reviewed, never to rename a product. */
export function normalizeProductDraftBatchName(value: string): string {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

function cells(line: string): string[] {
  return line.trim().replace(/^\||\|$/g, "").split("|").map((value) => value.trim());
}

function isDivider(line: string): boolean { return /^\s*\|?\s*:?-{2,}/.test(line); }
function splitCsv(line: string): string[] {
  const out: string[] = []; let cell = ""; let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') { quoted = !quoted; continue; }
    if (character === "," && !quoted) { out.push(cell.trim()); cell = ""; continue; }
    cell += character;
  }
  out.push(cell.trim());
  return out;
}

/** Parses deliberately simple paste formats. It does not accept spreadsheet
 * files, formulas, or implicit columns, which keeps the confirmation preview
 * explainable and safe. */
export function parseProductInactiveDraftBatch(source: string): ProductDraftBatchParseResult {
  const lines = source.replace(/\r/g, "").split("\n").map((line) => line.trim()).filter(Boolean);
  const errors: string[] = [];
  const table = lines.filter((line) => line.includes("|"));
  const csv = table.length === 0 ? lines.filter((line) => line.includes(",")) : [];
  let rawRows: Array<{ name: string; description: string }> = [];
  if (table.length >= 2) {
    const header = cells(table[0]).map((value) => value.toLowerCase());
    const nameIndex = header.findIndex((value) => /^(product )?name$/.test(value));
    const descriptionIndex = header.findIndex((value) => /description|details?|spec/.test(value));
    if (nameIndex < 0) errors.push("A table must include a Name column.");
    else rawRows = table.slice(1).filter((line) => !isDivider(line)).map((line) => {
      const row = cells(line); return { name: row[nameIndex] ?? "", description: row[descriptionIndex] ?? row.filter((_, index) => index !== nameIndex).join("; ") };
    });
  } else if (csv.length >= 2) {
    const header = splitCsv(csv[0]).map((value) => value.toLowerCase());
    const nameIndex = header.findIndex((value) => /^(product )?name$/.test(value));
    const descriptionIndex = header.findIndex((value) => /description|details?|spec/.test(value));
    if (nameIndex < 0) errors.push("CSV input must include a Name column.");
    else rawRows = csv.slice(1).map((line) => { const row = splitCsv(line); return { name: row[nameIndex] ?? "", description: row[descriptionIndex] ?? row.filter((_, index) => index !== nameIndex).join("; ") }; });
  } else {
    rawRows = lines.map((line) => ({ name: line.replace(/^(?:[-*]|\d+[.)])\s*/, "").split(/\s+[-:â€”]\s+/, 2)[0].trim(), description: line.replace(/^(?:[-*]|\d+[.)])\s*/, "") }));
  }
  if (rawRows.length > productInactiveDraftBatchMaxSize) errors.push(`A batch may contain at most ${productInactiveDraftBatchMaxSize} products; no rows were truncated.`);
  const seen = new Set<string>();
  const rows = rawRows.map(({ name, description }, offset): ProductDraftBatchRow => {
    const cleanName = name.trim().slice(0, 255); const reasons: string[] = [];
    let status: ProductDraftBatchRowStatus = "ready";
    if (!cleanName) { status = "clarification"; reasons.push("Product name is required."); }
    else if (!description.trim()) { status = "clarification"; reasons.push("A product description or specification is required."); }
    else if (/\b(?:activate|publish|replace existing|overwrite)\b/i.test(description)) { status = "unsupported"; reasons.push("Activation, publication, and overwrite instructions are not supported in batch intake."); }
    const normalized = normalizeProductDraftBatchName(cleanName);
    if (normalized && seen.has(normalized)) { status = "duplicate"; reasons.push("Duplicate normalized product name within this batch."); }
    seen.add(normalized);
    return { rowNumber: offset + 1, productName: cleanName, description: description.trim().slice(0, 8_000), status, reasons, provenance: { name: "row", description: "row" } };
  });
  if (errors.length) rows.forEach((row) => { if (row.status === "ready") { row.status = "invalid"; row.reasons.push(errors[0]); } });
  return { rows, sharedDefaults: [], errors };
}

export function applyProductDraftBatchCollisions(rows: ProductDraftBatchRow[], existingNames: readonly string[]): ProductDraftBatchRow[] {
  const names = new Set(existingNames.map(normalizeProductDraftBatchName));
  return rows.map((row) => names.has(normalizeProductDraftBatchName(row.productName))
    ? { ...row, status: "duplicate", reasons: [...row.reasons, "Matches an existing product name in this organization."] }
    : row);
}

export function fingerprintProductInactiveDraftBatch(rows: readonly { rowNumber: number; productName: string; intakeSessionId: string; proposalFingerprint: string }[]): string {
  return createHash("sha256").update(JSON.stringify(rows.map((row) => ({ ...row, productName: normalizeProductDraftBatchName(row.productName) })))).digest("hex");
}
