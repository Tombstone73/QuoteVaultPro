import { useEffect, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useBulkFulfillmentExecute, useBulkFulfillmentPreview } from '@/hooks/useBulkFulfillment';
import { toFulfillmentError } from '@/hooks/useFulfillment';
import { bulkFulfillmentActions, type BulkFulfillmentAction, type BulkFulfillmentExecute, type BulkFulfillmentPreview, type BulkFulfillmentResult, type BulkFulfillmentSelection } from '@shared/bulkFulfillment';

export function BulkFulfillmentDialog({ action, selection, onClose, onProcessed }: {
  action: BulkFulfillmentAction; selection: BulkFulfillmentSelection; onClose: () => void;
  onProcessed: (preview: BulkFulfillmentPreview, result: BulkFulfillmentResult) => void;
}) {
  const previewMutation = useBulkFulfillmentPreview(), execute = useBulkFulfillmentExecute();
  const [preview, setPreview] = useState<BulkFulfillmentPreview | null>(null), [result, setResult] = useState<BulkFulfillmentResult | null>(null);
  const [error, setError] = useState(''), [confirmed, setConfirmed] = useState(false), [legacyConfirmed, setLegacyConfirmed] = useState(false);
  const [reason, setReason] = useState(action === 'legacy' ? '' : `${bulkFulfillmentActions[action]} from the Fulfillment bulk selection.`);
  const [pickupDate, setPickupDate] = useState('');
  const request = useRef<BulkFulfillmentExecute | null>(null);
  const submitting = useRef(false);
  const load = async () => {
    setError(''); setConfirmed(false); request.current = null;
    try { setPreview(await previewMutation.mutateAsync({ action, selection })); }
    catch (error) { setError(error instanceof Error ? error.message : 'Unable to load eligibility.'); }
  };
  useEffect(() => { void load(); }, []);
  const submit = async () => {
    if (!preview || !confirmed || submitting.current) return;
    submitting.current = true;
    request.current ??= { action, selection, requestId: crypto.randomUUID(), previewToken: preview.previewToken, confirmed: true,
      reason, ...(action === 'legacy' ? { legacyConfirmed } : {}), ...(pickupDate ? { effectivePickupDate: pickupDate } : {}) };
    setError('');
    try { const saved = await execute.mutateAsync(request.current); setResult(saved); onProcessed(preview, saved); }
    catch (error) {
      const parsed = toFulfillmentError(error);
      if (['BULK_PREVIEW_STALE', 'VALIDATION_ERROR', 'FULFILLMENT_BULK_FORBIDDEN', 'LEGACY_CONFIRMATION_REQUIRED'].includes(parsed.code ?? '')) request.current = null;
      setError(parsed.message || 'Request interrupted. Retry the same operation to recover safely.');
    } finally { submitting.current = false; }
  };
  const busy = previewMutation.isPending || execute.isPending;
  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose(); }}><DialogContent className="flex max-h-[90dvh] max-w-3xl flex-col overflow-hidden" onEscapeKeyDown={event => { if (busy) event.preventDefault(); }} onInteractOutside={event => { if (busy) event.preventDefault(); }}>
    <DialogHeader><DialogTitle>{bulkFulfillmentActions[action]}</DialogTitle><DialogDescription>{action === 'legacy'
      ? 'Separate administrative reconciliation for historically fulfilled jobs. Production safeguards still apply. This does not create physical shipments, carrier scans, or payments.'
      : action === 'delivered' ? 'Confirm receipt of the selected shipped quantities. This records staff confirmation separately from carrier tracking.'
        : action === 'archive' ? 'Only fully completed physical obligations can leave the active queue. History remains searchable.'
          : 'Review exact quantities and eligibility. Each order or saved shipment is processed separately; successful work is retained if another item fails.'}</DialogDescription></DialogHeader>
    <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
      {previewMutation.isPending && <p role="status">Checking eligibility…</p>}
      {error && <p role="alert" className="rounded border border-destructive p-3 text-sm text-destructive">{error}</p>}
      {preview && !result && <>
        <p className="font-medium">{preview.eligibleCount} eligible items · {preview.skippedCount} skipped items · {preview.selectedOrderCount} selected orders</p>
        <div className="space-y-3">{preview.units.map(unit => <div key={unit.key} className="rounded border border-border p-3 text-sm">
          <p className="font-semibold">{unit.orderNumber} · {unit.eligible ? 'Eligible' : 'Skipped'}</p>
          {unit.requirements.map((message, index) => <p key={index} className="text-amber-600 dark:text-amber-400">{message}</p>)}
          <ul className="mt-1 space-y-1">{unit.items.map(item => <li key={`${item.orderId}:${item.orderLineItemId}`}><span>{item.label}: {item.quantity} units{!item.eligible ? ' · Skipped' : ''}</span>{item.requirements.map((message, index) => <p key={index} className="text-xs text-muted-foreground">{message}</p>)}</li>)}</ul>
          {action === 'shipped' && (!unit.eligible || unit.requirements.length > 0) && <a className="mt-2 inline-block text-primary underline" target="_blank" rel="noopener noreferrer"
            href={unit.shipmentId ? `/fulfillment/shipments/${unit.shipmentId}` : `/fulfillment/orders/${unit.orderIds[0]}`}>Complete shipping details in workspace</a>}
        </div>)}</div>
        <label className="block text-sm">{action === 'legacy' ? 'Required reason' : 'Confirmation note'}<textarea className="mt-1 w-full rounded border border-input bg-background p-2" maxLength={500} value={reason} disabled={busy || Boolean(request.current)} onChange={event => setReason(event.target.value)} /></label>
        {action === 'picked_up' && <label className="block text-sm">Effective pickup date (blank uses today)<input className="ml-2 rounded border border-input bg-background p-1" type="date" value={pickupDate} disabled={busy || Boolean(request.current)} onChange={event => setPickupDate(event.target.value)} /></label>}
        {action === 'legacy' && <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={legacyConfirmed} disabled={busy || Boolean(request.current)} onChange={event => setLegacyConfirmed(event.target.checked)} />I authorize administrative reconciliation of historically fulfilled jobs and confirm the reason above.</label>}
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={confirmed} disabled={busy || Boolean(request.current)} onChange={event => setConfirmed(event.target.checked)} />I confirm the eligible items and quantities shown above. Skipped items will remain selected.</label>
      </>}
      {result && <div role="status" className="space-y-3"><p className="font-semibold">{result.results.filter(row => row.status === 'succeeded').length} completed operations · {preview?.skippedCount ?? 0} skipped items · {result.results.filter(row => row.status === 'failed').length} failed operations</p>
        {result.results.map(row => <div key={row.key} className="rounded border border-border p-3 text-sm"><p className="font-medium">{preview?.units.find(unit => unit.key === row.key)?.orderNumber ?? row.key} · {row.status}</p><p>{row.message}</p></div>)}
        <p className="text-sm text-muted-foreground">Successful selections were cleared. Review the remaining selections and start a fresh preview after resolving any requirements.</p>
      </div>}
    </div>
    <DialogFooter className="shrink-0"><Button variant="outline" disabled={busy} onClick={onClose}>{result ? 'Done' : 'Cancel'}</Button>
      {!result && <Button variant="outline" disabled={busy || Boolean(request.current)} onClick={() => void load()}>Refresh preview</Button>}
      {!result && <Button disabled={busy || !preview?.eligibleCount || !confirmed || reason.trim().length < 10 || (action === 'legacy' && !legacyConfirmed)} onClick={() => void submit()}>{execute.isPending ? 'Processing…' : request.current ? 'Retry same operation' : `Confirm ${bulkFulfillmentActions[action]}`}</Button>}
    </DialogFooter>
  </DialogContent></Dialog>;
}
