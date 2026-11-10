import type { BulkFulfillmentPreview, BulkFulfillmentResult, BulkFulfillmentSelection } from '@shared/bulkFulfillment';

/** A successful shipment must not clear a line still present in another failed
 * unit. Whole-order selections retain all skipped/failed physical lines. */
export function remainingFulfillmentSelection(selection: BulkFulfillmentSelection, preview: BulkFulfillmentPreview, result: BulkFulfillmentResult): BulkFulfillmentSelection {
  const remaining: BulkFulfillmentSelection = [];
  for (const target of selection) {
    const requested = target.items ?? [...new Set(preview.units.flatMap(unit => unit.items).filter(item => item.orderId === target.orderId).map(item => item.orderLineItemId))].map(orderLineItemId => ({ orderLineItemId }));
    if (!requested.length) { remaining.push(target); continue; }
    const keep = requested.filter(item => {
      const units = preview.units.filter(unit => unit.items.some(row => row.orderId === target.orderId && row.orderLineItemId === item.orderLineItemId));
      return !units.length || units.some(unit => !unit.eligible || unit.items.some(row => row.orderLineItemId === item.orderLineItemId && !row.eligible)
        || !result.results.some(row => row.key === unit.key && row.status === 'succeeded' && row.items.some(line => line.orderId === target.orderId && line.orderLineItemId === item.orderLineItemId)));
    });
    if (keep.length) remaining.push(keep.length === requested.length && !target.items ? target : { orderId: target.orderId, items: keep });
  }
  return remaining;
}
