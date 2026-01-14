import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { orderDetailQueryKey } from "@/hooks/useOrders";

export type ManualReservation = {
  id: string;
  organizationId: string;
  orderId: string;
  orderLineItemId: string | null;
  sourceType: "MANUAL";
  sourceKey: string;
  uom: string;
  qty: string;
  status: "RESERVED" | "RELEASED";
  createdByUserId: string | null;
  createdAt: string;
  updatedAt: string;

  materialName: string | null;

  createdByName?: string | null;
  createdByEmail?: string | null;
};

export const manualReservationsQueryKey = (orderId: string | undefined) => ["/api/orders", orderId, "manual-reservations"]; 

export function useManualReservations(orderId: string | undefined, enabled: boolean) {
  return useQuery<{ success: true; data: ManualReservation[] }>(
    {
      queryKey: manualReservationsQueryKey(orderId),
      enabled: Boolean(orderId) && enabled,
      queryFn: async () => {
        const res = await fetch(`/api/orders/${orderId}/manual-reservations`, { credentials: "include" });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error((data as any).message || "Failed to load manual reservations");
        return data;
      },
      staleTime: 10_000,
    },
  );
}

export function useCreateManualReservation(orderId: string | undefined, enabled: boolean) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: { materialId: string; quantity: number; inputUom?: string }) => {
      if (!orderId) throw new Error("Missing order id");
      if (!enabled) throw new Error("Manual reservations disabled");

      const res = await fetch(`/api/orders/${orderId}/manual-reservations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        credentials: "include",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as any).message || "Failed to create manual reservation");
      return data as { success: true; data: ManualReservation };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: manualReservationsQueryKey(orderId) });
      queryClient.invalidateQueries({ queryKey: ["/api/orders", orderId, "inventory"] });
      queryClient.invalidateQueries({ queryKey: orderDetailQueryKey(String(orderId)) });
    },
  });
}

export function useDeleteManualReservation(orderId: string | undefined, enabled: boolean) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (reservationId: string) => {
      if (!orderId) throw new Error("Missing order id");
      if (!enabled) throw new Error("Manual reservations disabled");

      const res = await fetch(`/api/orders/${orderId}/manual-reservations/${reservationId}`, {
        method: "DELETE",
        credentials: "include",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as any).message || "Failed to delete manual reservation");
      return data as { success: true; deletedCount: number };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: manualReservationsQueryKey(orderId) });
      queryClient.invalidateQueries({ queryKey: ["/api/orders", orderId, "inventory"] });
      queryClient.invalidateQueries({ queryKey: orderDetailQueryKey(String(orderId)) });
    },
  });
}
