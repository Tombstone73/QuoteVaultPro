import type { QueryClient } from "@tanstack/react-query";
import type { QuoteResult, UiBootstrap } from "./api";
import { markOverrideUnavailable } from "./quoteFormModel";
import { quoteKeys } from "./quoteFormQueries";

export const applyAuthoritativeQuoteResult = (
  queryClient: QueryClient,
  organizationId: string,
  result: QuoteResult,
): string => {
  const quoteId = result.quote.quote.quoteId;
  queryClient.setQueryData(
    quoteKeys.quote(organizationId, quoteId),
    result.quote,
  );
  return quoteId;
};

/** A forbidden mutation cannot leave a stale override editor presenting success. */
export const reconcileForbiddenQuoteMutation = async (
  queryClient: QueryClient,
  organizationId: string,
  quoteId?: string,
): Promise<void> => {
  queryClient.setQueryData<UiBootstrap>(
    quoteKeys.bootstrap(organizationId),
    markOverrideUnavailable,
  );
  await Promise.all([
    queryClient.invalidateQueries({
      queryKey: quoteKeys.bootstrap(organizationId),
    }),
    quoteId
      ? queryClient.invalidateQueries({
          queryKey: quoteKeys.quote(organizationId, quoteId),
        })
      : Promise.resolve(),
  ]);
};
