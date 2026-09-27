import type { Capability } from "./capabilities.js";

/** Real built-in staff authority, not a QA profile or administrator wildcard.
 * The forward SQL seed is checked against this contract by migration tests.
 */
export const OPERATIONS_ROLE = Object.freeze({
  templateKey: "operations",
  name: "Operations",
  description: "Day-to-day job lifecycle operations without tenant, permission or provider administration.",
  principalKind: "staff",
  capabilities: Object.freeze([
    "customer.view", "customer.edit",
    "quote.view", "quote.create", "quote.edit", "quote.send", "quote.convert", "quote.overridePrice",
    "order.view", "order.create", "order.edit", "order.overridePrice",
    "product.view", "pricing.preview",
    "artwork.view", "artwork.adopt", "artwork.assign",
    "proof.view", "proof.prepare", "proof.issue",
    "prepress.view", "prepress.work", "prepress.complete",
    "production.view", "production.work", "production.run.create", "production.run.execute",
    "production.complete", "production.hold", "production.note", "production.rework", "production.output.reject",
    "fulfillment.view", "fulfillment.pickup", "fulfillment.ship", "fulfillment.replace",
    "fulfillment.shipping.cost", "fulfillment.shipping.price",
    "invoice.view", "invoice.editDraft", "invoice.editIssued", "invoice.issue", "invoice.send", "payment.view",
    "route.view", "route.advance",
  ] as const satisfies readonly Capability[]),
} as const);
