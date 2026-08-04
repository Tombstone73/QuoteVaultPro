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
  sharedDefaults: Record<string, { value: string | boolean | number; source: "shared_default" }>;
  errors: string[];
};

export type ProductIntakeRoutingDecision = "single" | "batch" | "ambiguous";

function hasDelimitedBatchRows(source: string): boolean {
  const lines = source.replace(/\r/g, "").split("\n").map((line) => line.trim()).filter(Boolean);
  const tableRows = lines.filter((line) => line.includes("|"));
  if (tableRows.length >= 3 && /(?:^|\|)\s*(?:product\s+)?name\s*(?:\||$)/i.test(tableRows[0]!)) return true;
  const csvRows = lines.filter((line) => line.includes(","));
  return csvRows.length >= 3 && /(?:^|,)\s*(?:product\s+)?name\s*(?:,|$)/i.test(csvRows[0]!);
}

function explicitProductNames(source: string): string[] {
  return Array.from(source.matchAll(/\b(?:product\s+(?:called|named)|(?:create|add|make)\s+(?:a\s+)?(?:new\s+)?(?:inactive\s+)?product\s+(?:called|named))\s+["']?([^\n."']{2,255})/gi))
    .map((match) => match[1]!.trim())
    .filter(Boolean);
}

function structuredListRowCount(source: string): number {
  return source.replace(/\r/g, "").split("\n").filter((line) =>
    /^\s*(?:[-*]|\d+[.)])\s+\S.+\s[-:]\s+\S/.test(line),
  ).length;
}

/** Routes before any intake session is created. Newlines and option-value
 * bullets are intentionally not evidence of multiple products. */
export function classifyProductIntakeRouting(source: string): ProductIntakeRoutingDecision {
  const explicitNames = explicitProductNames(source);
  if (explicitNames.length === 1) return "single";
  if (explicitNames.length > 1 || hasDelimitedBatchRows(source)) return "batch";
  const numberedProductRecords = (source.match(/^\s*\d+[.)]\s*(?:product\s*(?:name)?\s*[:=-]|(?:create|add)\s+(?:a\s+)?(?:new\s+)?(?:inactive\s+)?product\s+(?:called|named)\b)/gim) ?? []).length;
  if (numberedProductRecords >= 2) return "batch";
  const productsHeading = /^\s*products?\s*:\s*$/im.test(source);
  const routingRowCount = structuredListRowCount(source);
  const explicitBatch = /\b(?:create|build|add|make)\s+(?:these\s+)?(?:\d+|multiple|several|a\s+list\s+of)\s+(?:new\s+)?products?\b|\bbatch\s+(?:of\s+)?products?\b/i.test(source);
  if (explicitBatch && routingRowCount >= 2) return "batch";
  if (explicitBatch) return "ambiguous";
  return productsHeading && routingRowCount >= 2 ? "batch" : "single";
}

function looksLikeConfigurationProse(value: string): boolean {
  return /^(?:use|set|add|remove|price|customers?|customer|do\s+not|don't|show|confirm|none|gloss|matte|single[-\s]?select|required|optional|category|routing|route|sheet|rotation|minimum|width|height)\b/i.test(value.trim());
}

function sharedDefaultsFrom(lines: string[]): Record<string, { value: string | boolean | number; source: "shared_default" }> {
  const source = lines.join("\n"); const found: Record<string, { value: string | boolean | number; source: "shared_default" }> = {};
  const set = (key: string, value: string | boolean | number) => { found[key] = { value, source: "shared_default" }; };
  const category = source.match(/\bcategory\s*:\s*([^\n*]{1,100})/i); if (category) set("category", category[1].trim());
  if (/\b(?:sold by|per)\s+(?:square\s*foot|sq\s*ft)\b/i.test(source)) set("pricingModel", "per_sqft");
  if (/\ball\s+products?\s+(?:use|route to)|\broute\s+to\s+flatbed\b/i.test(source) && /\bflatbed\b/i.test(source)) set("route", "Flatbed");
  if (/\ballow\s+rotation\b/i.test(source)) set("allowRotation", true);
  const sheet = source.match(/\b(\d{1,3}(?:\.\d+)?)\s*[x×]\s*(\d{1,3}(?:\.\d+)?)\s*sheets?\b/i); if (sheet) set("sheetSize", `${sheet[1]}x${sheet[2]}`);
  const minimum = source.match(/\bminimum(?:\s+charge)?\s*(?:is|:)?\s*\$([0-9]+(?:\.[0-9]{1,2})?)/i); if (minimum) set("minimumChargeCents", Math.round(Number(minimum[1]) * 100));
  if (/\bcontour\s+cutting\b/i.test(source)) set("options", "Contour cutting");
  return found;
}

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
  const originalLines = source.replace(/\r/g, "").split("\n").map((line) => line.trim()).filter(Boolean);
  const sharedStart = originalLines.findIndex((line) => /^shared\s+settings?\s*:?$/i.test(line));
  const productsStart = originalLines.findIndex((line) => /^products?\s*:?$/i.test(line));
  const sharedLines = sharedStart >= 0 ? originalLines.slice(sharedStart + 1, productsStart > sharedStart ? productsStart : undefined) : originalLines.filter((line) => /\b(?:all products?|every row|unless specified otherwise)\b/i.test(line));
  const sharedDefaults = sharedDefaultsFrom(sharedLines);
  const lines = productsStart >= 0 ? originalLines.slice(productsStart + 1) : originalLines.filter((line) => !sharedLines.includes(line) && !/^shared\s+settings?\s*:?$/i.test(line));
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
    else if (looksLikeConfigurationProse(cleanName)) { status = "clarification"; reasons.push("Each batch row needs a product identity, not a configuration instruction or option value."); }
    else if (!description.trim()) { status = "clarification"; reasons.push("A product description or specification is required."); }
    else if (/\b(?:activate|publish|replace existing|overwrite)\b/i.test(description)) { status = "unsupported"; reasons.push("Activation, publication, and overwrite instructions are not supported in batch intake."); }
    const normalized = normalizeProductDraftBatchName(cleanName);
    if (normalized && seen.has(normalized)) { status = "duplicate"; reasons.push("Duplicate normalized product name within this batch."); }
    seen.add(normalized);
    const inherited = Object.keys(sharedDefaults).length > 0;
    return { rowNumber: offset + 1, productName: cleanName, description: `${description.trim()}${inherited ? `\nShared settings: ${Object.entries(sharedDefaults).map(([key, item]) => `${key}=${item.value}`).join("; ")}` : ""}`.slice(0, 8_000), status, reasons, provenance: { name: "row", description: inherited ? "shared" : "row" } };
  });
  if (errors.length) rows.forEach((row) => { if (row.status === "ready") { row.status = "invalid"; row.reasons.push(errors[0]); } });
  return { rows, sharedDefaults, errors };
}

export function applyProductDraftBatchCollisions(rows: ProductDraftBatchRow[], existingNames: readonly string[]): ProductDraftBatchRow[] {
  const names = new Set(existingNames.map(normalizeProductDraftBatchName));
  return rows.map((row) => names.has(normalizeProductDraftBatchName(row.productName))
    ? { ...row, status: "duplicate", reasons: [...row.reasons, "Matches an existing product name in this organization."] }
    : row);
}

export function fingerprintProductInactiveDraftBatch(rows: readonly { rowNumber: number; productName: string; intakeSessionId: string; proposalFingerprint: string }[], sharedDefaults: Record<string, unknown> = {}): string {
  return createHash("sha256").update(JSON.stringify({ sharedDefaults, rows: rows.map((row) => ({ ...row, productName: normalizeProductDraftBatchName(row.productName) })) })).digest("hex");
}
