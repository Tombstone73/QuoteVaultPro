<<<<<<< HEAD
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
=======
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
>>>>>>> 5c1f15294a8e588ff9863f3527c1888ad823276b
import { orderDetailQueryKey } from "@/hooks/useOrders";

export type ManualReservation = {
  id: string;
<<<<<<< HEAD
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
=======
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
>>>>>>> 5c1f15294a8e588ff9863f3527c1888ad823276b
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: manualReservationsQueryKey(orderId) });
      queryClient.invalidateQueries({ queryKey: ["/api/orders", orderId, "inventory"] });
<<<<<<< HEAD
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
=======
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
>>>>>>> 5c1f15294a8e588ff9863f3527c1888ad823276b
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: manualReservationsQueryKey(orderId) });
      queryClient.invalidateQueries({ queryKey: ["/api/orders", orderId, "inventory"] });
<<<<<<< HEAD
      queryClient.invalidateQueries({ queryKey: orderDetailQueryKey(orderId) });
      toast({ title: "Reservation removed" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
=======
      queryClient.invalidateQueries({ queryKey: orderDetailQueryKey(String(orderId)) });
    },
>>>>>>> 5c1f15294a8e588ff9863f3527c1888ad823276b
  });
}
