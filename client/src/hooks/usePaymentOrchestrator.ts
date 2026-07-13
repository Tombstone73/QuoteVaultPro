import { useQuery } from "@tanstack/react-query";
import type { PaymentResolution } from "@shared/paymentOrchestration";
import { apiFetch } from "@/lib/queryClient";

export const orderPaymentResolutionQueryKey = (orderId: string | undefined) => [
  "orders",
  orderId,
  "payment-resolution",
];

export function useOrderPaymentResolution(orderId: string | undefined) {
  return useQuery<PaymentResolution>({
    queryKey: orderPaymentResolutionQueryKey(orderId),
    enabled: Boolean(orderId),
    queryFn: async () => {
      if (!orderId) throw new Error("Missing order id");
      const response = await apiFetch(`/api/orders/${encodeURIComponent(orderId)}/payment-resolution`);
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload?.success === false) {
        throw new Error(payload?.error || payload?.message || "Failed to resolve order payment");
      }
      return payload.data as PaymentResolution;
    },
  });
}
