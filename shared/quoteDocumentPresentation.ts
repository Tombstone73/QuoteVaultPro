/** Customer-facing labels only; never infer fulfillment from notes or tags. */
export function quoteFulfillmentLabel(method: unknown): string {
  if (method === "ship") return "Shipping";
  if (method === "deliver") return "Delivery";
  if (method === "pickup") return "Pickup";
  return "Not specified";
}

export function quoteShippingChargeLabel(method: unknown): string {
  return method === "deliver" ? "Delivery" : "Shipping";
}

/** Display the per-piece selling value of the already-projected commercial row.
 * Cent rounding is presentation only: the persisted line total stays authoritative.
 */
export function quoteDisplayUnitPriceCents(totalCents: number, quantity: unknown): number {
  const count = Number(quantity);
  return Number.isFinite(count) && count > 0 ? Math.round(totalCents / count) : 0;
}
