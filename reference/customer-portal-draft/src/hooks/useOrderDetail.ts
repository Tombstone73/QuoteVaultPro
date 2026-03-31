import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { adaptOrderDetail } from "@/lib/adapters";
import { mockOrderDetail } from "@/lib/mock-data";
import { useRuntimeConfig } from "@/contexts/RuntimeConfigContext";
import type { PortalOrderDetail } from "@/types/portal";

export function useOrderDetail(orderId: string | undefined) {
  const { isMockMode, dataMode } = useRuntimeConfig();

  return useQuery<PortalOrderDetail>({
    queryKey: ["portal", "order-detail", orderId, dataMode],
    enabled: !!orderId,
    queryFn: async () => {
      if (isMockMode) {
        await new Promise((r) => setTimeout(r, 600));
        return mockOrderDetail(orderId!);
      }

      // Fetch order, then line items from the order response
      const rawOrder = await api.get<Record<string, unknown>>(`/orders/${orderId}`);
      const rawLineItems = (rawOrder.lineItems as Record<string, unknown>[]) ?? [];

      // Fetch files for each line item
      const filesMap = new Map<string, Record<string, unknown>[]>();
      await Promise.all(
        rawLineItems.map(async (li) => {
          const liId = li.id as string;
          try {
            const files = await api.get<Record<string, unknown>[]>(
              `/orders/${orderId}/line-items/${liId}/files`
            );
            filesMap.set(liId, files);
          } catch {
            filesMap.set(liId, []);
          }
        })
      );

      return adaptOrderDetail(rawOrder, rawLineItems, filesMap);
    },
    staleTime: 60_000,
  });
}
