import { and, eq, sql } from 'drizzle-orm';
import { db } from '../../db';
import { auditLogs, fulfillmentEvents, orderLineItems, orders } from '@shared/schema';
import { FULFILLMENT_COMPLETED_ARCHIVED, FULFILLMENT_DELIVERY_CONFIRMED } from '@shared/fulfillmentDelivery';
import { canEditFulfillmentHistoryNotes } from '@shared/fulfillmentHistoryNote';
import { isCanceledOrder } from '@shared/operationalState';
import { FulfillmentDashboardRepo } from './repository';
import { readFulfillmentDelivery } from './deliveryReadModel';
import { FulfillmentHttpError } from './types';

type CompletionInput = { organizationId: string; orderId: string; actorUserId: string; actorOrgRole: string;
  reason: string; clientRequestId: string; expectedDeliveredByLine?: Record<string, number>; items?: Array<{ orderLineItemId: string; quantity: number; shipmentId?: string }> };

/** Delivery is a staff attestation of physical receipt, never a carrier scan,
 * production override, payment, or financial Order-closure operation. */
export async function recordFulfillmentCompletion(input: CompletionInput, action: 'delivered' | 'archive', database = db) {
  if (!canEditFulfillmentHistoryNotes(input.actorOrgRole)) throw new FulfillmentHttpError(403, 'Fulfillment operator access is required.', 'FULFILLMENT_FORBIDDEN');
  if (input.reason.trim().length < 10) throw new FulfillmentHttpError(400, 'Provide a reason for this confirmation.', 'REASON_REQUIRED');
  return database.transaction(async tx => {
    const [order] = await tx.select().from(orders).where(and(eq(orders.organizationId, input.organizationId), eq(orders.id, input.orderId))).for('no key update');
    if (!order) throw new FulfillmentHttpError(404, 'Order not found.', 'NOT_FOUND');
    if (isCanceledOrder(order)) throw new FulfillmentHttpError(409, 'Canceled orders cannot advance fulfillment.', 'ORDER_CANCELLED');
    await tx.execute(sql`select ${orderLineItems.id} from ${orderLineItems} where ${orderLineItems.orderId} = ${input.orderId} order by ${orderLineItems.id} for update`);
    const eventType = action === 'delivered' ? FULFILLMENT_DELIVERY_CONFIRMED : FULFILLMENT_COMPLETED_ARCHIVED;
    const [replay] = await tx.select().from(fulfillmentEvents).where(and(eq(fulfillmentEvents.organizationId, input.organizationId),
      eq(fulfillmentEvents.entityId, input.orderId), eq(fulfillmentEvents.eventType, eventType), sql`${fulfillmentEvents.payloadJson}->>'clientRequestId' = ${input.clientRequestId}`)).limit(1);
    if (replay) return { replayed: true, eventId: replay.id };
    const lines = (await new FulfillmentDashboardRepo(tx as unknown as typeof db).listLineEligibility(input.organizationId, { orderIds: [input.orderId] })).filter(line => line.projection.requiresFulfillment);
    if (!lines.length) throw new FulfillmentHttpError(409, 'No physical fulfillment quantities.', 'NO_PHYSICAL_LINES');
    const progress = await readFulfillmentDelivery(input.organizationId, [input.orderId], tx);
    const deliveries: Array<{ orderId: string; orderLineItemId: string; shipmentId: string; quantity: number }> = [];
    const archivedLineIds = action === 'archive' && input.items?.length ? input.items.map(item => item.orderLineItemId) : lines.map(line => line.id);
    if (action === 'archive' && (new Set(archivedLineIds).size !== archivedLineIds.length || archivedLineIds.some(id => !lines.some(line => line.id === id)))) throw new FulfillmentHttpError(409, 'Archive line selection changed.', 'INVALID_QUANTITY');
    if (action === 'archive' && lines.filter(line => archivedLineIds.includes(line.id)).some(line => line.projection.productionCompleteQuantity < line.projection.orderedQuantity)) throw new FulfillmentHttpError(409, 'Resolve production completion for the selected lines before archiving.', 'PRODUCTION_NOT_COMPLETE');
    if (action === 'delivered') {
      if (order.shippingMethod === 'pickup') throw new FulfillmentHttpError(409, 'Use pickup handoff for pickup orders.', 'FULFILLMENT_METHOD_MISMATCH');
      const ids = new Set<string>();
      for (const item of input.items ?? []) {
        const line = lines.find(line => line.id === item.orderLineItemId);
        if (!line || ids.has(item.orderLineItemId) || !Number.isSafeInteger(item.quantity) || item.quantity <= 0) throw new FulfillmentHttpError(409, 'Invalid delivery quantity or line.', 'INVALID_QUANTITY');
        ids.add(item.orderLineItemId);
        const deliveredBefore = progress.filter(row => row.orderLineItemId === item.orderLineItemId).reduce((sum, row) => sum + row.deliveredQuantity, 0);
        if (input.expectedDeliveredByLine && deliveredBefore !== input.expectedDeliveredByLine[item.orderLineItemId]) throw new FulfillmentHttpError(409, 'Delivered quantities changed after review. Preview again.', 'DELIVERY_QUANTITY_CHANGED');
        if (line.projection.productionCompleteQuantity < line.projection.orderedQuantity) throw new FulfillmentHttpError(409, 'Resolve production completion before confirming delivery.', 'PRODUCTION_NOT_COMPLETE');
        const sources = progress.filter(row => row.orderLineItemId === item.orderLineItemId && row.pendingDeliveryQuantity > 0 && (!item.shipmentId || row.shipmentId === item.shipmentId));
        if (!sources.length) throw new FulfillmentHttpError(409, 'The selected shipment has no undelivered quantity for this line. Preview again.', 'DELIVERY_SOURCE_REQUIRED');
        if (sources.length > 1 && item.quantity < sources.reduce((sum, row) => sum + row.pendingDeliveryQuantity, 0)) throw new FulfillmentHttpError(409, 'Partial delivery is ambiguous across multiple shipments. Review the source shipment evidence.', 'DELIVERY_SOURCE_REQUIRED');
        let remaining = item.quantity;
        for (const source of sources) {
          const quantity = Math.min(remaining, source.pendingDeliveryQuantity);
          if (quantity > 0) deliveries.push({ orderId: input.orderId, orderLineItemId: item.orderLineItemId, shipmentId: source.shipmentId, quantity });
          remaining -= quantity;
        }
        if (remaining > 0) throw new FulfillmentHttpError(409, 'Delivery exceeds shipped, undelivered quantity. Refresh and review.', 'DELIVERY_QUANTITY_CHANGED');
      }
      if (!deliveries.length) throw new FulfillmentHttpError(409, 'Select shipped quantities to confirm.', 'DELIVERY_REQUIRED');
    }
    const lineComplete = (line: typeof lines[number]) => {
      const delivered = progress.filter(row => row.orderLineItemId === line.id).reduce((sum, row) => sum + row.deliveredQuantity, 0)
        + deliveries.filter(row => row.orderLineItemId === line.id).reduce((sum, row) => sum + row.quantity, 0);
      return line.projection.pickedUpQuantity + delivered + line.projection.administrativelyReconciledQuantity >= line.projection.orderedQuantity;
    };
    const complete = lines.every(lineComplete) && lines.every(line => line.projection.productionCompleteQuantity >= line.projection.orderedQuantity);
    if (action === 'archive' && lines.filter(line => archivedLineIds.includes(line.id)).some(line => !lineComplete(line))) throw new FulfillmentHttpError(409, 'Every selected physical line must be picked up, delivered, or explicitly administratively reconciled before archiving.', 'FULFILLMENT_NOT_COMPLETE');
    const now = new Date();
    const [event] = await tx.insert(fulfillmentEvents).values({ organizationId: input.organizationId, entityType: 'ORDER', entityId: input.orderId,
      actorUserId: input.actorUserId, eventType, payloadJson: { clientRequestId: input.clientRequestId, reason: input.reason,
        source: 'staff_confirmation', confirmedAt: now.toISOString(), items: deliveries, ...(action === 'archive' ? { archivedLineIds } : {}), complete, carrierObservation: false, financialStateChanged: false } }).returning();
    if (action === 'delivered' && complete) await tx.update(orders).set({ fulfillmentStatus: 'delivered', updatedAt: now.toISOString() })
      .where(and(eq(orders.organizationId, input.organizationId), eq(orders.id, input.orderId)));
    await tx.insert(auditLogs).values({ organizationId: input.organizationId, userId: input.actorUserId, actionType: eventType.toLowerCase(),
      entityType: 'order', entityId: input.orderId, description: input.reason, newValues: { eventId: event.id, items: deliveries, complete, carrierObservation: false, financialStateChanged: false } });
    return { eventId: event.id, complete, replayed: false };
  });
}
