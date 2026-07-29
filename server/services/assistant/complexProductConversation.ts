import { complexProductMatrixCellKey, parseTwoDimensionalPricingMatrix, type ComplexProductSpecification } from "./complexProductSpecification";

export type ComplexProductConversationRoute = "configurable" | "standalone" | "pricing" | "clarify" | "ignore";
export function routeComplexProductMessage(message: string): ComplexProductConversationRoute {
  if (/\bseparate\b[\s\S]{0,80}\bproducts?\b/i.test(message)) return "standalone";
  const options = /\b(?:options?|thickness|printed[- ]?sides?)\b/i.test(message);
  const product = /\b(?:PVC|coroplast|banner|sign)\b/i.test(message);
  const one = /\b(?:one|configurable)\b[\s\S]{0,60}\bproduct\b/i.test(message);
  if (options && (one || product || /\bmatrix\b|\|/i.test(message))) return "configurable";
  if (/\b(?:increase|decrease|raise|reduce)\b[\s\S]{0,80}\b(?:price|pricing)\b/i.test(message)) return "pricing";
  return "ignore";
}

function valueList(message: string): string[] {
  const values = Array.from(message.matchAll(/\b(\d+(?:\.\d+)?)\s*mm\b/gi), (match) => `${match[1]}mm`);
  return Array.from(new Set(values)).slice(0, 12);
}

function categoryFromMessage(message: string): string | null {
  const match = message.match(/\b(?:in\s+)?category\s*(?:to|is|:|=)?\s*["â€œ]?([^"â€,.;]{1,100}?)(?=\s+(?:with|and|using|that|which)\b|["â€]?\s*[,.;]|["â€]?\s*$)/i);
  return match?.[1]?.trim() || null;
}

function productNameFromMessage(message: string): string | null {
  const quoted = message.match(/\b(?:named?|name)\s*(?:to|is|:|=)?\s*["“]([^"”]{1,120})["”]/i)?.[1]?.trim();
  if (quoted) return quoted;
  const unquoted = message.match(/\b(?:named?|name)\s*(?:to|is|:|=)?\s*([^,.;]{1,120}?)(?=\s+(?:in\s+category|with|and|using|that|which)\b|\s*[,.;]|\s*$)/i)?.[1]?.trim();
  return unquoted || null;
}

/** Creates a structurally valid, intentionally blocked starting point so one
 * conversation can collect the matrix incrementally without inventing prices. */
export function createInitialComplexProductSpecification(message: string): ComplexProductSpecification {
  const thicknesses = valueList(message);
  const rows = thicknesses.length ? thicknesses : ["3mm", "6mm"];
  const columns = /\b(?:single|double)[- ]?sided\b/i.test(message) || /\bprinted[- ]?sides?\b/i.test(message)
    ? ["single_sided", "double_sided"] : ["single_sided", "double_sided"];
  const cells: Record<string, number> = {};
  for (const row of rows) for (const column of columns) cells[complexProductMatrixCellKey(row, column)] = 0;
  const name = productNameFromMessage(message)
    ?? message.match(/\b(?:named?|name)\s*[:=]?\s*["“]([^"”]{1,120})["”]/i)?.[1]?.trim()
    ?? ( /\bPVC\b/i.test(message) ? "PVC Configurable Product" : "Configurable Product Draft" );
  const specification: ComplexProductSpecification = {
    kind: "configurable_product", name, category: categoryFromMessage(message) ?? (/\bPVC|coroplast\b/i.test(message) ? "Rigid Signs" : "Print Products"),
    description: "Configurable product draft assembled from this conversation.", taxable: true, requiresDimensions: true,
    materialForm: "sheet", sheet: { widthIn: 48, heightIn: 96, allowRotation: false }, route: "Flatbed", minimumChargeCents: 0,
    optionGroups: [
      { proposalKey: "thickness", name: "Thickness", required: true, selectionMode: "single", values: rows.map((value) => ({ value, label: value })) },
      { proposalKey: "printed_sides", name: "Printed sides", required: true, selectionMode: "single", values: columns.map((value) => ({ value, label: value === "single_sided" ? "Single sided" : "Double sided" })) },
    ],
    pricing: { kind: "two_dimensional_per_sqft", rowKey: "thickness", columnKey: "printed_sides", rowValues: rows, columnValues: columns, cells },
    review: { assumptions: ["Sheet size and Flatbed routing use the configurable-product defaults until corrected."], warnings: [], blockers: ["Provide the complete two-dimensional per-square-foot pricing matrix before confirmation."] , unsupportedRelationships: [] },
  };
  return applyComplexProductConversationEdit(specification, message);
}

export function applyComplexProductConversationEdit(current: ComplexProductSpecification, message: string): ComplexProductSpecification {
  const next = structuredClone(current); const source = message.trim();
  const name = productNameFromMessage(source); if (name) next.name = name;
  const category = categoryFromMessage(source); if (category) next.category = category;
  const minimum = source.match(/\bminimum(?:\s+charge)?\s*(?:to|of)?\s*\$?(\d+(?:\.\d{1,2})?)/i); if (minimum) next.minimumChargeCents = Math.round(Number(minimum[1]) * 100);
  const sheet = source.match(/\b(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\b/i); if (sheet) { next.sheet.widthIn = Number(sheet[1]); next.sheet.heightIn = Number(sheet[2]); }
  if (/\brotation\s+(?:allowed|enabled)\b|\ballow\s+rotation\b/i.test(source)) next.sheet.allowRotation = true;
  if (/\brotation\s+(?:disabled|not allowed)\b|\bdo not allow rotation\b/i.test(source)) next.sheet.allowRotation = false;
  if (/\bflatbed\b/i.test(source)) next.route = "Flatbed";
  const matrixStart = source.indexOf("|");
  if (matrixStart >= 0) {
    next.pricing = parseTwoDimensionalPricingMatrix(source.slice(matrixStart), next.pricing.rowKey, next.pricing.columnKey);
    next.optionGroups[0].values = next.pricing.rowValues.map((value) => ({ value, label: value }));
    next.optionGroups[1].values = next.pricing.columnValues.map((value) => ({ value, label: value }));
    next.review.blockers = next.review.blockers.filter((blocker) => !/pricing matrix/i.test(blocker));
  }
  return next;
}
