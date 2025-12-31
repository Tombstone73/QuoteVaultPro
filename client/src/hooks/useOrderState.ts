/**
 * TitanOS Order State Hooks
 * 
 * React Query hooks for managing order state transitions
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';

export type OrderState = 'open' | 'production_complete' | 'closed' | 'canceled';

/**
 * Get allowed next states for a given current state
 */
export function getAllowedNextStates(currentState: OrderState): OrderState[] {
  switch (currentState) {
    case 'open':
      return ['production_complete', 'canceled'];
    case 'production_complete':
      return ['closed', 'canceled'];
    case 'closed':
      return []; // Terminal (use reopen)
    case 'canceled':
      return []; // Terminal
    default:
      return [];
  }
}

/**
 * Check if a state is terminal
 */
export function isTerminalState(state: OrderState): boolean {
  return state === 'closed' || state === 'canceled';
}

/**
 * Get display name for a state
 */
export function getStateDisplayName(state: OrderState): string {
  switch (state) {
    case 'open':
      return 'Open';
    case 'production_complete':
      return 'Production Complete';
    case 'closed':
      return 'Closed';
    case 'canceled':
      return 'Canceled';
    default:
      return state;
  }
}

/**
 * Get color class for a state badge
 */
export function getStateColor(state: OrderState): string {
  switch (state) {
    case 'open':
      return 'bg-blue-100 text-blue-800 border-blue-300 dark:bg-blue-900/20 dark:text-blue-400 dark:border-blue-800';
    case 'production_complete':
      return 'bg-purple-100 text-purple-800 border-purple-300 dark:bg-purple-900/20 dark:text-purple-400 dark:border-purple-800';
    case 'closed':
      return 'bg-green-100 text-green-800 border-green-300 dark:bg-green-900/20 dark:text-green-400 dark:border-green-800';
    case 'canceled':
      return 'bg-gray-100 text-gray-800 border-gray-300 dark:bg-gray-900/20 dark:text-gray-400 dark:border-gray-800';
    default:
      return 'bg-gray-100 text-gray-800 border-gray-300';
  }
}

/**
 * Hook to transition order state
 */
export function useTransitionOrderState(orderId: string) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ nextState, notes }: { nextState: OrderState; notes?: string }) => {
      const res = await fetch(`/api/orders/${orderId}/state`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nextState, notes }),
        credentials: 'include',
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || data.error || 'Failed to transition state');
      }

      return res.json();
    },
    onSuccess: (data) => {
      // Invalidate queries
      queryClient.invalidateQueries({ queryKey: ['/api', 'orders', orderId] });
      queryClient.invalidateQueries({ queryKey: ['/api', 'orders'] });
      queryClient.invalidateQueries({ queryKey: ['/api', 'timeline'] });

      // Show success toast
      toast({
        title: 'State Updated',
        description: data.message || 'Order state has been updated',
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Transition Failed',
        description: error.message,
        variant: 'destructive',
      });
    },
  });
}

/**
 * Hook to reopen a closed order
 */
export function useReopenOrder(orderId: string) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ reason, targetState }: { reason: string; targetState?: OrderState }) => {
      const res = await fetch(`/api/orders/${orderId}/reopen`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason, targetState: targetState || 'production_complete' }),
        credentials: 'include',
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || data.error || 'Failed to reopen order');
      }

      return res.json();
    },
    onSuccess: (data) => {
      // Invalidate queries
      queryClient.invalidateQueries({ queryKey: ['/api', 'orders', orderId] });
      queryClient.invalidateQueries({ queryKey: ['/api', 'orders'] });
      queryClient.invalidateQueries({ queryKey: ['/api', 'timeline'] });

      // Show success toast
      toast({
        title: 'Order Reopened',
        description: data.message || 'Order has been reopened',
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Reopen Failed',
        description: error.message,
        variant: 'destructive',
      });
    },
  });
}
