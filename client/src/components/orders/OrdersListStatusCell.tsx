import { OrderStatusPillSelector } from "@/components/OrderStatusPillSelector";
import { OrderStatusBadge } from '@/components/order-status-badge';
import type { OrderState } from "@/hooks/useOrderState";

export type OrdersListStatusRow = {
  id: string;
  state?: string | null;
  status?: string | null;
  statusPillId?: string | null;
  statusPillValue?: string | null;
};

export function getOrdersListStatusSelectorProps(row: OrdersListStatusRow) {
  return {
    orderId: row.id,
    currentState: row.state as OrderState,
    currentPillId: row.statusPillId ?? null,
    currentPillValue: row.statusPillValue ?? null,
  };
}

export function OrdersListStatusCell({ row }: { row: OrdersListStatusRow }) {
  if (row.status === 'operationally_complete') return <OrderStatusBadge status={row.status} />;
  return (
    <div className="flex items-center gap-2" onClick={(event) => event.stopPropagation()}>
      <OrderStatusPillSelector
        {...getOrdersListStatusSelectorProps(row)}
        className="h-7 w-[160px] text-xs"
      />
    </div>
  );
}
