const MAX_CUSTOMER_SHIPPING_CHARGE_CENTS = 2_147_483_647;

export function parseCustomerShippingChargeCents(amount: string): number | null {
  if (!/^\d+(?:\.\d{1,2})?$/.test(amount)) return null;
  const cents = Math.round(Number(amount) * 100);
  return Number.isSafeInteger(cents) && cents <= MAX_CUSTOMER_SHIPPING_CHARGE_CENTS ? cents : null;
}

export function upsCustomerChargeCents(rate: { currency: string; total: string }, handlingFeeCents = 0): number | null {
  if (rate.currency !== 'USD' || !Number.isInteger(handlingFeeCents) || handlingFeeCents < 0) return null;
  const rateCents = parseCustomerShippingChargeCents(rate.total);
  if (rateCents == null || rateCents + handlingFeeCents > MAX_CUSTOMER_SHIPPING_CHARGE_CENTS) return null;
  return rateCents + handlingFeeCents;
}
