import { useBulkFulfillmentContext } from '@/hooks/useBulkFulfillment';
import { Button } from '@/components/ui/button';
import type { BulkFulfillmentOrderContext } from '@shared/bulkFulfillment';
import { useState } from 'react';

export function FulfillmentLineSelection({ orderId, wholeOrder, selected, selectedShipments = {}, showCompleted = false, onChange }: {
  orderId: string; wholeOrder: boolean; selected: Record<string, number | undefined>;
  showCompleted?: boolean;
  selectedShipments?: Record<string, string>;
  onChange: (context: BulkFulfillmentOrderContext, lineId: string, checked: boolean, quantity?: number, shipmentId?: string) => void;
}) {
  const query = useBulkFulfillmentContext(orderId);
  const [includeCompleted, setIncludeCompleted] = useState(false);
  if (query.isLoading) return <p className="p-4 text-sm">Loading line quantities…</p>;
  if (!query.data) return <div className="p-4 text-sm text-destructive">Unable to load physical line items. <Button variant="outline" size="sm" onClick={() => void query.refetch()}>Retry</Button></div>;
  const context = query.data;
  return <div className="space-y-2 p-3" onClick={event => event.stopPropagation()}>
    <p className="text-xs text-muted-foreground">Choose individual lines and an optional quantity. Blank quantity uses the eligible quantity shown in the action preview.</p>
    {context.lines.some(line => line.completed) && <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={showCompleted || includeCompleted} disabled={showCompleted} onChange={event => setIncludeCompleted(event.target.checked)} />Show completed lines</label>}
    {context.lines.filter(line => !line.completed || showCompleted || includeCompleted).map(line => {
      const checked = wholeOrder || Object.hasOwn(selected, line.orderLineItemId);
      return <div key={line.orderLineItemId} className="grid gap-2 rounded-md border border-border bg-card p-3 text-sm sm:grid-cols-[auto_1fr_9rem]">
        <input type="checkbox" aria-label={`Select line ${line.label}`} checked={checked} onChange={event => onChange(context, line.orderLineItemId, event.target.checked)} />
        <div><p className="font-medium">{line.label}{line.completed ? ' · Completed' : ''}</p><p className="text-xs text-muted-foreground">Ordered {line.orderedQuantity} · Production complete {line.productionCompleteQuantity} · Ready {line.readyQuantity} · Remaining {line.remainingQuantity} · Picked up {line.pickedUpQuantity} · Shipped {line.shippedQuantity} · Delivered {line.deliveredQuantity}</p>
          {!!line.deliverySources?.length && <label className="mt-2 block text-xs">Delivery shipment (used for Mark Delivered)<select aria-label={`Delivery shipment for ${line.label}`} disabled={!checked}
            className="ml-2 max-w-full rounded border border-input bg-background p-1" value={selectedShipments[line.orderLineItemId] ?? ''}
            onChange={event => onChange(context, line.orderLineItemId, true, selected[line.orderLineItemId], event.target.value)}>
            <option value="">All outstanding shipments</option>{line.deliverySources.map(source => <option key={source.shipmentId} value={source.shipmentId}>{source.label} · {source.pendingQuantity} undelivered</option>)}
          </select></label>}
        </div>
        <label className="text-xs">Action quantity<input type="number" min={1} max={line.orderedQuantity} placeholder="Eligible quantity" aria-label={`Quantity for ${line.label}`} value={selected[line.orderLineItemId] ?? ''} disabled={!checked}
          className="mt-1 w-full rounded border border-input bg-background px-2 py-1 text-sm" onChange={event => {
            const value = event.target.value === '' ? undefined : Number(event.target.value);
            if (value === undefined || (Number.isInteger(value) && value > 0)) onChange(context, line.orderLineItemId, true, value);
          }} /></label>
      </div>;
    })}
    {!context.lines.length && <p className="text-sm text-muted-foreground">No physical fulfillment lines.</p>}
  </div>;
}
