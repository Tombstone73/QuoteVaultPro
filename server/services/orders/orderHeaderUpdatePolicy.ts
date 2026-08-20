/**
 * A draft invoice mirrors the Order's financial snapshot and billing customer,
 * not operational header metadata. Keeping this narrow avoids making a
 * legitimate PO or due-date edit depend on reconciling legacy invoice rows.
 */
export function orderChangesRequireDraftInvoiceSynchronization(changes: Record<string, unknown>): boolean {
  return [
    "customerId",
    "contactId",
    "subtotal",
    "tax",
    "taxAmount",
    "total",
    "discount",
    "shippingCents",
  ].some((field) => changes[field] !== undefined);
}
