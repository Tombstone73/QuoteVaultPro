import type { OrderStatusPill } from '@/hooks/useOrderStatusPills';
import type { OrderState } from '@/hooks/useOrderState';

export function buildOrderStatusPillsUrl(stateScope?: OrderState): string {
  return stateScope
    ? `/api/order-status-pills?state=${stateScope}`
    : '/api/order-status-pills';
}

export function resolveOrderStatusPillId(
  statusPillId: string | null | undefined,
  statusPillValue: string | null | undefined,
  pills: OrderStatusPill[] | null | undefined,
): string {
  return statusPillId || pills?.find((pill) => pill.name === statusPillValue)?.id || '';
}

export function orderMatchesStatusPillFilter(
  order: { statusPillId?: string | null; statusPillValue?: string | null },
  filterPillId: string,
  pills: OrderStatusPill[] | null | undefined,
): boolean {
  if (filterPillId === 'all') return true;
  return resolveOrderStatusPillId(order.statusPillId, order.statusPillValue, pills) === filterPillId;
}
