/**
 * A live Order-backed invoice mirrors the Order's financial snapshot and billing customer,
 * not operational header metadata. Keeping this narrow avoids making a
 * legitimate PO or due-date edit depend on reconciling legacy invoice rows.
 */
export function orderChangesRequireOrderBackedInvoiceSynchronization(changes: Record<string, unknown>): boolean {
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

export type CanonicalFulfillmentMethod = "pickup" | "ship" | "deliver";

/**
 * Older Orders can contain display-oriented fulfillment values such as
 * `shipping` or `delivery`.  Header PATCHes must compare their operational
 * meaning, not their legacy spelling: resubmitting Ship for Shipping is not a
 * fulfillment reversal.
 */
export function canonicalizeOrderFulfillmentMethod(value: unknown): CanonicalFulfillmentMethod | null {
  const normalized = String(value ?? "").trim().toLowerCase().replace(/[\s_-]+/g, "_");
  if (["pickup", "pick_up"].includes(normalized)) return "pickup";
  if (["ship", "shipping"].includes(normalized)) return "ship";
  if (["deliver", "delivery"].includes(normalized)) return "deliver";
  return null;
}

/** A missing legacy fulfillment method has always displayed and behaved as Ship. */
export function effectiveOrderFulfillmentMethod(value: unknown): CanonicalFulfillmentMethod {
  return canonicalizeOrderFulfillmentMethod(value) ?? "ship";
}

export function fulfillmentMethodSemanticallyChanged(current: unknown, submitted: unknown): boolean {
  return effectiveOrderFulfillmentMethod(current) !== effectiveOrderFulfillmentMethod(submitted);
}

/**
 * Canonicalizes an explicitly submitted method and removes an equivalent
 * no-op.  This prevents unrelated commercial/header saves from being treated
 * as a terminal fulfillment mutation solely because a legacy Order stores a
 * display alias (or no explicit method at all).
 */
export function normalizeOrderPatchFulfillmentMethod(
  patch: Record<string, unknown>,
  existingShippingMethod: string | null | undefined,
): { shippingMethod?: CanonicalFulfillmentMethod; unchanged: boolean; error?: string } {
  if (patch.shippingMethod === undefined) return { unchanged: true };
  if (patch.shippingMethod === null) {
    return { unchanged: !fulfillmentMethodSemanticallyChanged(existingShippingMethod, null) };
  }

  const canonical = canonicalizeOrderFulfillmentMethod(patch.shippingMethod);
  if (!canonical) return { unchanged: false, error: "Invalid shippingMethod" };
  if (!fulfillmentMethodSemanticallyChanged(existingShippingMethod, canonical)) {
    return { unchanged: true };
  }
  return { shippingMethod: canonical, unchanged: false };
}

export function normalizeOrderPatchShipping(
  patch: Record<string, unknown>,
  existingShippingMethod: string | null | undefined,
): { shippingCents?: number; error?: string } {
  const shippingMethodWasProvided = patch.shippingMethod !== undefined;
  const shippingCentsWasProvided = patch.shippingCents !== undefined;
  if (!shippingMethodWasProvided && !shippingCentsWasProvided) return {};

  const finalShippingMethod = effectiveOrderFulfillmentMethod(patch.shippingMethod ?? existingShippingMethod);
  if (finalShippingMethod === "pickup") return { shippingCents: 0 };
  if (!shippingCentsWasProvided) return {};

  const rawShippingCents = Number(patch.shippingCents);
  if (!Number.isFinite(rawShippingCents)) return { error: "Invalid shippingCents" };
  return { shippingCents: Math.max(0, Math.floor(rawShippingCents)) };
}
