/**
 * TitanOS Order Status Pills Hooks
 * 
 * React Query hooks for managing org-configurable status pills
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';
import type { OrderState } from './useOrderState';
import type { OrderStatusPillLifecycleMapping } from '@shared/schema';
import { orderDetailQueryKey, orderTimelineQueryKey, type OrderRow, type OrdersListResponse } from './useOrders';
import { buildOrderStatusPillsUrl } from '@/lib/orderStatusPills';

export interface OrderStatusPill {
  id: string;
  organizationId: string;
  stateScope: OrderState;
  key: string;
  name: string;
  color: string;
  category?: string | null;
  lifecycleMapping?: OrderStatusPillLifecycleMapping | null;
  customerVisible: boolean;
  notificationTriggerEligible: boolean;
  isDefault: boolean;
  isActive: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export type OrderStatusPillCachePatch = {
  statusPillId: string | null;
  statusPillValue: string | null;
  statusPillKey: string | null;
  statusPillColor: string | null;
  statusPillAssignedAt: string | Date | null;
  statusPillAssignedByUserId: string | null;
  updatedAt?: string | Date | null;
};

export function patchOrderStatusPillCacheData(
  old: OrdersListResponse | OrderRow[] | Record<string, any> | undefined,
  orderId: string,
  patch: OrderStatusPillCachePatch,
) {
  if (!old) return old;
  const patchRow = <T extends Record<string, any>>(row: T): T =>
    String(row.id) === orderId ? { ...row, ...patch } : row;
  if (Array.isArray(old)) return old.map((row) => patchRow(row));
  if (Array.isArray((old as OrdersListResponse).items)) {
    return { ...old, items: (old as OrdersListResponse).items.map((row) => patchRow(row)) };
  }
  return patchRow(old);
}

export function applyOrderStatusPillMutationSuccess(args: {
  queryClient: ReturnType<typeof useQueryClient>;
  orderId: string;
  selectedStatusPillId: string | null;
  data: any;
}) {
  const { queryClient, orderId, selectedStatusPillId, data } = args;
  const updatedOrder = data?.data ?? {};
  const statusPill = data?.statusPill ?? null;
  const patch: OrderStatusPillCachePatch = {
    statusPillId: updatedOrder.statusPillId ?? statusPill?.id ?? selectedStatusPillId ?? null,
    statusPillValue: updatedOrder.statusPillValue ?? statusPill?.name ?? null,
    statusPillKey: statusPill?.key ?? updatedOrder.statusPillKey ?? null,
    statusPillColor: statusPill?.color ?? updatedOrder.statusPillColor ?? null,
    statusPillAssignedAt: updatedOrder.statusPillAssignedAt ?? null,
    statusPillAssignedByUserId: updatedOrder.statusPillAssignedByUserId ?? null,
    updatedAt: updatedOrder.updatedAt ?? null,
  };

  queryClient.setQueriesData<OrdersListResponse | OrderRow[]>(
    { queryKey: ['orders', 'list'] },
    (old) => patchOrderStatusPillCacheData(old, orderId, patch) as OrdersListResponse | OrderRow[] | undefined,
  );
  queryClient.setQueryData(
    orderDetailQueryKey(orderId),
    (old: Record<string, any> | undefined) => patchOrderStatusPillCacheData(old, orderId, patch),
  );

  queryClient.invalidateQueries({ queryKey: ['orders', 'list'] });
  queryClient.invalidateQueries({ queryKey: orderDetailQueryKey(orderId) });
  queryClient.invalidateQueries({ queryKey: orderTimelineQueryKey(orderId) });

  if (statusPill?.key === 'in_production') {
    queryClient.invalidateQueries({
      predicate: (query) => {
        const key = query.queryKey;
        return Array.isArray(key) && key[0] === '/api/production/jobs';
      },
    });
  }

  return patch;
}

export async function requestOrderStatusPillAssignment(
  orderId: string,
  statusPillId: string | null,
  fetchFn: typeof fetch = fetch,
) {
  const res = await fetchFn(`/api/orders/${orderId}/status-pill`, {
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
    mutationFn: (statusPillId: string | null) => requestOrderStatusPillAssignment(orderId, statusPillId),
    onSuccess: (data, selectedStatusPillId) => {
      applyOrderStatusPillMutationSuccess({ queryClient, orderId, selectedStatusPillId, data });

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
