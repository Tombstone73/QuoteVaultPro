import { useEffect, useRef, useState } from 'react';
import type { ShipmentDetail } from '@/hooks/useFulfillment';
import { carrierTrackingLabels, normalizeTrackingNumber, trackingCarriers, validManualTrackingNumber, type ManualPackageTracking } from '@shared/shipmentTracking';

export type TrackingEdit = ManualPackageTracking & { before: Omit<ManualPackageTracking, 'packageId'> };
export type HistoricalUpsPurchase = {
  id: string; status: string; voidAcceptedAt: string | null; voidRequestedAt?: string | null;
  voidResult?: { packages?: Array<{ trackingNumber: string; code: string }> } | null;
  labels: Array<{ id: string; packageId: string | null; providerResultOrdinal: number | null; trackingNumber: string }>;
};

export function upsVoidStatus(purchase: HistoricalUpsPurchase, number: string) {
  const result = purchase.voidResult?.packages?.find(row => row.trackingNumber === number);
  if (purchase.status === 'VOID_ACCEPTED' && purchase.voidAcceptedAt && (!result || result.code === '1')) return 'Voided · UPS confirmed';
  if (purchase.status === 'VOID_REQUESTING') return 'Void pending';
  if (purchase.status === 'EXTERNAL_CANCEL_REPORTED') return 'Cancellation reported · UPS confirmation unavailable';
  if (result?.code === '0') return 'Void rejected by UPS';
  if (purchase.status === 'VOID_UNCERTAIN' || purchase.status === 'VOID_ACCEPTED') return 'Void status unknown';
  if (purchase.status === 'PURCHASED' || purchase.status === 'MAPPING_REQUIRED') return 'No confirmed void';
  return 'Void status unknown';
}

export function ReversedShipmentHistory({ reversal, shipment, purchases, onOpen, loading, error }: {
  reversal: NonNullable<ShipmentDetail['reversal']>; shipment?: ShipmentDetail; purchases: HistoricalUpsPurchase[];
  onOpen?: () => void; loading: boolean; error: boolean;
}) {
  const mapped = purchases.flatMap(purchase => purchase.labels.map(label => ({ purchase, label })));
  return <section className="rounded-xl border border-border bg-muted/20 p-4 space-y-3" aria-label="Previous shipment">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3 className="font-semibold">Previous shipment {shipment?.shipmentReference || ''} · Reversed</h3>
      {onOpen && <button type="button" className="rounded border px-3 py-1 text-sm" onClick={onOpen}>View historical shipment</button>}
    </div>
    <p className="text-sm text-muted-foreground">Reversed {new Date(reversal.reversedAt).toLocaleString()}{reversal.reversedBy ? ` by ${reversal.reversedBy}` : ''}</p>
    {loading && <p role="status" className="text-sm">Loading original label history…</p>}
    {error && <p role="alert" className="text-sm text-destructive">Original label history could not be loaded. Open the historical shipment to retry.</p>}
    {mapped.map(({ purchase, label }) => <div key={label.id} className="rounded border p-2 text-sm break-words">
      <p className="font-medium">{shipment?.packages.find(box => box.id === label.packageId)?.packageReference ?? `Box ${label.providerResultOrdinal ?? 'unmatched'}`} · UPS</p>
      <p>Historical tracking {label.trackingNumber}</p>
      <p className="text-muted-foreground">Purchased through Printers Hero · {upsVoidStatus(purchase, label.trackingNumber)}</p>
      {purchase.voidRequestedAt && <p className="text-muted-foreground">Void requested {new Date(purchase.voidRequestedAt).toLocaleString()}</p>}
      {purchase.voidAcceptedAt && purchase.status === 'VOID_ACCEPTED' && <p className="text-muted-foreground">UPS response recorded {new Date(purchase.voidAcceptedAt).toLocaleString()}</p>}
    </div>)}
    {!loading && !error && !mapped.length && shipment?.trackingNumber && <p className="text-sm">Historical tracking {shipment.trackingNumber} · Void status unknown</p>}
  </section>;
}

export function PackageTrackingPanel({ shipment, editable, busy, onDirty, onSave }: {
  shipment: ShipmentDetail; editable: boolean; busy: boolean; onDirty: (dirty: boolean) => void;
  onSave: (edits: TrackingEdit[]) => Promise<void>;
}) {
  const [edits, setEdits] = useState<Record<string, TrackingEdit>>({});
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const saving = useRef(false);
  const changes = Object.values(edits);
  useEffect(() => onDirty(changes.length > 0), [onDirty, changes.length]);

  const save = async () => {
    if (saving.current || !changes.length) return;
    const normalized = changes.map(row => ({ ...row, trackingNumber: row.trackingNumber ? normalizeTrackingNumber(row.trackingNumber) : null }));
    if (normalized.some(row => Boolean(row.carrier) !== Boolean(row.trackingNumber) || (row.trackingNumber && !validManualTrackingNumber(row.trackingNumber)))) {
      setError('Choose a supported carrier and enter a valid tracking number for each box, or clear both fields.'); return;
    }
    saving.current = true; setError(''); setStatus('');
    try { await onSave(normalized); setEdits({}); setStatus('Package tracking saved.'); }
    catch (err) { setError(err instanceof Error ? err.message : 'Package tracking could not be confirmed.'); }
    finally { saving.current = false; }
  };

  return <section className="rounded-xl border border-border bg-card p-4 space-y-3" aria-label="Current shipment tracking">
    <h3 className="font-semibold">{shipment.status === 'VOIDED' ? 'Voided shipment' : 'Current shipment'} {shipment.shipmentReference || shipment.id}</h3>
    <p className="text-sm text-muted-foreground">{shipment.status === 'DRAFT' ? 'Packing draft' : shipment.status === 'SHIPPED' ? 'Shipped' : 'Voided'} · {shipment.packages.length} box(es)</p>
    {shipment.status !== 'VOIDED' && shipment.packages.map(box => {
      const track = shipment.trackingPackages?.find(item => item.packageId === box.id);
      const purchased = track?.source === 'purchased';
      const before = { carrier: box.manualTrackingCarrier ?? null, trackingNumber: box.manualTrackingNumber ?? null };
      const value = edits[box.id] ?? { packageId: box.id, ...before, before };
      const update = (patch: Partial<ManualPackageTracking>) => {
        setError(''); setStatus('');
        setEdits(previous => {
          const next = { ...previous };
          const change = { ...(previous[box.id] ?? value), ...patch };
          if (change.carrier === change.before.carrier && change.trackingNumber === change.before.trackingNumber) delete next[box.id];
          else next[box.id] = change;
          return next;
        });
      };
      const units = shipment.items.filter(item => item.packageId === box.id).reduce((sum, item) => sum + item.quantity, 0);
      return <div key={box.id} className="rounded border border-border p-3 space-y-2">
        <p className="text-sm font-medium">Box {box.ordinal} · {box.packageReference} · {units} allocated units</p>
        {track && <div className="text-sm break-words">
          <p>{track.carrier} · {track.trackingUrl ? <a href={track.trackingUrl} className="underline" target="_blank" rel="noreferrer">{track.trackingNumber}</a> : track.trackingNumber}</p>
          <p className="text-muted-foreground">{purchased ? 'Purchased through Printers Hero' : 'Entered manually'} · {track.status === 'delivered' ? 'Delivered'
            : track.lastCarrierUpdateAt && track.status !== 'unavailable' ? `Carrier verified · ${carrierTrackingLabels[track.status]}`
              : purchased ? 'Active carrier label' : 'Unverified'}</p>
        </div>}
        {editable && !purchased && <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <label className="text-xs">Carrier for Box {box.ordinal}<select className="mt-1 block w-full rounded border border-input bg-background p-2 text-sm"
            value={value.carrier ?? ''} disabled={busy} onChange={event => update({ carrier: (event.target.value || null) as ManualPackageTracking['carrier'] })}>
            <option value="">Select carrier</option>{trackingCarriers.map(carrier => <option key={carrier}>{carrier}</option>)}
          </select></label>
          <label className="text-xs">Tracking number for Box {box.ordinal}<input className="mt-1 block w-full rounded border border-input bg-background p-2 text-sm"
            value={value.trackingNumber ?? ''} maxLength={160} disabled={busy} onChange={event => update({ trackingNumber: event.target.value || null })} /></label>
        </div>}
        {!editable && !track && <p className="text-sm text-muted-foreground">No package tracking recorded</p>}
      </div>;
    })}
    {editable && changes.length > 0 && <button type="button" className="rounded bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
      disabled={busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Save package tracking'}</button>}
    {status && <p role="status" className="text-sm">{status}</p>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
  </section>;
}
