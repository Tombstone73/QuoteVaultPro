/**
 * Sanitizes a raw string value for safe display in production UI.
 *
 * Handles:
 *  - null / undefined  → "—"
 *  - Mojibake sequences produced when UTF-8 text was stored/transmitted as Latin-1 or Windows-1252
 *    • "Ã\x97"  (U+00C3 + U+0097) — UTF-8 bytes for × (U+00D7) mis-decoded as two code-points → "×"
 *    • "Ã—"    (U+00C3 + U+2014) — same bytes when 0x97 is decoded as Windows-1252 em-dash → "×"
 *    • "â€""   (U+00E2 U+0080 U+0094) — UTF-8 em-dash mis-decoded → "—"
 *    • "â€""   (U+00E2 U+0080 U+0093) — UTF-8 en-dash mis-decoded → "–"
 *    • Stray Â  preceding non-breaking space → stripped
 *  - Empty strings after cleanup → "—"
 */
export function sanitizeDisplayText(input: unknown): string {
  if (input === null || input === undefined) return "—";
  let s = String(input);

  // --- Multiplication sign mojibake ---
  // UTF-8 bytes 0xC3 0x97 for × (U+00D7) decoded as:
  //   • ISO-8859-1: U+00C3 + U+0097
  s = s.replaceAll("\u00C3\u0097", "\u00D7");
  //   • Windows-1252: U+00C3 + U+2014 (0x97 maps to em-dash in CP1252)
  s = s.replaceAll("\u00C3\u2014", "\u00D7");

  // --- Em-dash / en-dash mojibake ---
  s = s.replaceAll("\u00E2\u0080\u0094", "—");
  s = s.replaceAll("\u00E2\u0080\u0093", "–");
  // Partial leading sequence seen in some column values
  if (
    s.trim() === "\u00E2\u0080" ||
    s.trim() === "\u00E2\u0080\u008B" ||
    s.trim() === "\u00E2\u0080\u00AF"
  ) {
    s = "—";
  }

  // --- Non-breaking space mojibake (Â\u00A0 or bare Â) ---
  s = s.replaceAll("\u00C2\u00A0", " ");
  s = s.replaceAll("\u00C2 ", " ");
  s = s.replaceAll("\u00C2", "");

  // --- Collapse and trim ---
  s = s.replace(/\s+/g, " ").trim();

  return s.length === 0 ? "—" : s;
}
