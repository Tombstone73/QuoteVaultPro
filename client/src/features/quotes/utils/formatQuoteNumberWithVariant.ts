export function formatQuoteNumberWithVariant(
  quoteNumber: string | number | null | undefined,
  label?: string | null
): string {
  const base = quoteNumber == null ? "" : String(quoteNumber);
  if (!base) return "";

  const m = /^Option\s+([A-Z])$/.exec((label || "").trim());
  if (!m) return base;

  return `${base}${m[1]}`;
}



