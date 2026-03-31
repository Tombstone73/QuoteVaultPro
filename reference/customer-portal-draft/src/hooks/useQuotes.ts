import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { adaptQuoteList } from "@/lib/adapters";
import { mockQuotes } from "@/lib/mock-data";
import { useRuntimeConfig } from "@/contexts/RuntimeConfigContext";
import type { PortalQuoteListItem } from "@/types/portal";

export function useQuotes() {
  const { isMockMode, dataMode } = useRuntimeConfig();

  return useQuery<PortalQuoteListItem[]>({
    queryKey: ["portal", "quotes", dataMode],
    queryFn: async () => {
      if (isMockMode) {
        await new Promise((r) => setTimeout(r, 600));
        return mockQuotes;
      }

      const raw = await api.get<Record<string, unknown>[]>("/portal/my-quotes");
      return adaptQuoteList(raw);
    },
    staleTime: 60_000,
  });
}
