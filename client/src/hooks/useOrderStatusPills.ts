/**
 * TitanOS Order Status Pills Hooks
 * 
 * React Query hooks for managing org-configurable status pills
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';
import type { OrderState } from './useOrderState';
import type { OrderStatusPillLifecycleMapping } from '@shared/schema';
import { orderDetailQueryKey, ordersListQueryKey, orderTimelineQueryKey } from './useOrders';
import { buildOrderStatusPillsUrl } from '@/lib/orderStatusPills';

export interface OrderStatusPill {
  id: string;
  organizationId: string;
  stateScope: OrderState;
  key: string;
  name: string;
  color: string;
  category?: string | null;
  lifecycleMapping?: OrderStatusPillLifecycleMapping | OrderState | null;
  customerVisible: boolean;
  notificationTriggerEligible: boolean;
  isDefault: boolean;
  isActive: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * Fetch the full active tenant catalog by default. State-scoped reads remain
 * available for lifecycle-specific displays, not Orders assignment controls.
 */
export function useOrderStatusPills(stateScope?: OrderState, options?: { includeInactive?: boolean }) {
  const includeInactive = options?.includeInactive === true;
  const queryKey = includeInactive
    ? ['/api', 'orders', 'status-pills', 'settings-all-v2']
    : stateScope
      ? ['/api', 'orders', 'status-pills', 'state', stateScope]
      : ['/api', 'orders', 'status-pills', 'active-catalog-v2'];
  return useQuery<OrderStatusPill[]>({
    queryKey,
    queryFn: async () => {
      const baseUrl = buildOrderStatusPillsUrl(stateScope);
      const url = includeInactive ? '/api/settings/order-status-pills' : baseUrl;
      const res = await fetch(url, {
        credentials: 'include',
      });

      if (!res.ok) {
        throw new Error('Failed to fetch status pills');
      }

      const data = await res.json();
      const pills = (data.data || data.pills || []) as OrderStatusPill[];
      return includeInactive ? pills : pills.filter((pill) => pill.isActive !== false);
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

/**
 * Assign a status pill to an order
 */
export function useAssignOrderStatusPill(orderId: string) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (statusPillId: string | null) => {
      const res = await fetch(`/api/orders/${orderId}/status-pill`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ statusPillId }),
        credentials: 'include',
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || data.error || 'Failed to update status pill');
      }

      return res.json();
    },
    onSuccess: (data) => {
      // Invalidate TitanOS queries (and keep legacy timeline key for safety)
      queryClient.invalidateQueries({ queryKey: orderDetailQueryKey(orderId) });
      queryClient.invalidateQueries({ queryKey: orderTimelineQueryKey(orderId) });
      queryClient.invalidateQueries({ queryKey: ordersListQueryKey() });
      queryClient.invalidateQueries({ queryKey: ['/api', 'timeline'] });

      // If the pill implies production, the server may have scheduled jobs.
      // Refresh all production job lists regardless of filters.
      queryClient.invalidateQueries({
        predicate: (query) => {
          const key = query.queryKey;
          return Array.isArray(key) && key[0] === '/api/production/jobs';
        },
      });

      // Show success toast
      toast({
        title: 'Status Updated',
        description: data.message || 'Order status pill has been updated',
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Update Failed',
        description: error.message,
        variant: 'destructive',
      });
    },
  });
}

/**
 * Create a new status pill (Admin only)
 */
export function useCreateStatusPill() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (data: {
      stateScope: OrderState;
      name: string;
      color?: string;
      isDefault?: boolean;
      sortOrder?: number;
    }) => {
      const res = await fetch('/api/orders/status-pills', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
        credentials: 'include',
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.message || errorData.error || 'Failed to create status pill');
      }

      return res.json();
    },
    onSuccess: (data, variables) => {
      // Invalidate pills list for this state scope
      queryClient.invalidateQueries({
        queryKey: ['/api', 'orders', 'status-pills', variables.stateScope],
      });

      toast({
        title: 'Status Pill Created',
        description: `"${variables.name}" has been created`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Creation Failed',
        description: error.message,
        variant: 'destructive',
      });
    },
  });
}

/**
 * Update an existing status pill (Admin only)
 */
export function useUpdateStatusPill() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({
      pillId,
      updates,
    }: {
      pillId: string;
      updates: Partial<{
        name: string;
        color: string;
        category: string | null;
        lifecycleMapping: OrderStatusPillLifecycleMapping | null;
        customerVisible: boolean;
        notificationTriggerEligible: boolean;
        isDefault: boolean;
        sortOrder: number;
        isActive: boolean;
      }>;
    }) => {
      const res = await fetch(`/api/orders/status-pills/${pillId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
        credentials: 'include',
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.message || errorData.error || 'Failed to update status pill');
      }

      return res.json();
    },
    onSuccess: () => {
      // Invalidate all pills queries (don't know which state scope)
      queryClient.invalidateQueries({ queryKey: ['/api', 'orders', 'status-pills'] });

      toast({
        title: 'Status Pill Updated',
        description: 'Changes have been saved',
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Update Failed',
        description: error.message,
        variant: 'destructive',
      });
    },
  });
}

/**
 * Delete (deactivate) a status pill (Admin only)
 */
export function useDeleteStatusPill() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (pillId: string) => {
      const res = await fetch(`/api/orders/status-pills/${pillId}`, {
        method: 'DELETE',
        credentials: 'include',
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.message || errorData.error || 'Failed to delete status pill');
      }

      return res.json();
    },
    onSuccess: () => {
      // Invalidate all pills queries
      queryClient.invalidateQueries({ queryKey: ['/api', 'orders', 'status-pills'] });

      toast({
        title: 'Status Pill Deleted',
        description: 'The status pill has been removed',
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Deletion Failed',
        description: error.message,
        variant: 'destructive',
      });
    },
  });
}

/**
 * Set a pill as default (Admin only)
 */
export function useSetDefaultStatusPill() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (pillId: string) => {
      const res = await fetch(`/api/orders/status-pills/${pillId}/make-default`, {
        method: 'POST',
        credentials: 'include',
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.message || errorData.error || 'Failed to set default pill');
      }

      return res.json();
    },
    onSuccess: () => {
      // Invalidate all pills queries
      queryClient.invalidateQueries({ queryKey: ['/api', 'orders', 'status-pills'] });

      toast({
        title: 'Default Updated',
        description: 'The default status pill has been changed',
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Update Failed',
        description: error.message,
        variant: 'destructive',
      });
    },
  });
}
