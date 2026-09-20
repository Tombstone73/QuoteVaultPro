/** Pure guards shared by terminal fulfillment correction writers and tests. */
function whole(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : 0;
}

export function netTerminalFulfillmentQuantity(originalQuantity: unknown, reversedQuantity: unknown): number {
  return Math.max(0, whole(originalQuantity) - whole(reversedQuantity));
}

export function canAppendTerminalFulfillmentReversal(input: {
  originalQuantity: unknown;
  alreadyReversedQuantity: unknown;
  requestedQuantity: unknown;
}): boolean {
  const requested = whole(input.requestedQuantity);
  return requested > 0 && requested <= netTerminalFulfillmentQuantity(input.originalQuantity, input.alreadyReversedQuantity);
}

/** Reads the append-only fulfillment-event ledger without trusting arbitrary
 * payload shapes. Only terminal-reversal event types contribute quantity. */
export function terminalReversalQuantitiesByLine(
  events: Array<{ eventType?: unknown; payloadJson?: unknown }>,
  lineItemIds: Iterable<string>,
): { shipment: Map<string, number>; pickup: Map<string, number> } {
  const wanted = new Set(Array.from(lineItemIds));
  const shipment = new Map<string, number>();
  const pickup = new Map<string, number>();
  for (const event of events) {
    const eventType = String(event.eventType || '').toUpperCase();
    const target = eventType === 'SHIPMENT_REVERSED' ? shipment : eventType === 'PICKUP_HANDOFF_REVERSED' ? pickup : null;
    if (!target || !event.payloadJson || typeof event.payloadJson !== 'object') continue;
    const items = (event.payloadJson as any).items;
    if (!Array.isArray(items)) continue;
    for (const item of items) {
      const lineItemId = String(item?.orderLineItemId || '');
      if (!wanted.has(lineItemId)) continue;
      target.set(lineItemId, (target.get(lineItemId) ?? 0) + whole(item?.quantity));
    }
  }
  return { shipment, pickup };
}
