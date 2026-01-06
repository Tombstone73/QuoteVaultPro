import { useQuery } from "@tanstack/react-query";

export type OrderLineItemPreviewsResponse = Record<
  string,
  {
    thumbUrls: string[];
    thumbCount: number;
  }
>;

export function useOrderLineItemPreviews(orderId: string | undefined) {
  return useQuery<OrderLineItemPreviewsResponse>({
    queryKey: ["/api/orders", orderId, "line-item-previews"],
    queryFn: async () => {
      if (!orderId) return {};
      const res = await fetch(`/api/orders/${orderId}/line-item-previews`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to fetch line item previews");
      const json = await res.json();
      return (json?.data ?? {}) as OrderLineItemPreviewsResponse;
    },
    enabled: !!orderId,
  });
}
