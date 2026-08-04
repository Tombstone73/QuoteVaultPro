import type { InactiveProductDraftPatch } from "./inactiveProductDraftUpdateService";

export type ClonePricingParseResult =
  | { basePricing: NonNullable<InactiveProductDraftPatch["basePricing"]>; error?: never }
  | { basePricing?: never; error: string }
  | null;

function cents(value: string): number | null {
  const number = Number(value.replace(/[$,]/g, ""));
  return Number.isFinite(number) && number >= 0 && number <= 100_000 ? Math.round(number * 100) : null;
}

/** Parses explicit, bounded base-pricing values for an inactive draft update. */
export function pricingPatchFromMessage(message: string): InactiveProductDraftPatch | null {
  const basePricing: NonNullable<InactiveProductDraftPatch["basePricing"]> = {};
  const money = "([0-9]+(?:\\.[0-9]{1,2})?)";
  const minimum = message.match(new RegExp(`(?:minimum\\s+charge|min(?:imum)?\\s+price)\\s*(?:to|at|of|=)?\\s*\\$?${money}`, "i"))
    ?? message.match(new RegExp(`\\$?${money}\\s*(?:minimum\\s+charge|min(?:imum)?\\s+price|minimum)\\b`, "i"));
  const perSqft = message.match(new RegExp(`\\$?${money}\\s*(?:/|per\\s+)(?:square\\s*foot|sq\\s*ft)\\b`, "i"))
    ?? message.match(new RegExp(`(?:per\\s*(?:square\\s*foot|sq\\s*ft)|square\\s*foot\\s*(?:rate|price))\\s*(?:to|at|of|=)?\\s*\\$?${money}`, "i"));
  const perPiece = message.match(new RegExp(`\\$?${money}\\s*(?:/|per\\s+)piece\\b`, "i"))
    ?? message.match(new RegExp(`(?:per\\s*piece|piece\\s*(?:rate|price))\\s*(?:to|at|of|=)?\\s*\\$?${money}`, "i"));
  if (minimum) { const value = cents(minimum[1]); if (value !== null) basePricing.minimumChargeCents = value; }
  if (perSqft) { const value = cents(perSqft[1]); if (value !== null) basePricing.perSqftCents = value; }
  if (perPiece) { const value = cents(perPiece[1]); if (value !== null) basePricing.perPieceCents = value; }
  return Object.keys(basePricing).length ? { basePricing } : null;
}

function currencyAmounts(message: string, patterns: RegExp[]): number[] {
  const values = new Set<number>();
  for (const pattern of patterns) {
    for (const match of Array.from(message.matchAll(pattern))) {
      const value = cents(match[1]);
      if (value !== null) values.add(value);
    }
  }
  return Array.from(values);
}

/** Clone requests must bind an explicit currency token to one pricing field.
 * Unlike generic draft edits, clone names often contain dates, IDs, and words
 * such as "Minimum Charge"; none of that text may supply an amount. */
export function clonePricingPatchFromMessage(message: string): ClonePricingParseResult {
  const amount = "([0-9]+(?:\\.[0-9]{1,2})?)";
  const sqft = "(?:square\\s*foot|sq\\s*ft)";
  const minimumValues = currencyAmounts(message, [
    new RegExp(`\\b(?:minimum\\s+charge|min(?:imum)?\\s+price)\\b\\s*(?:to|at|of|is|=)?\\s*\\$${amount}\\b`, "gi"),
    new RegExp(`\\$${amount}\\s*(?:minimum\\s+charge|min(?:imum)?\\s+price|minimum)\\b`, "gi"),
  ]);
  const perSqftValues = currencyAmounts(message, [
    new RegExp(`\\$${amount}\\s*(?:/|per\\s+)${sqft}\\b`, "gi"),
    new RegExp(`\\b(?:price\\s+)?per\\s+${sqft}(?:\\s+(?:price|rate))?\\s*(?:to|at|of|is|=)?\\s*\\$${amount}\\b`, "gi"),
  ]);
  const perPieceValues = currencyAmounts(message, [
    new RegExp(`\\$${amount}\\s*(?:/|per\\s+)piece\\b`, "gi"),
    new RegExp("\\b(?:price\\s+)?per\\s+piece(?:\\s+(?:price|rate))?\\s*(?:to|at|of|is|=)?\\s*\\$" + amount + "\\b", "gi"),
  ]);
  const fields = [
    ["minimum charge", minimumValues],
    ["per-square-foot price", perSqftValues],
    ["per-piece price", perPieceValues],
  ] as const;
  const ambiguous = fields.find(([, values]) => values.length > 1);
  if (ambiguous) return { error: `More than one explicit currency amount was supplied for ${ambiguous[0]}. State one exact amount per pricing field.` };

  const basePricing: NonNullable<InactiveProductDraftPatch["basePricing"]> = {};
  if (minimumValues[0] !== undefined) basePricing.minimumChargeCents = minimumValues[0];
  if (perSqftValues[0] !== undefined) basePricing.perSqftCents = perSqftValues[0];
  if (perPieceValues[0] !== undefined) basePricing.perPieceCents = perPieceValues[0];
  if (Object.keys(basePricing).length) return { basePricing };

  // A clone may have numeric names, dates, or IDs. Only a pricing instruction
  // with an unbound amount is an error; all other numbers are irrelevant.
  if (/\b(?:change|set|update)\s+(?:the\s+)?(?:price|pricing|rate|minimum\s+charge)\b[\s\S]{0,40}\b(?:to|at|of|=)\s*(?!\$)\d/i.test(message)
    || /\b(?:and\s+)?(?:the\s+)?minimum\s+charge\s*(?:to|at|of|is|=)\s*(?!\$)\d/i.test(message)) {
    return { error: "Clone pricing changes require one explicit currency amount bound to each field, for example $2.50 per square foot or minimum charge $30.00." };
  }
  return null;
}
