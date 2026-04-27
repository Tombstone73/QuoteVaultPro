import { useQuery } from "@tanstack/react-query";
import { useRuntimeConfig } from "@/contexts/RuntimeConfigContext";
import { useQuotes } from "@/hooks/useQuotes";
import { mockQuoteDetail } from "@/lib/mock-data";
import type { PortalQuoteDetail } from "@/types/portal";

/**
 * Derives quote detail from the cached quotes list.
 * No dedicated GET /api/quotes/:id endpoint is confirmed —
 * detail is built from the list payload plus mock line items in demo mode.
 */
export function useQuoteDetail(quoteId: string | undefined) {
  const { isMockMode, dataMode } = useRuntimeConfig();
  const { data: quotes } = useQuotes();

  return useQuery<PortalQuoteDetail | null>({
    queryKey: ["portal", "quote-detail", quoteId, dataMode],
    queryFn: async () => {
      if (!quoteId) return null;

      if (isMockMode) {
        await new Promise((r) => setTimeout(r, 400));
        return mockQuoteDetail(quoteId);
      }

      // In live mode, derive from cached list (no dedicated detail endpoint)
      const match = quotes?.find((q) => q.id === quoteId);
      if (!match) return null;

      // Line items are not available from the list endpoint
      return { ...match, lineItems: [] };
    },
    enabled: !!quoteId && (isMockMode || !!quotes),
    staleTime: 60_000,
  });
}
