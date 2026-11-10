import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from '../../db';
import { fulfillmentEvents, shipmentItems, shipments } from '@shared/schema';
import { FULFILLMENT_DELIVERY_CONFIRMED, projectDeliveryQuantities } from '@shared/fulfillmentDelivery';

export async function readFulfillmentDelivery(orgId: string, orderIds: string[], runner: Pick<typeof db, 'select'> = db) {
  if (!orderIds.length) return [];
  const allocations = await runner.select({ shipmentId: shipments.id, orderId: shipmentItems.orderId,
    orderLineItemId: shipmentItems.orderLineItemId, quantity: shipmentItems.quantity, deliveredAt: shipments.deliveredAt })
    .from(shipmentItems).innerJoin(shipments, eq(shipments.id, shipmentItems.shipmentId))
    .where(and(eq(shipmentItems.organizationId, orgId), eq(shipments.organizationId, orgId), eq(shipments.status, 'SHIPPED'), inArray(shipmentItems.orderId, orderIds)));
  if (!allocations.length) return [];
  const lineIds = [...new Set(allocations.map(item => item.orderLineItemId))];
  const events = await runner.select({ eventType: fulfillmentEvents.eventType, payloadJson: fulfillmentEvents.payloadJson }).from(fulfillmentEvents)
    .where(and(eq(fulfillmentEvents.organizationId, orgId), inArray(fulfillmentEvents.eventType, [FULFILLMENT_DELIVERY_CONFIRMED, 'SHIPMENT_REVERSED']),
      sql`exists (select 1 from jsonb_array_elements(case when jsonb_typeof(${fulfillmentEvents.payloadJson}->'items') = 'array'
        then ${fulfillmentEvents.payloadJson}->'items' else '[]'::jsonb end) item where ${inArray(sql`item->>'orderLineItemId'`, lineIds)})`));
  return projectDeliveryQuantities(allocations, events);
}
