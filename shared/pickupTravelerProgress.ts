import type { FulfillmentLineQuantityProjection } from "./fulfillmentReadiness";
import type { PickupTravelerPrintContext } from "./productionTicket";

export type PickupTravelerLineProgress = {
  orderLineItemId: string;
  orderedQuantity: number;
  thisPickupQuantity: number;
  previouslyPickedUpQuantity: number;
  afterPickupQuantity: number;
  remainingAfterPickupQuantity: number;
  /** Shipped or administratively resolved; never label this as picked up. */
  otherResolvedQuantity: number;
};
export type PickupTravelerProgressSnapshot = {
  version: 1;
  basis: "prepared";
  preparedAt: string;
  lines: PickupTravelerLineProgress[];
};
type CanonicalLine = { id: string; production: Pick<FulfillmentLineQuantityProjection, "orderedQuantity" | "pickedUpQuantity" | "remainingQuantity"> };
const quantity = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

/** Snapshot the canonical fulfillment read model, before an unconfirmed pickup.
 * Print jobs have no handoff identity. Never re-add their quantity to a later
 * live aggregate: that aggregate may already include the physical handoff.
 * This is document context, not fulfillment evidence or a second ledger.
 */
export function buildPickupTravelerProgressSnapshot(
  lines: readonly CanonicalLine[],
  requested: PickupTravelerPrintContext["lineQuantities"],
  preparedAt: string,
): PickupTravelerProgressSnapshot {
  const byId = new Map(lines.map(line => [line.id, line.production]));
  const seen = new Set<string>();
  return { version: 1, basis: "prepared", preparedAt, lines: requested.map(item => {
    const canonical = byId.get(item.orderLineItemId);
    if (!canonical || seen.has(item.orderLineItemId) || !quantity(item.quantity) || item.quantity === 0
      || !quantity(canonical.orderedQuantity) || !quantity(canonical.pickedUpQuantity) || !quantity(canonical.remainingQuantity)
      || item.quantity > canonical.remainingQuantity
      || canonical.pickedUpQuantity + canonical.remainingQuantity > canonical.orderedQuantity) {
      throw new Error("Pickup Traveler quantities do not match canonical fulfillment obligations.");
    }
    seen.add(item.orderLineItemId);
    return {
      orderLineItemId: item.orderLineItemId,
      orderedQuantity: canonical.orderedQuantity,
      thisPickupQuantity: item.quantity,
      previouslyPickedUpQuantity: canonical.pickedUpQuantity,
      afterPickupQuantity: canonical.pickedUpQuantity + item.quantity,
      remainingAfterPickupQuantity: canonical.remainingQuantity - item.quantity,
      otherResolvedQuantity: canonical.orderedQuantity - canonical.remainingQuantity - canonical.pickedUpQuantity,
    };
  }) };
}

/** Validate persisted document context without silently dropping its snapshot. */
export function pickupTravelerContext(value: unknown): PickupTravelerPrintContext | null {
  if (!value || typeof value !== "object") return null;
  const context = value as PickupTravelerPrintContext;
  if (context.fulfillmentMode !== "pickup" || !quantity(context.boxCount) || context.boxCount < 1 || context.boxCount > 100
    || !Array.isArray(context.lineQuantities) || !context.lineQuantities.length) return null;
  const ids = new Set<string>();
  for (const item of context.lineQuantities) {
    if (!item || typeof item.orderLineItemId !== "string" || !item.orderLineItemId || ids.has(item.orderLineItemId)
      || !quantity(item.quantity) || item.quantity === 0) return null;
    ids.add(item.orderLineItemId);
  }
  const snapshot = context.progressSnapshot;
  if (snapshot !== undefined) {
    if (!snapshot || snapshot.version !== 1 || snapshot.basis !== "prepared" || typeof snapshot.preparedAt !== "string"
      || !Number.isFinite(Date.parse(snapshot.preparedAt)) || !Array.isArray(snapshot.lines)
      || snapshot.lines.length !== ids.size) return null;
    const seen = new Set<string>();
    for (const line of snapshot.lines) {
      if (!line || seen.has(line.orderLineItemId)) return null;
      seen.add(line.orderLineItemId);
      const requested = context.lineQuantities.find(item => item.orderLineItemId === line.orderLineItemId);
      if (!requested || requested.quantity !== line.thisPickupQuantity
        || ![line.orderedQuantity, line.thisPickupQuantity, line.previouslyPickedUpQuantity, line.afterPickupQuantity,
          line.remainingAfterPickupQuantity, line.otherResolvedQuantity].every(quantity)
        || line.afterPickupQuantity !== line.previouslyPickedUpQuantity + line.thisPickupQuantity
        || line.afterPickupQuantity + line.remainingAfterPickupQuantity + line.otherResolvedQuantity !== line.orderedQuantity) return null;
    }
  }
  return { fulfillmentMode: "pickup", boxCount: context.boxCount, lineQuantities: context.lineQuantities,
    ...(snapshot ? { progressSnapshot: snapshot } : {}) };
}
