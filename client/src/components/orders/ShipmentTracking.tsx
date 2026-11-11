import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useId, useState } from 'react';
import { AlertTriangle, CheckCircle2, Copy, ExternalLink, Truck } from 'lucide-react';
import { carrierTrackingLabels, carrierTrackingUrl, type ShipmentTrackingPackage } from '@shared/shipmentTracking';
export type ShipmentTrackingSummaryInput = {
  trackingPackages?: ShipmentTrackingPackage[];
  trackingNumber?: string | null;
  statusLabel?: string;
  hasShipments?: boolean;
};

function dateLabel(value: string | null, dateOnly = false) {
  if (!value) return null;
  const date = new Date(dateOnly ? `${value}T12:00:00Z` : value);
  if (!Number.isFinite(date.getTime())) return null;
  return new Intl.DateTimeFormat('en-US', dateOnly ? { dateStyle: 'medium', timeZone: 'UTC' } : { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}
export function ShipmentTracking({ summary, compact = false, showFulfillmentStatus = false, inline = false }: { summary: ShipmentTrackingSummaryInput; compact?: boolean; showFulfillmentStatus?: boolean; inline?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const packagesId = useId();
  const [feedback, setFeedback] = useState('');
  const packages: ShipmentTrackingPackage[] = summary.trackingPackages ?? (summary.trackingNumber ? [{ shipmentId: null, packageId: null,
    carrier: null, serviceLevel: null, trackingNumber: summary.trackingNumber, trackingUrl: null, status: 'unavailable', lastCarrierUpdateAt: null,
    lastCheckedAt: null, estimatedDeliveryDate: null, deliveredAt: null, updatesUnavailable: true }] : []);
  const copy = async (number: string) => {
    try { await navigator.clipboard.writeText(number); setFeedback(`Copied ${number}`); }
    catch { setFeedback('Copy unavailable. Select the tracking number and copy it manually.'); }
  };
  const trackingExpected = summary.hasShipments || ['Shipped', 'Fulfilled', 'Partially shipped'].includes(summary.statusLabel ?? '');
  if (inline) {
    if (!packages.length) return trackingExpected ? <span className="whitespace-nowrap text-sm" title="No active tracking number available">{summary.statusLabel || "Tracking unavailable"}</span> : null;
    const first = packages[0];
    const url = carrierTrackingUrl(first.carrier, first.trackingNumber);
    return <span role="group" aria-label={`Shipment tracking · Fulfillment: ${summary.statusLabel || "Status unavailable"}`} onClick={event => event.stopPropagation()} className="inline-flex max-w-full items-center gap-1 whitespace-nowrap align-middle text-xs">
      {summary.statusLabel === "Partially shipped" && <span>Partially shipped ·</span>}
      {url ? <a href={url} target="_blank" rel="noopener noreferrer" title={`${first.carrier || "Carrier"} ${first.trackingNumber}`} className="max-w-[16rem] truncate rounded font-mono text-blue-700 underline underline-offset-2 focus-visible:ring-2 focus-visible:ring-ring dark:text-blue-300">{first.trackingNumber}</a>
        : <span className="max-w-[16rem] select-text truncate font-mono" title={first.trackingNumber || undefined}>{first.trackingNumber || summary.statusLabel || "Tracking unavailable"}</span>}
      {first.trackingNumber && <button type="button" aria-label={`Copy tracking number ${first.trackingNumber}`} className="rounded p-1 hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring" onClick={() => void copy(first.trackingNumber!)}><Copy className="h-3 w-3" aria-hidden="true" /></button>}
      {packages.length > 1 && <Popover open={expanded} onOpenChange={setExpanded}><PopoverTrigger asChild><button type="button" aria-expanded={expanded} aria-label={`Show ${packages.length - 1} more tracking numbers`} className="rounded px-1 font-medium underline focus-visible:ring-2 focus-visible:ring-ring">+{packages.length - 1} more</button></PopoverTrigger><PopoverContent className="max-h-64 w-96 max-w-[90vw] overflow-y-auto" align="start"><ShipmentTracking summary={summary} /></PopoverContent></Popover>}
      <span role="status" aria-live="polite" className="sr-only">{feedback}</span>
    </span>;
  }
  if (compact && !packages.length && !trackingExpected) return null;
  return <div onClick={event => event.stopPropagation()} className={`min-w-0 text-sm text-foreground ${compact ? 'space-y-1' : 'space-y-3'}`} role="group" aria-label="Shipment tracking">
    {showFulfillmentStatus && summary.statusLabel && <p className="text-xs font-medium">Fulfillment: {summary.statusLabel}</p>}
    {!packages.length && <p className="text-muted-foreground">No active tracking number available. Tracking Unavailable.</p>}
    <div id={packagesId} className={compact && expanded ? "max-h-48 space-y-1 overflow-y-auto" : "space-y-1"}>
    {(compact && !expanded ? packages.slice(0, 1) : packages).map((pkg, index) => {
      // Recreate the trusted URL; never render a URL supplied in an API response as-is.
      const url = carrierTrackingUrl(pkg.carrier, pkg.trackingNumber);
      const status = dateLabel(pkg.lastCarrierUpdateAt) ? pkg.status : 'unavailable';
      const Icon = status === 'delivered' ? CheckCircle2 : status === 'exception' ? AlertTriangle : Truck;
      return <div key={`${pkg.shipmentId}:${pkg.packageId}:${pkg.trackingNumber}:${index}`} className={`min-w-0 ${compact ? 'flex flex-wrap items-center gap-x-2 gap-y-1' : 'rounded-md border bg-muted/20 p-3'}`}>
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <span className="font-medium">{pkg.carrier || 'Carrier not specified'}{!compact && packages.length > 1 ? ` · ${pkg.packageReference ?? `Package ${index + 1}`}` : ''}</span>
          {pkg.trackingNumber ? <>
            {url ? <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex min-w-0 items-center gap-1 rounded text-blue-700 underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:text-blue-300">
              <span className="break-all font-mono">{pkg.trackingNumber}</span><ExternalLink className="h-3 w-3 shrink-0" aria-hidden="true" />
            </a> : <span className="select-text break-all font-mono">{pkg.trackingNumber}</span>}
            <button type="button" aria-label={`Copy tracking number ${pkg.trackingNumber}`} onClick={() => void copy(pkg.trackingNumber!)}
              className="inline-flex shrink-0 items-center gap-1 rounded border border-input bg-background px-2 py-1 text-xs text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><Copy className="h-3 w-3" aria-hidden="true" /><span className={compact ? "sr-only" : undefined}>Copy</span></button>
          </> : <span>No tracking number available</span>}
        </div>
        <p className={`flex items-center gap-1 text-sm ${status === 'exception' ? 'font-medium text-red-700 dark:text-red-300' : 'text-muted-foreground'} ${compact ? '' : 'mt-2'}`}>
          <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />Carrier: {carrierTrackingLabels[status] ?? carrierTrackingLabels.unavailable}
        </p>
        {!compact && <div className="mt-2 space-y-1 text-xs text-muted-foreground">
          {pkg.serviceLevel && <p>Service: {pkg.serviceLevel}</p>}
          <p>Last carrier update: {dateLabel(pkg.lastCarrierUpdateAt) || 'Not available'}</p>
          {pkg.lastCheckedAt && <p>Last checked: {dateLabel(pkg.lastCheckedAt)}</p>}
          {pkg.lastCarrierUpdateAt && pkg.estimatedDeliveryDate && status !== 'delivered' && <p>Estimated delivery: {dateLabel(pkg.estimatedDeliveryDate, true)}</p>}
          {pkg.deliveredAt && status === 'delivered' && <p>Carrier confirmed delivery: {dateLabel(pkg.deliveredAt)}</p>}
          {pkg.updatesUnavailable && <p>Automatic carrier updates unavailable. {url ? 'Open the tracking link for carrier information.' : 'Use the tracking number with your carrier.'}{pkg.lastCarrierUpdateAt ? ' Showing the last confirmed carrier status.' : ''}</p>}
        </div>}
      </div>;
    })}
    </div>
    {compact && packages.length > 1 && <button type="button" aria-expanded={expanded} aria-controls={packagesId}
      aria-label={expanded ? 'Show fewer tracking numbers' : `Show ${packages.length - 1} more tracking numbers`}
      className="rounded text-xs font-medium underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      onClick={() => setExpanded(value => !value)}>{expanded ? 'Show less' : `+${packages.length - 1} more`}</button>}
    <p role="status" aria-live="polite" className={feedback ? 'text-xs' : 'sr-only'}>{feedback}</p>
  </div>;
}
