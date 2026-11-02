import { useState } from 'react';
import { AlertTriangle, CheckCircle2, Copy, ExternalLink, Truck } from 'lucide-react';
import { carrierTrackingLabels, carrierTrackingUrl, type ShipmentTrackingPackage } from '@shared/shipmentTracking';
import type { PortalOrderFulfillmentSummaryDto } from '@/hooks/usePortal';

function dateLabel(value: string | null, dateOnly = false) {
  if (!value) return null;
  const date = new Date(dateOnly ? `${value}T12:00:00Z` : value);
  if (!Number.isFinite(date.getTime())) return null;
  return new Intl.DateTimeFormat('en-US', dateOnly ? { dateStyle: 'medium', timeZone: 'UTC' } : { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}
export function PortalShipmentTracking({ summary, compact = false }: { summary: PortalOrderFulfillmentSummaryDto; compact?: boolean }) {
  const [feedback, setFeedback] = useState('');
  const packages: ShipmentTrackingPackage[] = summary.trackingPackages ?? (summary.trackingNumber ? [{ shipmentId: null, packageId: null,
    carrier: null, serviceLevel: null, trackingNumber: summary.trackingNumber, trackingUrl: null, status: 'unavailable', lastCarrierUpdateAt: null,
    lastCheckedAt: null, estimatedDeliveryDate: null, deliveredAt: null, updatesUnavailable: true }] : []);
  const copy = async (number: string) => {
    try { await navigator.clipboard.writeText(number); setFeedback(`Copied ${number}`); }
    catch { setFeedback('Copy unavailable. Select the tracking number and copy it manually.'); }
  };
  return <div className={`min-w-0 text-sm text-foreground ${compact ? 'space-y-1' : 'space-y-3'}`} aria-label="Shipment tracking">
    {!packages.length && !compact && <p className="text-muted-foreground">No active tracking number available. Tracking Unavailable.</p>}
    {packages.map((pkg, index) => {
      // Recreate the trusted URL; never render a URL supplied in an API response as-is.
      const url = carrierTrackingUrl(pkg.carrier, pkg.trackingNumber);
      const Icon = pkg.status === 'delivered' ? CheckCircle2 : pkg.status === 'exception' ? AlertTriangle : Truck;
      return <div key={`${pkg.shipmentId}:${pkg.packageId}:${pkg.trackingNumber}:${index}`} className={`min-w-0 ${compact ? 'flex flex-wrap items-center gap-x-2 gap-y-1' : 'rounded-md border bg-muted/20 p-3'}`}>
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <span className="font-medium">{pkg.carrier || 'Carrier not specified'}{packages.length > 1 ? ` · Package ${index + 1}` : ''}</span>
          {pkg.trackingNumber ? <>
            {url ? <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex min-w-0 items-center gap-1 rounded text-blue-700 underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:text-blue-300">
              <span className="break-all font-mono">{pkg.trackingNumber}</span><ExternalLink className="h-3 w-3 shrink-0" aria-hidden="true" />
            </a> : <span className="select-text break-all font-mono">{pkg.trackingNumber}</span>}
            <button type="button" aria-label={`Copy tracking number ${pkg.trackingNumber}`} onClick={() => void copy(pkg.trackingNumber!)}
              className="inline-flex shrink-0 items-center gap-1 rounded border border-input bg-background px-2 py-1 text-xs text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><Copy className="h-3 w-3" aria-hidden="true" />Copy</button>
          </> : <span>No tracking number available</span>}
        </div>
        <p className={`flex items-center gap-1 text-sm ${pkg.status === 'exception' ? 'font-medium text-red-700 dark:text-red-300' : 'text-muted-foreground'} ${compact ? '' : 'mt-2'}`}>
          <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />Carrier: {carrierTrackingLabels[pkg.status] ?? carrierTrackingLabels.unavailable}
        </p>
        {!compact && <div className="mt-2 space-y-1 text-xs text-muted-foreground">
          {pkg.serviceLevel && <p>Service: {pkg.serviceLevel}</p>}
          <p>Last carrier update: {dateLabel(pkg.lastCarrierUpdateAt) || 'Not available'}</p>
          {pkg.lastCheckedAt && <p>Last checked: {dateLabel(pkg.lastCheckedAt)}</p>}
          {pkg.estimatedDeliveryDate && pkg.status !== 'delivered' && <p>Estimated delivery: {dateLabel(pkg.estimatedDeliveryDate, true)}</p>}
          {pkg.deliveredAt && pkg.status === 'delivered' && <p>Carrier confirmed delivery: {dateLabel(pkg.deliveredAt)}</p>}
          {pkg.updatesUnavailable && <p>Automatic carrier updates unavailable. {url ? 'Open the tracking link for carrier information.' : 'Use the tracking number with your carrier.'}{pkg.lastCarrierUpdateAt ? ' Showing the last confirmed carrier status.' : ''}</p>}
        </div>}
      </div>;
    })}
    <p role="status" aria-live="polite" className={feedback ? 'text-xs' : 'sr-only'}>{feedback}</p>
  </div>;
}
