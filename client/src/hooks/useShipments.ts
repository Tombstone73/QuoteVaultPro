import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Shipment, InsertShipment, UpdateShipment } from '@shared/schema';

// Get all shipments for an order
export function useShipments(orderId: string) {
  return useQuery({
    queryKey: ['shipments', orderId],
    queryFn: async (): Promise<Shipment[]> => {
      const response = await fetch(`/api/orders/${orderId}/shipments`, {
        credentials: 'include',
      });
      if (!response.ok) throw new Error('Failed to fetch shipments');
      const data = await response.json();
      return data.data;
    },
  });
}

// Create a new shipment
export function useCreateShipment(orderId: string) {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (data: InsertShipment & { sendEmail?: boolean; emailSubject?: string; emailMessage?: string }) => {
      const response = await fetch(`/api/orders/${orderId}/shipments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
        credentials: 'include',
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to create shipment');
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['shipments', orderId] });
      queryClient.invalidateQueries({ queryKey: ['order', orderId] });
    },
  });
}

// Update a shipment
export function useUpdateShipment(orderId: string) {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: UpdateShipment }) => {
      const response = await fetch(`/api/shipments/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
        credentials: 'include',
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to update shipment');
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['shipments', orderId] });
      queryClient.invalidateQueries({ queryKey: ['order', orderId] });
    },
  });
}

// Delete a shipment
export function useDeleteShipment(orderId: string) {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (shipmentId: string) => {
      const response = await fetch(`/api/shipments/${shipmentId}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to delete shipment');
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['shipments', orderId] });
      queryClient.invalidateQueries({ queryKey: ['order', orderId] });
    },
  });
}

// Generate packing slip HTML
export function useGeneratePackingSlip(orderId: string) {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async () => {
      const response = await fetch(`/api/orders/${orderId}/packing-slip`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to generate packing slip');
      }
      const data = await response.json();
      return data.data.html;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['order', orderId] });
    },
  });
}

// Send shipment notification email
export function useSendShipmentEmail(orderId: string) {
  return useMutation({
    mutationFn: async (data: { shipmentId: string; subject?: string; customMessage?: string }) => {
      const response = await fetch(`/api/orders/${orderId}/send-shipping-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
        credentials: 'include',
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to send shipment email');
      }
      return response.json();
    },
  });
}

// Update order fulfillment status manually
export function useUpdateFulfillmentStatus(orderId: string) {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (status: 'pending' | 'packed' | 'shipped' | 'delivered') => {
      const response = await fetch(`/api/orders/${orderId}/fulfillment-status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
        credentials: 'include',
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to update fulfillment status');
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['order', orderId] });
    },
  });
}
