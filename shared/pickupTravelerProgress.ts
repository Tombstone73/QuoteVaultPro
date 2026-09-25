import type { FulfillmentLineQuantityProjection } from "./fulfillmentReadiness";
import type { PickupTravelerPrintContext } from "./productionTicket";
import { z } from "zod";
import { netTerminalFulfillmentQuantity, terminalReversalQuantitiesByLine } from "./fulfillmentTerminalReversal";

const optionalBoxNumber = z.preprocess(value => value === null || (typeof value === "string" && !value.trim()) ? undefined : value,
  z.union([z.number(), z.string().trim().regex(/^\d+$/).transform(Number)]).pipe(z.number().int().positive().max(Number.MAX_SAFE_INTEGER)).optional());
export const pickupTravelerBoxSchema = z.object({ currentBox: optionalBoxNumber, totalBoxes: optionalBoxNumber })
  .superRefine((box, ctx) => {
    if ((box.currentBox === undefined) !== (box.totalBoxes === undefined) || (box.currentBox ?? 0) > (box.totalBoxes ?? 0)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Enter both box numbers, with the current box no greater than the total." });
    }
  }).transform(box => box.currentBox === undefined ? null : { current: box.currentBox, total: box.totalBoxes! });

export type PickupTravelerHistoryEntry = {
  id: string; createdAt: string; pickupHandoffId: string | null;
  box: { current: number; total: number } | null; legacyBoxCount?: number;
  lines: Array<{ orderLineItemId: string; quantity: number; description: string }>;
};
export type PickupReversalHistory = {
  status: "COMPLETED" | "REVERSED" | "PARTIALLY_REVERSED";
  remainingByLine: Record<string, number>;
  reversals: Array<{ id: string; createdAt: string | null; actorName: string | null; actorUserId: string | null; reason: string | null }>;
};
export function pickupReversalHistory(handoffId: string, items: Array<{ orderLineItemId: string; quantity: number }>,
  events: Array<{ id: string; eventType: string; payloadJson: unknown; createdAt?: Date | string | null; actorUserId?: string | null; actorFirstName?: string | null; actorLastName?: string | null }>): PickupReversalHistory {
  const matching = events.filter(e => e.eventType === "PICKUP_HANDOFF_REVERSED" && (e.payloadJson as any)?.sourceId === handoffId);
  const reversed = terminalReversalQuantitiesByLine(matching, items.map(i => i.orderLineItemId)).pickup;
  const remainingByLine = Object.fromEntries(items.map(i => [i.orderLineItemId, netTerminalFulfillmentQuantity(i.quantity, reversed.get(i.orderLineItemId) ?? 0)]));
  const hasReversed = items.some(i => (reversed.get(i.orderLineItemId) ?? 0) > 0);
  return { status: !hasReversed ? "COMPLETED" : items.every(i => remainingByLine[i.orderLineItemId] === 0) ? "REVERSED" : "PARTIALLY_REVERSED",
    remainingByLine, reversals: matching.map(e => ({ id: e.id, createdAt: e.createdAt ? new Date(e.createdAt).toISOString() : null,
      actorName: [e.actorFirstName, e.actorLastName].filter(Boolean).join(" ") || null, actorUserId: e.actorUserId ?? null,
      reason: typeof (e.payloadJson as any)?.reason === "string" ? (e.payloadJson as any).reason : null })) };
}

export function samePickupQuantities(a: Array<{ orderLineItemId: string; quantity: number }>, b: Array<{ orderLineItemId: string; quantity: number }>) {
  const totals = (items: typeof a) => { const result = new Map<string, number>(); for (const item of items) result.set(item.orderLineItemId, (result.get(item.orderLineItemId) ?? 0) + item.quantity); return result; };
  const left = totals(a), right = totals(b);
  return left.size === right.size && Array.from(left).every(([id, qty]) => right.get(id) === qty);
}

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
  if (context.box !== undefined && context.box !== null && (!quantity(context.box.current) || !quantity(context.box.total)
    || context.box.current < 1 || context.box.current > context.box.total)) return null;
  if ([context.pickupHandoffId, context.reprintOf].some(id => id !== undefined && (typeof id !== "string" || !id))) return null;
  if (context.fulfillmentMode !== "pickup" || !quantity(context.boxCount) || context.boxCount < 1 || context.boxCount > 100
    || !Array.isArray(context.lineQuantities) || !context.lineQuantities.length) return null;
  const ids = new Set<string>();
  for (const item of context.lineQuantities) {
    if (!item || typeof item.orderLineItemId !== "string" || !item.orderLineItemId || ids.has(item.orderLineItemId)
      || !quantity(item.quantity) || item.quantity === 0) return null;
    ids.add(item.orderLineItemId);
  }
  if (context.documentSnapshot) {
    const doc = context.documentSnapshot;
    if (typeof doc.orderId !== "string" || typeof doc.orderNumber !== "string" || typeof doc.customerName !== "string"
      || !Array.isArray(doc.lineItems) || doc.lineItems.some(l => !l || typeof l.orderLineItemId !== "string" || typeof l.description !== "string" || !quantity(l.quantity))
      || !samePickupQuantities(context.lineQuantities, doc.lineItems.map(l => ({ orderLineItemId: l.orderLineItemId!, quantity: l.quantity })))) return null;
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
    ...(context.box !== undefined ? { box: context.box } : {}),
    ...(context.pickupHandoffId ? { pickupHandoffId: context.pickupHandoffId } : {}),
    ...(context.reprintOf ? { reprintOf: context.reprintOf } : {}),
    ...(context.documentSnapshot ? { documentSnapshot: context.documentSnapshot } : {}),
    ...(snapshot ? { progressSnapshot: snapshot } : {}) };
}
