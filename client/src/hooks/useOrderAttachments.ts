import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  orderDetailQueryKey,
  ordersListQueryKey,
  orderTimelineQueryKey,
} from "@/hooks/useOrders";

export const orderAttachmentsApiPath = (orderId: string) => `/api/orders/${orderId}/attachments`;
export const orderAttachmentsQueryKey = (orderId: string) => [orderAttachmentsApiPath(orderId)] as const;

export function useDeleteOrderAttachment(orderId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (attachmentId: string) => {
      const response = await fetch(`${orderAttachmentsApiPath(orderId)}/${attachmentId}`, {
        method: "DELETE",
        credentials: "include",
      });

      if (!response.ok) {
        const json = await response.json().catch(() => ({}));
        throw new Error(json.error || "Failed to delete attachment");
      }

      return true;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: orderAttachmentsQueryKey(orderId) });
      queryClient.invalidateQueries({ queryKey: orderDetailQueryKey(orderId) });
      queryClient.invalidateQueries({ queryKey: orderTimelineQueryKey(orderId) });
      queryClient.invalidateQueries({ queryKey: ordersListQueryKey() });
    },
  });
}
