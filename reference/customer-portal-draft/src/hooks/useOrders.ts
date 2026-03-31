import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { adaptOrderList } from "@/lib/adapters";
import { mockOrders } from "@/lib/mock-data";
import { useRuntimeConfig } from "@/contexts/RuntimeConfigContext";
import type { PortalOrderListItem } from "@/types/portal";

export function useOrders() {
  const { isMockMode, dataMode } = useRuntimeConfig();

  return useQuery<PortalOrderListItem[]>({
    queryKey: ["portal", "orders", dataMode],
    queryFn: async () => {
      if (isMockMode) {
        await new Promise((r) => setTimeout(r, 600));
        return mockOrders;
      }

      const raw = await api.get<Record<string, unknown>[]>("/portal/my-orders");
      return adaptOrderList(raw);
    },
    staleTime: 60_000,
  });
}
