import type { CustomerCreditExposure } from './customerCreditExposure';

export type OrderCreditHold = {
  held: boolean;
  creditLimitCents: number | null;
  exposureCents: number;
  requiredPaymentCents: number;
  overrideApplied: boolean;
};

export function isForwardProductionOrder(order: { state?: string | null; status?: string | null; canceledAt?: unknown }) {
  return !order.canceledAt && !['closed', 'canceled', 'cancelled', 'production_complete'].includes(order.state ?? '')
    && !['closed', 'canceled', 'cancelled', 'operationally_complete', 'completed', 'shipped', 'delivered'].includes(order.status ?? '');
}

export function deriveOrderCreditHold(order: Parameters<typeof isForwardProductionOrder>[0], position?: CustomerCreditExposure | null): OrderCreditHold {
  // An unset limit grants no production credit; it is not an unlimited facility.
  const requiredPaymentCents = position ? Math.max(0, position.creditExposureCents - (position.creditLimitCents ?? 0)) : 0;
  return {
    held: isForwardProductionOrder(order) && requiredPaymentCents > 0,
    creditLimitCents: position ? position.creditLimitCents ?? 0 : null,
    exposureCents: position?.creditExposureCents ?? 0,
    requiredPaymentCents,
    overrideApplied: false,
  };
}

/** Only a display projection; never a writable lifecycle status. */
export function getOrderFinancialDisplayStatus(order: {
  state?: string | null; status?: string | null; canceledAt?: unknown;
  statusPillValue?: string | null;
  creditHold?: OrderCreditHold | null; proofActionRequired?: boolean;
  lineItems?: Array<{ workflowState?: string | null; requiresPrepress?: boolean | null; requiresDesign?: boolean | null; designStatus?: string | null }>;
  lineItemsCount?: number;
  productionSummary?: { requiredCount?: number; inProductionCount?: number; pendingHandoffCount?: number; stationKeys?: string[] };
}): string | null {
  if (!isForwardProductionOrder(order)) return null;
  if (order.creditHold?.held) return 'Awaiting Payment';
  if (!order.creditHold) return null;
  if (['on_hold', 'problem'].includes(order.status ?? '') || ['on hold', 'problem'].includes(order.statusPillValue?.toLowerCase() ?? '')) return null;
  const stages = order.lineItems?.map(line => line.workflowState) ?? [];
  const stations = order.productionSummary?.stationKeys ?? [];
  if (stages.includes('in_production') || stations.some(station => !['design', 'prepress', 'proofing'].includes(station))) return 'In Production';
  if (order.proofActionRequired) return 'Awaiting Proof';
  if (stages.some(stage => stage === 'needs_design' || stage === 'in_design') || stations.includes('design')) return 'In Design';
  if (order.lineItems?.some(line => line.requiresPrepress && ['ready_for_prepress', 'in_prepress'].includes(line.workflowState ?? '')) || (!order.lineItems && stations.includes('prepress'))) return 'Prepress';
  if (order.productionSummary?.requiredCount === 0) return null;
  if ((order.lineItems?.length ?? order.lineItemsCount ?? 0) > 0 || (order.productionSummary?.pendingHandoffCount ?? 0) > 0) return 'Ready for Production';
  return null;
}

/** Remaining unbilled commercial value, including increases after a settled invoice. */
export function unbilledOrderExposureCents(totalCents: number, activeInvoiceTotalCents: number) {
  return Math.max(0, totalCents - activeInvoiceTotalCents);
}
