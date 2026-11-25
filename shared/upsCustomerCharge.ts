export function parseCustomerShippingChargeCents(amount: string): number | null {
  if (!/^\d+(?:\.\d{1,2})?$/.test(amount)) return null;
  const cents = Math.round(Number(amount) * 100);
  return Number.isSafeInteger(cents) && cents <= 2_147_483_647 ? cents : null;
}

export function upsCustomerChargeCents(rate: { currency: string; total: string }): number | null {
  return rate.currency === 'USD' ? parseCustomerShippingChargeCents(rate.total) : null;
}
