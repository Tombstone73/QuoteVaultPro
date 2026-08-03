import { complexProductMatrixCellKey, parseTwoDimensionalPricingMatrix, type ComplexProductSpecification } from "./complexProductSpecification";

export const pricingUnitQuestion = "Are these prices per piece or per square foot?";

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
  const called = message.match(/\bcalled\s+([^,.;]{1,120}?)(?=\s+(?:in\s+category|with|and|using|that|which|it\s+has)\b|\s*[,.;]|\s*$)/i)?.[1]?.trim();
  if (called) return called;
  const quoted = message.match(/\b(?:named?|name)\s*(?:to|is|:|=)?\s*["“]([^"”]{1,120})["”]/i)?.[1]?.trim();
  if (quoted) return quoted;
  const unquoted = message.match(/\b(?:named?|name)\s*(?:to|is|:|=)?\s*([^,.;]{1,120}?)(?=\s+(?:in\s+category|with|and|using|that|which)\b|\s*[,.;]|\s*$)/i)?.[1]?.trim();
  return unquoted || null;
}

/** Accept the ordinary prose form "prices are $12 single-sided and $18
 * double-sided for 3mm ..." without converting a supplied price to a
 * placeholder.  A partial axis is deliberately rejected by returning null. */
function namedThicknessPrices(message: string): Array<{ row: string; single: number; double: number }> | null {
  const values: Array<{ row: string; single: number; double: number }> = [];
  const expression = /\$(\d+(?:\.\d{1,2})?)\s*single[-\s]?sided\s+and\s*\$(\d+(?:\.\d{1,2})?)\s*double[-\s]?sided\s+for\s+(\d+(?:\.\d+)?)\s*mm/gi;
  values.push(...Array.from(message.matchAll(expression), (match) => ({ row: `${match[3]}mm`, single: Math.round(Number(match[1]) * 100), double: Math.round(Number(match[2]) * 100) })));
  return values.length >= 2 ? values : null;
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
    description: "Configurable product draft assembled from this conversation.", taxable: true, requiresDimensions: false,
    minimumChargeCents: 0,
    optionGroups: [
      { proposalKey: "thickness", name: "Thickness", required: true, selectionMode: "single", values: rows.map((value) => ({ value, label: value })) },
      { proposalKey: "printed_sides", name: "Printed sides", required: true, selectionMode: "single", values: columns.map((value) => ({ value, label: value === "single_sided" ? "Single sided" : "Double sided" })) },
    ],
    pricing: { kind: "two_dimensional_unresolved", rowKey: "thickness", columnKey: "printed_sides", rowValues: rows, columnValues: columns, cells },
    review: { assumptions: [], warnings: [], blockers: ["Provide the complete two-dimensional pricing matrix before confirmation."] , unsupportedRelationships: [] },
  };
  return applyComplexProductConversationEdit(specification, message);
}

export function applyComplexProductConversationEdit(current: ComplexProductSpecification, message: string): ComplexProductSpecification {
  const next = structuredClone(current); const source = message.trim();
  const name = productNameFromMessage(source); if (name) next.name = name;
  const category = categoryFromMessage(source); if (category) next.category = category;
  const minimum = source.match(/\bminimum(?:\s+charge)?\s*(?:to|of)?\s*\$?(\d+(?:\.\d{1,2})?)|\$?(\d+(?:\.\d{1,2})?)\s+minimum(?:\s+charge)?\b/i);
  const minimumAmount = minimum?.[1] ?? minimum?.[2];
  if (minimumAmount) next.minimumChargeCents = Math.round(Number(minimumAmount) * 100);
  const clearProductionConfiguration = /\b(?:do not|don't|without)\b[\s\S]{0,120}\b(?:sheet\s+size|production\s+route|rotation)\b/i.test(source);
  if (clearProductionConfiguration) { next.sheet = undefined; next.route = undefined; next.materialForm = undefined; next.requiresDimensions = false; }
  // Legacy parsers below may receive explicit production settings. Allocate a
  // temporary shell only when such a setting is actually supplied; no default
  // is emitted in the persisted specification otherwise.
  if (!clearProductionConfiguration && /\b(?:\d+(?:\.\d+)?\s*[x×]|rotation|allow\s+rotation|flatbed)\b/i.test(source)) next.sheet ??= { widthIn: 1, heightIn: 1 };
  if (clearProductionConfiguration) {
    if (/\bper[- ]?piece\b/i.test(source)) next.pricing.kind = "two_dimensional_per_piece";
    if (/\bper\s+(?:square\s*(?:foot|feet)|sq\.?\s*ft\.?|sqft)\b/i.test(source)) next.pricing.kind = "two_dimensional_per_sqft";
    next.review.blockers = next.review.blockers.filter((blocker) => blocker !== pricingUnitQuestion);
  }
  const sheet = source.match(/\b(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\b/i); if (sheet) { const suppliedSheet = next.sheet ?? { widthIn: 1, heightIn: 1 }; suppliedSheet.widthIn = Number(sheet[1]); suppliedSheet.heightIn = Number(sheet[2]); next.sheet = suppliedSheet; next.materialForm = "sheet"; }
  if (/\brotation\s+(?:allowed|enabled)\b|\ballow\s+rotation\b/i.test(source) && !clearProductionConfiguration && next.sheet) next.sheet.allowRotation = true;
  if (/\brotation\s+(?:disabled|not allowed)\b|\bdo not allow rotation\b/i.test(source) && !clearProductionConfiguration && next.sheet) next.sheet.allowRotation = false;
  if (/\bflatbed\b/i.test(source) && !clearProductionConfiguration) next.route = "Flatbed";
  if (/\bper[- ]?piece\b/i.test(source)) { next.pricing.kind = "two_dimensional_per_piece"; next.requiresDimensions = false; next.review.blockers = next.review.blockers.filter((blocker) => blocker !== pricingUnitQuestion); }
  if (/\bper\s+(?:square\s*(?:foot|feet)|sq\.?\s*ft\.?|sqft)\b/i.test(source)) { next.pricing.kind = "two_dimensional_per_sqft"; next.review.blockers = next.review.blockers.filter((blocker) => blocker !== pricingUnitQuestion); }
  // A paired price list such as "$12/$18 for 3mm and $16/$22 for 6mm"
  // is a two-dimensional product matrix, never quantity-tier pricing.
  const pairedPrices = Array.from(source.matchAll(/\$?(\d+(?:\.\d{1,2})?)\s*\/\s*\$?(\d+(?:\.\d{1,2})?)\s+for\s+(\d+(?:\.\d+)?)\s*mm/gi));
  if (pairedPrices.length >= 2 && /\b(?:thickness|single[-\s]?sided|double[-\s]?sided|printed[-\s]?sides?)\b/i.test(source)) {
    const rows = pairedPrices.map((match) => `${match[3]}mm`);
    const columns = ["single_sided", "double_sided"];
    const cells: Record<string, number> = {};
    for (const match of pairedPrices) {
      const row = `${match[3]}mm`;
      cells[complexProductMatrixCellKey(row, columns[0])] = Math.round(Number(match[1]) * 100);
      cells[complexProductMatrixCellKey(row, columns[1])] = Math.round(Number(match[2]) * 100);
    }
    next.optionGroups[0].values = rows.map((value) => ({ value, label: value }));
    next.optionGroups[1].values = columns.map((value) => ({ value, label: value === "single_sided" ? "Single-Sided" : "Double-Sided" }));
    next.pricing = { kind: next.pricing.kind, rowKey: "thickness", columnKey: "printed_sides", rowValues: rows, columnValues: columns, cells };
    next.review.blockers = next.review.blockers.filter((blocker) => !/pricing matrix/i.test(blocker));
  }
  const prosePrices = namedThicknessPrices(source);
  if (prosePrices) {
    const rows = prosePrices.map((value) => value.row); const columns = ["single_sided", "double_sided"];
    const cells: Record<string, number> = {};
    for (const value of prosePrices) { cells[complexProductMatrixCellKey(value.row, columns[0])] = value.single; cells[complexProductMatrixCellKey(value.row, columns[1])] = value.double; }
    next.optionGroups[0].values = rows.map((value) => ({ value, label: value }));
    next.optionGroups[1].values = columns.map((value) => ({ value, label: value === "single_sided" ? "Single-Sided" : "Double-Sided" }));
    next.pricing = { kind: next.pricing.kind, rowKey: "thickness", columnKey: "printed_sides", rowValues: rows, columnValues: columns, cells };
    next.review.blockers = next.review.blockers.filter((blocker) => !/pricing matrix/i.test(blocker));
  }
  const matrixStart = source.indexOf("|");
  if (matrixStart >= 0) {
    next.pricing = { ...parseTwoDimensionalPricingMatrix(source.slice(matrixStart), next.pricing.rowKey, next.pricing.columnKey), kind: next.pricing.kind };
    next.optionGroups[0].values = next.pricing.rowValues.map((value) => ({ value, label: value }));
    next.optionGroups[1].values = next.pricing.columnValues.map((value) => ({ value, label: value }));
    next.review.blockers = next.review.blockers.filter((blocker) => !/pricing matrix/i.test(blocker));
  }
  const needsMatrix = next.review.blockers.some((blocker) => /pricing matrix/i.test(blocker));
  if (next.pricing.kind === "two_dimensional_unresolved" && !needsMatrix && !next.review.blockers.includes(pricingUnitQuestion)) next.review.blockers.push(pricingUnitQuestion);
  if (next.pricing.kind !== "two_dimensional_unresolved") next.review.blockers = next.review.blockers.filter((blocker) => blocker !== pricingUnitQuestion);
  return next;
}
