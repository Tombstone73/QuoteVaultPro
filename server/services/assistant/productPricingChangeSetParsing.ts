import type { ProductPricingOperation, ProductPricingScalarField } from "./productPricingChangeSetService";

export type PricingChangeRequest = {
  selector: Record<string, unknown>;
  operation: ProductPricingOperation;
  overrides: Array<{ productName: string; operation: ProductPricingOperation }>;
};

function cents(raw: string): number | null {
  const value = Number(raw.replace(/[$,]/g, ""));
  if (!Number.isFinite(value) || value < 0 || Math.round(value * 100) !== value * 100) return null;
  return Math.round(value * 100);
}

function fieldFromMessage(message: string): ProductPricingScalarField | null {
  if (/\bminimum\s+charge\b/i.test(message)) return "minimumChargeCents";
  if (/\b(?:per[- ]?piece|piece\s+(?:price|pricing|rate))\b/i.test(message)) return "perPieceCents";
  if (/\b(?:per\s+(?:square\s*)?foot|square[- ]?foot|sq\.?\s*ft\.?|sqft)\b/i.test(message)) return "perSqftCents";
  return null;
}

/** Deterministic parser for the small scalar-pricing grammar. It deliberately
 * returns null when a component or an amount could be interpreted two ways. */
export function pricingChangeRequestFromMessage(message: string): PricingChangeRequest | null {
  const normalized = message.trim();
  if (!/\b(?:price|pricing|rate|charge|square|sq\.?\s*ft|piece)\b/i.test(normalized)) return null;
  const field = fieldFromMessage(normalized);
  if (!field) return null;
  const selector: Record<string, unknown> = {
    active: !/\b(?:inactive|draft)\b/i.test(normalized),
    ...( /\bflatbed\b/i.test(normalized) ? { route: "Flatbed" } : {}),
    ...( /\broll\b/i.test(normalized) ? { route: "Roll" } : {}),
    ...( /\b(?:sold|priced)\s+by\s+(?:square\s*foot|sq\.?\s*ft\.?|sqft)\b/i.test(normalized) ? { measurementMode: "dimensions_required" } : {}),
  };
  const exactIds = Array.from(
    normalized.matchAll(/\b[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}\b/ig),
    (match) => match[0],
  );
  if (exactIds.length) selector.productIds = Array.from(new Set(exactIds));
  const names = Array.from(
    normalized.matchAll(/["']([^"']+)["']/g),
    (match) => match[1].trim(),
  ).filter(Boolean);
  if (names.length) selector.productNames = Array.from(new Set(names));
  const excluded = normalized.match(/\bexcept\s+["']([^"']+)["']/i)?.[1]?.trim();
  if (excluded) selector.excludeProductNames = [excluded];

  let operation: ProductPricingOperation | null = null;
  const clear = /\bclear\s+(?:the\s+)?minimum\s+charge\b/i.test(normalized);
  const set = normalized.match(/\bset\b[\s\S]{0,45}?\bto\s+\$?(\d+(?:\.\d{1,2})?)/i);
  const percent = normalized.match(/\b(?:increase|raise|add|decrease|reduce|subtract)\b[\s\S]{0,70}?\b(\d+(?:\.\d+)?)\s*%/i);
  const fixed = normalized.match(/\b(?:increase|raise|add|decrease|reduce|subtract)\b[\s\S]{0,70}?\$(\d+(?:\.\d{1,2})?)/i);
  if (clear) {
    if (field !== "minimumChargeCents") return null;
    operation = { kind: "set", field, cents: null };
  } else if (set) {
    const value = cents(set[1]); if (value == null) return null;
    operation = { kind: "set", field, cents: value };
  } else if (percent) {
    const value = Number(percent[1]); if (!Number.isFinite(value) || value <= 0 || value > 1000) return null;
    operation = { kind: "percent", field, percent: /\b(?:decrease|reduce|subtract)\b/i.test(percent[0]) ? -value : value };
  } else if (fixed) {
    const value = cents(fixed[1]); if (value == null || value === 0) return null;
    operation = { kind: "fixed", field, cents: /\b(?:decrease|reduce|subtract)\b/i.test(fixed[0]) ? -value : value };
  }
  if (!operation) return null;

  const overrides = Array.from(normalized.matchAll(/\bexcept\s+["']([^"']+)["']\s+(?:should\s+)?(?:increase|raise)\s+(?:by\s+)?(\d+(?:\.\d+)?)\s*%/ig))
    .map((match) => ({ productName: match[1].trim(), operation: { kind: "percent", field, percent: Number(match[2]) } as ProductPricingOperation }))
    .filter((override) => override.productName && override.operation.kind === "percent" && Number.isFinite(override.operation.percent));
  return { selector, operation, overrides };
}
