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
  pills: ReadonlyArray<Pick<OrderStatusPill, 'id' | 'name'>> | null | undefined,
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

export type OrderStatusPillChoice = Pick<OrderStatusPill, 'id' | 'key' | 'name' | 'color' | 'isActive'> & {
  assignable: boolean;
  currentInactive: boolean;
};

export function buildOrderStatusPillChoices(
  pills: OrderStatusPill[] | null | undefined,
  currentPillId?: string | null,
  currentPillValue?: string | null,
): OrderStatusPillChoice[] {
  const active: OrderStatusPillChoice[] = (pills ?? [])
    .filter((pill) => pill.isActive !== false)
    .map((pill) => ({ ...pill, assignable: true, currentInactive: false }));
  const currentAlreadyActive = active.some((pill) =>
    (currentPillId && pill.id === currentPillId) || (!currentPillId && currentPillValue && pill.name === currentPillValue),
  );
  if (!currentAlreadyActive && currentPillValue) {
    active.push({
      id: currentPillId || `inactive-value:${encodeURIComponent(currentPillValue)}`,
      key: currentPillId ? `inactive:${currentPillId}` : `inactive-value:${currentPillValue}`,
      name: currentPillValue,
      color: '#64748b',
      isActive: false,
      assignable: false,
      currentInactive: true,
    });
  }
  return active;
}
