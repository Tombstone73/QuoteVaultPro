/**
 * A Quote line's Product identity is frozen in its commercial description.
 * The Product id is lineage evidence, not operator-facing text.
 */
export const quoteLineProductPresentation = (
  line: Readonly<{ description: string }>,
): string => line.description.trim() || "Product unavailable";
