import { z } from 'zod';
import { effectiveOrderFulfillmentMethod } from './orderFulfillmentMethod';
import { isCanceledOrder } from './operationalState';
import type { FulfillmentLineQuantityProjection } from './fulfillmentReadiness';

export const ADMINISTRATIVE_FULFILLMENT_REOPENED = 'ADMINISTRATIVE_FULFILLMENT_REOPENED';
export const administrativeReopenSchema = z.object({
  expectedState: z.string().min(1),
  clientRequestId: z.string().uuid(),
  reason: z.string().trim().min(1).max(2000),
  items: z.array(z.object({ orderLineItemId: z.string().min(1), quantity: z.number().int().positive() })).min(1),
});

export function administrativeReopenedByLine(events: Array<{ eventType: string; payloadJson: any }>) {
  const quantities = new Map<string, number>();
  for (const event of events) {
    if (event.eventType !== ADMINISTRATIVE_FULFILLMENT_REOPENED || event.payloadJson?.mode !== 'administrative') continue;
    for (const item of event.payloadJson.items ?? []) {
      if (typeof item.orderLineItemId === 'string' && Number.isSafeInteger(item.quantity) && item.quantity > 0) {
        quantities.set(item.orderLineItemId, (quantities.get(item.orderLineItemId) ?? 0) + item.quantity);
      }
    }
  }
  return quantities;
}

export function administrativeCorrectionPreview(order: { state?: string | null; status?: string | null; canceledAt?: string | Date | null; fulfillmentStatus?: string | null; shippingMethod?: string | null }, lines: Array<{ id: string; projection: FulfillmentLineQuantityProjection }>) {
  const physical = lines.filter(line => line.projection.requiresFulfillment);
  const administrative = physical.some(line => line.projection.administrativelyReconciledQuantity > 0);
  const terminal = order.state === 'closed' || order.status === 'operationally_complete' || ['shipped', 'delivered'].includes(String(order.fulfillmentStatus).toLowerCase());
  // A legacy parent can suppress active work without consuming canonical
  // quantity. Reconcile that contradiction now; never invent an old handoff.
  const legacy = !administrative && terminal && physical.some(line => line.projection.remainingQuantity > 0);
  const mode = administrative ? 'administrative' as const : legacy ? 'legacy' as const : null;
  const blockedReason = isCanceledOrder(order) ? 'Cancelled Orders cannot be reopened here.'
    : !physical.length ? 'No physical fulfillment obligations.'
    : physical.some(line => line.projection.productionCompleteQuantity < line.projection.orderedQuantity) ? 'Production is incomplete; this correction cannot reopen production.'
    : !mode ? 'No administrative or unresolved legacy completion to reopen. Use physical history for shipment or pickup corrections.' : null;
  return {
    mode, blockedReason, method: effectiveOrderFulfillmentMethod(order.shippingMethod),
    lines: physical.map(({ id, projection: p }) => ({ orderLineItemId: id, orderedQuantity: p.orderedQuantity, physicallyFulfilledQuantity: p.fulfilledQuantity, administrativelyResolvedQuantity: p.administrativelyReconciledQuantity, legacyClosedQuantity: legacy ? p.remainingQuantity : 0, reopenableQuantity: administrative ? p.administrativelyReconciledQuantity : legacy ? p.remainingQuantity : 0 })),
  };
}

export type AdministrativeCorrectionPreview = ReturnType<typeof administrativeCorrectionPreview> & { expectedState: string };

export function validateAdministrativeReopen(preview: AdministrativeCorrectionPreview, input: z.infer<typeof administrativeReopenSchema>) {
  if (preview.blockedReason || !preview.mode) throw new Error(preview.blockedReason || 'No resolution to reopen.');
  if (input.expectedState !== preview.expectedState) throw new Error('Fulfillment changed. Refresh and review the correction again.');
  const ids = new Set<string>();
  for (const item of input.items) {
    const line = preview.lines.find(line => line.orderLineItemId === item.orderLineItemId);
    if (ids.has(item.orderLineItemId) || !line || item.quantity > line.reopenableQuantity) throw new Error('Correction exceeds the available administrative quantity.');
    ids.add(item.orderLineItemId);
  }
  if (preview.mode === 'legacy' && preview.lines.some(line => line.reopenableQuantity > 0 && !input.items.some(item => item.orderLineItemId === line.orderLineItemId && item.quantity === line.reopenableQuantity))) throw new Error('Legacy reconciliation must reopen all unresolved quantities.');
}
