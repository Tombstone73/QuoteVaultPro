/**
 * A Quote URL is an explicit editor intent.  In particular, an existing URL
 * must not become a new Quote merely because its tenant-scoped read is still
 * resolving after a cold load.
 */
export type QuoteRouteMode = "list" | "create" | "loading-existing" | "existing" | "unavailable";

export const quoteRouteMode = (input: Readonly<{
  quoteId: string;
  createRequested: boolean;
  hasQuote: boolean;
  hasError: boolean;
}>): QuoteRouteMode => {
  if (input.quoteId) {
    if (input.hasQuote) return "existing";
    return input.hasError ? "unavailable" : "loading-existing";
  }
  return input.createRequested ? "create" : "list";
};
