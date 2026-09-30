import type { OrderCreditHold } from "@shared/orderCreditHold";
import { OrderStatusPillSelector } from "@/components/OrderStatusPillSelector";
import { OrderStatusBadge } from '@/components/order-status-badge';
import type { OrderState } from "@/hooks/useOrderState";

export type OrdersListStatusRow = {
  id: string;
  creditHold?: OrderCreditHold;
  proofActionRequired?: boolean;
  lineItemsCount?: number;
  productionSummary?: { inProductionCount?: number; pendingHandoffCount?: number; stationKeys?: string[] };
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
  if (row.state === 'closed' || row.status === 'operationally_complete') return <OrderStatusBadge status={row.status ?? ''} state={row.state} />;
  return (
    <div className="flex items-center gap-2" onClick={(event) => event.stopPropagation()}>
      <OrderStatusPillSelector
        {...getOrdersListStatusSelectorProps(row)}
        className="h-7 w-[160px] text-xs"
      />
      {row.creditHold?.held && <span data-testid="awaiting-payment-badge" className="rounded-full border border-amber-500/20 bg-amber-500/10 px-2 py-1 text-xs font-medium text-amber-700">Awaiting Payment</span>}
    </div>
  );
}
