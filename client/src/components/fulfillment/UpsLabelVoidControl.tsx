import { useRef, useState } from 'react';
import { apiFetchBlob } from '@/lib/queryClient';
import { apiCall, toFulfillmentError } from '@/hooks/useFulfillment';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';

async function timedApiCall<T>(path: string, init: RequestInit = {}, timeoutMs = 15_000): Promise<T> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try { return await apiCall<T>(path, { ...init, signal: controller.signal }); }
  catch (error) {
    if (controller.signal.aborted) throw new Error('Request timed out. Review refreshed UPS history before taking another action.');
    throw error;
  } finally { window.clearTimeout(timer); }
}

export type VoidableUpsPurchase = {
  id: string; status: string; environment: string; serviceName: string;
  providerShipmentId: string | null; voidRequestedAt?: string | null;
  labels: Array<{ id: string; trackingNumber: string; providerResultOrdinal: number | null }>;
  voidResult?: { packages?: Array<{ trackingNumber: string; code: string }> } | null;
};
/** One confirmation/reconciliation surface for draft shipment and Shipping History. */
export function UpsLabelVoidControl({ shipmentId, shipmentReference, shipmentStatus, purchaseId, onChanged }: {
  shipmentId: string; shipmentReference: string; shipmentStatus: string; purchaseId?: string;
  onChanged?: () => Promise<unknown>;
}) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<VoidableUpsPurchase[]>([]);
  const [busy, setBusy] = useState(false);
  const [historyReady, setHistoryReady] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [confirmed, setConfirmed] = useState<string[]>([]);
  const [reference, setReference] = useState('');
  const [reason, setReason] = useState('');
  const inFlight = useRef(false);
  const endpoint = `/api/fulfillment/shipments/${shipmentId}/ups-labels`;
  const load = async () => {
    const history = await timedApiCall<VoidableUpsPurchase[]>(endpoint);
    setHistoryReady(true);
    setRows(purchaseId ? history.filter(row => row.id === purchaseId) : history);
    return history;
  };
  const show = async () => {
    if (inFlight.current) return;
    inFlight.current = true; setOpen(true); setBusy(true); setHistoryReady(false); setError(''); setMessage('');
    setRows([]); setConfirmed([]); setReason(''); setReference('');
    try { await load(); } catch (err) { setError(toFulfillmentError(err).message); }
    finally { inFlight.current = false; setBusy(false); }
  };
  const perform = async (row: VoidableUpsPurchase, reconcile = false) => {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setHistoryReady(false); setError(''); setMessage('');
    try {
      await timedApiCall(`${endpoint}/${row.id}/${reconcile ? 'external-cancellation' : 'void'}`, {
        method: 'POST', ...(reconcile ? { body: JSON.stringify({ reason: reason.trim(), reference: reference.trim(),
          confirmedTrackingNumbers: row.labels.map(label => label.trackingNumber) }) } : {}),
      }, 45_000);
      setMessage(reconcile
        ? 'Your UPS cancellation confirmation was recorded. This remains an operator-reported cancellation, not an API-confirmed void.'
        : 'UPS confirmed cancellation. Carrier credit is not confirmed.');
    } catch (err) { setError(toFulfillmentError(err).message); }
    finally {
      // A failed browser response is not permission to repeat a carrier mutation.
      try { await load(); await onChanged?.(); }
      catch { setError(previous => `${previous ? `${previous} ` : ''}History could not refresh. Reload and review the latest UPS result before another action.`); }
      inFlight.current = false; setBusy(false); setConfirmed([]);
    }
  };
  const downloadEvidence = async (row: VoidableUpsPurchase, label: VoidableUpsPurchase['labels'][number]) => {
    try {
      const blob = await apiFetchBlob(`${endpoint}/${row.id}/labels/${label.id}/image`);
      const url = URL.createObjectURL(blob); const link = document.createElement('a');
      link.href = url; link.download = `NOT-FOR-SHIPPING-UPS-${label.trackingNumber}.gif`; link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) { setError(toFulfillmentError(err).message); }
  };
  return <>
    <Button type="button" variant="outline" size="sm" onClick={() => void show()}>Void UPS Label</Button>
    <Dialog open={open} onOpenChange={value => { if (!inFlight.current) setOpen(value); }}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader><DialogTitle>Void UPS Label</DialogTitle><DialogDescription>
          Shipment {shipmentReference} · {shipmentStatus}. Owner or Admin authorization is required.
          Cancels the entire UPS shipment, including every package below. UPS determines eligibility.
          This does not reverse shipped quantities, refund payments, or change invoice balances.
        </DialogDescription></DialogHeader>
        {busy && <p role="status">Checking UPS label history / processing request…</p>}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        {message && <p role="status" className="text-sm">{message}</p>}
        {!busy && !rows.length && !error && <p>No purchased UPS labels are recorded for this shipment.</p>}
        {rows.map(row => {
          const uncertain = ['VOID_UNCERTAIN', 'VOID_REQUESTING'].includes(row.status);
          const reconcileAvailable = row.status === 'VOID_UNCERTAIN' || (row.status === 'VOID_REQUESTING' &&
            !!row.voidRequestedAt && Date.now() - Date.parse(row.voidRequestedAt) >= 120_000);
          return <section key={row.id} className="space-y-3 rounded border p-3 text-sm">
            <p className="font-semibold">{row.serviceName} · {row.environment} · {row.status.replaceAll('_', ' ')}</p>
            <p className="break-all">UPS shipment: {row.providerShipmentId ?? 'Unavailable'}</p>
            <ul className="space-y-1">{row.labels.map(label => {
              const result = row.voidResult?.packages?.find(item => item.trackingNumber === label.trackingNumber);
              return <li key={label.id} className="break-all">Package {label.providerResultOrdinal ?? '—'} · {label.trackingNumber}
                {result && <span> · UPS: {result.code === '1' ? 'Voided or already voided' : result.code === '0' ? 'Not voided' : 'Unknown'}</span>}
                <Button type="button" variant="link" size="sm" disabled={busy} onClick={() => void downloadEvidence(row, label)}>Download original evidence (not for shipping)</Button>
              </li>;
            })}</ul>
            {['PURCHASED', 'MAPPING_REQUIRED'].includes(row.status) && <>
              <p>Confirm that none of these labels should be used. All original labels and history will remain available.</p>
              <Button type="button" variant="destructive" disabled={busy || !historyReady || !['DRAFT', 'SHIPPED'].includes(shipmentStatus)} onClick={() => void perform(row)}>Confirm void of all {row.labels.length} UPS labels</Button>
            </>}
            {uncertain && <>
              <p>Do not retry the void or buy a replacement. Check every tracking number in the UPS account or contact UPS support.
                No automatic void-status verification is available here. A missing tracking event is not confirmation.</p>
              {reconcileAvailable ? <fieldset disabled={busy || !historyReady} className="space-y-2"><legend className="font-semibold">Record verified cancellation from UPS</legend>
                <p>Only proceed after UPS confirms every package was voided. Leave partial or unknown results unresolved.</p>
                {row.labels.map(label => <label key={label.id} className="flex items-start gap-2 break-all">
                  <input type="checkbox" checked={confirmed.includes(label.id)} onChange={event => setConfirmed(previous => event.target.checked ? [...previous, label.id] : previous.filter(id => id !== label.id))} />
                  UPS confirmed cancellation: {label.trackingNumber}
                </label>)}
                <label className="block">UPS confirmation / support reference<Input value={reference} maxLength={160} onChange={event => setReference(event.target.value)} /></label>
                <label className="block">Reconciliation notes<Input value={reason} maxLength={2000} onChange={event => setReason(event.target.value)} /></label>
                <Button type="button" variant="outline" disabled={!row.labels.length || !row.labels.every(label => confirmed.includes(label.id)) || !reference.trim() || reason.trim().length < 3}
                  onClick={() => void perform(row, true)}>Record UPS-confirmed external cancellation</Button>
              </fieldset> : <p>The request is still in progress. Close and reopen this dialog after two minutes before reconciling.</p>}
            </>}
            {['VOID_ACCEPTED', 'EXTERNAL_CANCEL_REPORTED'].includes(row.status) && <p>
              {row.status === 'VOID_ACCEPTED' ? 'UPS cancellation confirmed.' : 'External cancellation reported by staff; not API-confirmed.'}
              {' '}{shipmentStatus === 'DRAFT' ? 'Close this dialog, correct the draft shipment, get fresh UPS rates and buy a replacement label.'
                : 'Fulfillment remains unchanged. Review shipment corrections and use the authorized quantity reversal / new draft workflow if a replacement shipment is needed.'}
            </p>}
          </section>;
        })}
        <Button type="button" variant="outline" disabled={busy} onClick={() => setOpen(false)}>Close</Button>
      </DialogContent>
    </Dialog>
  </>;
}
