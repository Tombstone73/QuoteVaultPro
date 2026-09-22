/**
 * Canonical Close Job Override eligibility. Parent lifecycle labels are not
 * inputs because legacy parents can contradict canonical line obligations.
 */
export function canCloseJobOverrideFromCanonicalObligations(input: {
  canceled: boolean;
  remainingProductionQuantity: number;
  remainingFulfillmentQuantity: number;
}) {
  return !input.canceled && (input.remainingProductionQuantity > 0 || input.remainingFulfillmentQuantity > 0);
}
