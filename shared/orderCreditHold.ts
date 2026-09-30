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

/** Remaining unbilled commercial value, including increases after a settled invoice. */
export function unbilledOrderExposureCents(totalCents: number, activeInvoiceTotalCents: number) {
  return Math.max(0, totalCents - activeInvoiceTotalCents);
}
