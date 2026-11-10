export const FULFILLMENT_DELIVERY_CONFIRMED = 'FULFILLMENT_DELIVERY_CONFIRMED';
export const FULFILLMENT_COMPLETED_ARCHIVED = 'FULFILLMENT_COMPLETED_ARCHIVED';
export type DeliveryAllocation = { shipmentId: string; orderId: string; orderLineItemId: string; quantity: number; deliveredAt: Date | string | null };
type Event = { eventType: string; payloadJson: Record<string, any> };

/** Staff delivery attestations remain separate from carrier observations. Net
 * each shipment independently so reversing/reshipping never inherits delivery. */
export function projectDeliveryQuantities(allocations: DeliveryAllocation[], events: Event[]) {
  const totals = new Map<string, { shipmentId: string; orderId: string; orderLineItemId: string; shipped: number; delivered: number; reversed: number; timestamp: boolean }>();
  const key = (shipmentId: string, lineId: string) => `${shipmentId}:${lineId}`;
  for (const item of allocations) {
    const id = key(item.shipmentId, item.orderLineItemId);
    const row = totals.get(id) ?? { ...item, shipped: 0, delivered: 0, reversed: 0, timestamp: false };
    row.shipped += Number(item.quantity); row.timestamp ||= Boolean(item.deliveredAt); totals.set(id, row);
  }
  for (const event of events) {
    if (![FULFILLMENT_DELIVERY_CONFIRMED, 'SHIPMENT_REVERSED'].includes(event.eventType)) continue;
    for (const item of event.payloadJson.items ?? []) {
      const row = totals.get(key(item.shipmentId ?? event.payloadJson.sourceId, item.orderLineItemId));
      if (!row || !Number.isSafeInteger(item.quantity) || item.quantity <= 0) continue;
      if (event.eventType === 'SHIPMENT_REVERSED') row.reversed += item.quantity;
      else row.delivered += item.quantity;
    }
  }
  return [...totals.values()].map(row => {
    const shippedQuantity = Math.max(0, row.shipped - row.reversed);
    const deliveredQuantity = row.timestamp ? shippedQuantity : Math.min(shippedQuantity, Math.max(0, row.delivered - row.reversed));
    return { shipmentId: row.shipmentId, orderId: row.orderId, orderLineItemId: row.orderLineItemId, shippedQuantity, deliveredQuantity, pendingDeliveryQuantity: shippedQuantity - deliveredQuantity };
  });
}
