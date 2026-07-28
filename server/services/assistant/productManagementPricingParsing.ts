import type { InactiveProductDraftPatch } from "./inactiveProductDraftUpdateService";

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
