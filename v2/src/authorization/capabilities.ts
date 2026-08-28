/** A reviewed operation vocabulary; no broad administrator wildcard exists. */
export const capabilityIds = [
  "quote.view", "quote.create", "quote.edit", "quote.send", "quote.convert", "quote.overridePrice",
  "order.view", "order.create", "order.edit", "order.cancel", "order.overridePrice",
  "customer.view", "customer.edit", "product.view", "product.edit",
  "communications.configure",
  "pricing.preview", "pricing.configure", "pricing.publish",
  "invoice.view", "invoice.editDraft", "invoice.editIssued", "invoice.issue",
  "payment.view", "payment.record", "refund.issue",
  "permissions.view", "permissions.manageSets", "permissions.assignStaff", "permissions.assignPortal",
  "route.view", "route.advance", "route.reroute", "route.skipStep", "route.manageTemplates",
  "artwork.view", "artwork.adopt", "artwork.assign",
  "proof.view", "proof.prepare", "proof.issue", "proof.respond", "fulfillment.view", "fulfillment.pickup", "fulfillment.ship",
  "prepress.view", "prepress.work", "prepress.complete",
  "production.view", "production.work", "production.complete",
  "inventory.view", "inventory.receive",
] as const;

export type Capability = (typeof capabilityIds)[number];
export const isCapability = (value: string): value is Capability =>
  (capabilityIds as readonly string[]).includes(value);
