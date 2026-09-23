import { quoteLineKey, type OrderedQuoteLine } from "@shared/quoteLineOrder";

/** Apply only sequence; retain edits, identity, pricing and hierarchy verbatim. */
export function applyQuoteLineSequence<T extends OrderedQuoteLine>(lines: readonly T[], keys: readonly string[], allowChangedMembership = false): T[] {
  if (!allowChangedMembership && (keys.length !== lines.length || new Set(keys).size !== keys.length || keys.some((key) => !lines.some((line) => quoteLineKey(line) === key)))) {
    throw new Error("Quote lines changed. Refresh and try again.");
  }
  const positions = new Map(keys.map((key, index) => [key, index]));
  return lines.map((line, index) => ({ ...line, displayOrder: positions.get(quoteLineKey(line)) ?? keys.length + index }))
    .sort((a, b) => a.displayOrder - b.displayOrder);
}
