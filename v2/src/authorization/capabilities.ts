/**
 * Seed vocabulary only. New capabilities are added with the operation that
 * consumes them; a broad catch-all capability is deliberately not available.
 */
export const capabilityIds = [
  "orders.create",
  "quote.view",
  "quote.create",
  "quote.edit",
  "quote.send",
  "quote.convert",
  "order.view",
  "order.create",
  "order.edit",
  "order.cancel",
  "customer.view",
  "product.view",
  "pricing.preview",
  "invoice.view",
  "invoice.editDraft",
  "invoice.issue",
  "quotes.convert",
  "proof.respond",
  "fulfillment.pickup",
  "billing.payment.record",
] as const;

export type Capability = (typeof capabilityIds)[number];

export const isCapability = (value: string): value is Capability =>
  (capabilityIds as readonly string[]).includes(value);
