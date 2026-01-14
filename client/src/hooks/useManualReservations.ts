import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { orderDetailQueryKey } from "@/hooks/useOrders";

export type ManualReservation = {
  id: string;
  orderId: string;
  material: {
    id: string;
    name: string;
    sku: string;
    unitOfMeasure: string;
  } | null;
  uom: string;
  qty: string;
  status: string;
  createdAt: string;
  createdBy: {
    id: string;
    email: string | null;
    firstName: string | null;
    lastName: string | null;
    displayName: string;
  } | null;
};

export const manualReservationsQueryKey = (orderId: string) => ["/api/orders", orderId, "manual-reservations"];

export function useManualReservations(orderId: string | undefined, enabled: boolean) {
  return useQuery<ManualReservation[]>({
    queryKey: orderId ? manualReservationsQueryKey(orderId) : ["/api/orders", "manual-reservations", "missing"],
    enabled: Boolean(orderId) && enabled,
    queryFn: async () => {
      if (!orderId) throw new Error("Order ID required");
      const res = await fetch(`/api/orders/${orderId}/manual-reservations`, { credentials: "include" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((json as any).message || "Failed to load manual reservations");
      return (json as any).success ? ((json as any).data as ManualReservation[]) : (json as any);
    },
  });
}

export function useCreateManualReservation(orderId: string) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (args: { materialId: string; quantity: number }) => {
      const res = await fetch(`/api/orders/${orderId}/manual-reservations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(args),
      });

      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((json as any).message || "Failed to create manual reservation");
      return json as any;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: manualReservationsQueryKey(orderId) });
      queryClient.invalidateQueries({ queryKey: ["/api/orders", orderId, "inventory"] });
      queryClient.invalidateQueries({ queryKey: orderDetailQueryKey(orderId) });
      toast({ title: "Reservation added" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });
}

export function useDeleteManualReservation(orderId: string) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (args: { reservationId: string }) => {
      const res = await fetch(`/api/orders/${orderId}/manual-reservations/${args.reservationId}`, {
        method: "DELETE",
        credentials: "include",
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((json as any).message || "Failed to delete manual reservation");
      return json as any;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: manualReservationsQueryKey(orderId) });
      queryClient.invalidateQueries({ queryKey: ["/api/orders", orderId, "inventory"] });
      queryClient.invalidateQueries({ queryKey: orderDetailQueryKey(orderId) });
      toast({ title: "Reservation removed" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });
}
