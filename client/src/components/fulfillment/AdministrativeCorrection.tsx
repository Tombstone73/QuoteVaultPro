import { useState } from 'react';
import type { FulfillmentDetail } from '@/hooks/useFulfillment';
import { useReopenAdministrativeFulfillmentMutation, toFulfillmentError } from '@/hooks/useFulfillment';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

export function AdministrativeCorrection({ detail }: { detail: FulfillmentDetail }) {
  const mutation = useReopenAdministrativeFulfillmentMutation(detail.orderId);
  const [preview, setPreview] = useState<typeof detail.administrativeCorrection>();
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [reason, setReason] = useState('');
  const [requestId, setRequestId] = useState('');
  const [error, setError] = useState('');
  const current = detail.administrativeCorrection;
  if (!current) return null;
  const allowed = detail.permissions?.canReverseTerminalFulfillment;
  const label = current.mode === 'legacy' ? 'Reconcile legacy completion' : 'Reopen administrative resolution';
  return <section className="space-y-3 rounded-xl border bg-card p-4">
    <h2 className="font-bold">Administrative / Legacy Correction</h2>
    {current.blockedReason ? <p className="text-sm text-muted-foreground">{current.blockedReason}</p> : !allowed ? <p className="text-sm text-muted-foreground">Owner or Admin authority is required to reopen this resolution.</p> : <>
      {!preview && <Button onClick={() => { setPreview(current); setQuantities(Object.fromEntries(current.lines.map(line => [line.orderLineItemId, line.reopenableQuantity]))); setRequestId(crypto.randomUUID()); setError(''); }}>{label}</Button>}
      {preview && <div className="space-y-3">
        <p className="text-sm">Review before reopening. Physical shipment and pickup history will remain unchanged. Method: {preview.method}.</p>
        {preview.lines.filter(line => line.reopenableQuantity > 0).map(line => <div key={line.orderLineItemId} className="space-y-1 border-t pt-2 text-sm">
          <p className="font-semibold">{detail.lineItems.find(item => item.id === line.orderLineItemId)?.productName || 'Line item'}</p>
          <p>Ordered {line.orderedQuantity} · Physical fulfilled {line.physicallyFulfilledQuantity} · Administratively resolved {line.administrativelyResolvedQuantity} · Legacy closed {line.legacyClosedQuantity}</p>
          <label>Quantity to reopen<Input aria-label={`Reopen quantity ${line.orderLineItemId}`} type="number" min={0} max={line.reopenableQuantity} disabled={mutation.isPending || preview.mode === 'legacy'} value={quantities[line.orderLineItemId] ?? 0} onChange={event => { setQuantities(values => ({ ...values, [line.orderLineItemId]: Number(event.target.value) })); setRequestId(crypto.randomUUID()); }} /></label>
        </div>)}
        <Textarea aria-label="Administrative correction reason" placeholder="Required reason" maxLength={2000} value={reason} disabled={mutation.isPending} onChange={event => { setReason(event.target.value); setRequestId(crypto.randomUUID()); }} />
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <div className="flex gap-2"><Button variant="outline" disabled={mutation.isPending} onClick={() => setPreview(undefined)}>Cancel</Button><Button disabled={mutation.isPending || !reason.trim() || !Object.values(quantities).some(q => q > 0)} onClick={async () => {
          try { await mutation.mutateAsync({ expectedState: preview.expectedState, clientRequestId: requestId, reason: reason.trim(), items: Object.entries(quantities).filter(([, quantity]) => quantity > 0).map(([orderLineItemId, quantity]) => ({ orderLineItemId, quantity })) }); setPreview(undefined); setReason(''); }
          catch (error) { setError(toFulfillmentError(error).message); }
        }}>{mutation.isPending ? 'Reopening…' : 'Confirm reopen fulfillment'}</Button></div>
      </div>}
    </>}
    {detail.events.filter(event => ['FULFILLMENT_ADMINISTRATIVELY_RESOLVED', 'FULFILLMENT_HISTORICAL_RECONCILED', 'ADMINISTRATIVE_FULFILLMENT_REOPENED'].includes(event.eventType)).map(event => <div key={event.id} className="border-t pt-2 text-sm">
      <p>{event.eventType === 'ADMINISTRATIVE_FULFILLMENT_REOPENED' ? 'Fulfillment reopened' : 'Administratively resolved'} · {String(event.payloadJson?.reason || '')}</p>
      <p className="text-xs text-muted-foreground">{event.actorName || 'Staff'} · {new Date(event.createdAt).toLocaleString()}</p>
    </div>)}
  </section>;
}
