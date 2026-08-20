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

export function normalizeOrderPatchShipping(
  patch: Record<string, unknown>,
  existingShippingMethod: string | null | undefined,
): { shippingCents?: number; error?: string } {
  const shippingMethodWasProvided = patch.shippingMethod !== undefined;
  const shippingCentsWasProvided = patch.shippingCents !== undefined;
  if (!shippingMethodWasProvided && !shippingCentsWasProvided) return {};

  const finalShippingMethod = (patch.shippingMethod ?? existingShippingMethod) as string | null | undefined;
  if (finalShippingMethod === "pickup") return { shippingCents: 0 };
  if (!shippingCentsWasProvided) return {};

  const rawShippingCents = Number(patch.shippingCents);
  if (!Number.isFinite(rawShippingCents)) return { error: "Invalid shippingCents" };
  return { shippingCents: Math.max(0, Math.floor(rawShippingCents)) };
}
