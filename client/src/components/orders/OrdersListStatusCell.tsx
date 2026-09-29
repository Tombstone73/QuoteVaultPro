import { getOrderFinancialDisplayStatus, type OrderCreditHold } from "@shared/orderCreditHold";
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
  const financialStatus = getOrderFinancialDisplayStatus(row);
  return (
    <div className="flex items-center gap-2" onClick={(event) => event.stopPropagation()}>
      <OrderStatusPillSelector
        {...getOrdersListStatusSelectorProps(row)}
        displayLabel={financialStatus}
        className="h-7 w-[160px] text-xs"
      />
    </div>
  );
}
