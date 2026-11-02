/** Printing vocabulary shared by PO extraction and inbound email evidence.
 * These meanings are evidence, never catalog IDs or permission to substitute. */
export const PRINTING_SPECIFICATION_GUIDANCE = "In printing context, 4/4 means full-color front and back (double-sided); 4/0 means full-color front with a blank back (single-sided). Dates and ratios are not printing instructions. Preserve explicit print instructions; product defaults are not customer evidence. Map only to compatible available product options; ask for resolution when unavailable or ambiguous.";

export type PrintingSide = "single" | "double";

export function printingNotation(text: string): Array<"4/4" | "4/0"> {
  const found = new Set<"4/4" | "4/0">();
  for (const match of Array.from(text.matchAll(/(?<!\d)4\s*\/\s*([04])(?!\d|\s*\/)/g))) {
    const before = text.slice(Math.max(0, match.index! - 40), match.index);
    const after = text.slice(match.index! + match[0].length);
    if (/\b(?:due|by|date|dated|on|ratio|scale)\s*:?\s*$/i.test(before)) continue;
    const context = /\b(?:print(?:ed|s|ing)?(?:\s+sides?)?|sides?|colou?rs?|inks?|cmyk)\s*:?\s*$/i.test(before)
      || /^\s*(?:cmyk|full[ -]colou?r|printing|prints?|colou?rs?)\b/i.test(after)
      || text.trim() === match[0];
    if (context) found.add(match[1] === "4" ? "4/4" : "4/0");
  }
  return Array.from(found);
}

export function printingSidesFromEvidence(text: string): PrintingSide[] {
  const sides = new Set<PrintingSide>();
  if (/\b(?:single[ -]?sided|one[ -]?sided|1[ -]?sided|front\s+only|blank\s+back)\b/i.test(text)) sides.add("single");
  if (/\b(?:double[ -]?sided|two[ -]?sided|2[ -]?sided|front\s+(?:and|&)\s+back)\b/i.test(text)) sides.add("double");
  for (const notation of printingNotation(text)) sides.add(notation === "4/4" ? "double" : "single");
  return Array.from(sides);
}

/** Canonical option text, not arbitrary email prose. */
export function printingSideForOption(text: string): PrintingSide | null {
  const sides = printingSidesFromEvidence(text);
  if (sides.length) return sides.length === 1 ? sides[0] : null;
  const value = text.trim().toLowerCase();
  if (/^(?:single|one|ss|1)$/.test(value)) return "single";
  if (/^(?:double|two|ds|2)$/.test(value)) return "double";
  return null;
}
