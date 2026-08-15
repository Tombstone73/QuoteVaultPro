import type { QueryClient } from "@tanstack/react-query";
import type { QuoteResult, UiBootstrap } from "./api";
import { markOverrideUnavailable } from "./quoteFormModel";
import { quoteKeys } from "./quoteFormQueries";

export const applyAuthoritativeQuoteResult = (
  queryClient: QueryClient,
  sessionScope: string,
  organizationId: string,
  result: QuoteResult,
): string => {
  const quoteId = result.quote.quote.quoteId;
  queryClient.setQueryData(
    quoteKeys.quote(sessionScope, organizationId, quoteId),
    result.quote,
  );
  return quoteId;
};

/** A forbidden mutation cannot leave a stale override editor presenting success. */
export const reconcileForbiddenQuoteMutation = async (
  queryClient: QueryClient,
  sessionScope: string,
  organizationId: string,
  quoteId?: string,
): Promise<void> => {
  queryClient.setQueryData<UiBootstrap>(
    quoteKeys.bootstrap(sessionScope, organizationId),
    markOverrideUnavailable,
  );
  await Promise.all([
    queryClient.invalidateQueries({
      queryKey: quoteKeys.bootstrap(sessionScope, organizationId),
    }),
    quoteId
      ? queryClient.invalidateQueries({
          queryKey: quoteKeys.quote(sessionScope, organizationId, quoteId),
        })
      : Promise.resolve(),
  ]);
};

/**
 * Trusted hosts notify the browser shell after logout or session replacement.
 * Query keys are scoped already; removing this namespace also prevents old
 * user-visible state from surviving until a replacement session refetches.
 */
export const clearV2SessionQueryState = (queryClient: QueryClient): void => {
  queryClient.removeQueries({ queryKey: ["v2"] });
};
