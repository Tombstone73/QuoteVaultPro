/**
 * The persisted Order fulfillment method predates the current three-value
 * UI.  Keep legacy spellings interpreted identically in every layer that
 * displays, patches, or protects terminal fulfillment.
 */
export const canonicalOrderFulfillmentMethods = ["pickup", "ship", "deliver"] as const;

export type CanonicalOrderFulfillmentMethod =
  (typeof canonicalOrderFulfillmentMethods)[number];

export function canonicalizeOrderFulfillmentMethod(
  value: unknown,
): CanonicalOrderFulfillmentMethod | null {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "_");

  if (["pickup", "pick_up"].includes(normalized)) return "pickup";
  if (["ship", "shipping"].includes(normalized)) return "ship";
  if (["deliver", "delivery"].includes(normalized)) return "deliver";
  return null;
}

/** A missing legacy fulfillment method has always displayed and behaved as Ship. */
export function effectiveOrderFulfillmentMethod(
  value: unknown,
): CanonicalOrderFulfillmentMethod {
  return canonicalizeOrderFulfillmentMethod(value) ?? "ship";
}

export function fulfillmentMethodSemanticallyChanged(
  current: unknown,
  submitted: unknown,
): boolean {
  return effectiveOrderFulfillmentMethod(current) !== effectiveOrderFulfillmentMethod(submitted);
}
