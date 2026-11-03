export const carrierTrackingStatuses = ['label_created', 'awaiting_package', 'in_transit', 'out_for_delivery', 'delivered', 'exception', 'unavailable'] as const;
export type CarrierTrackingStatus = typeof carrierTrackingStatuses[number];
export const carrierTrackingLabels: Record<CarrierTrackingStatus, string> = {
  label_created: 'Label Created', awaiting_package: 'Carrier Awaiting Package', in_transit: 'In Transit',
  out_for_delivery: 'Out for Delivery', delivered: 'Delivered', exception: 'Delivery Exception', unavailable: 'Tracking Unavailable',
};
export type TrackingCarrier = 'UPS' | 'FedEx' | 'USPS' | 'DHL';
export function trackingCarrier(value: string | null | undefined): TrackingCarrier | null {
  const key = value?.trim().toLowerCase().replace(/[\s._-]/g, '');
  const carriers: Record<string, TrackingCarrier> = { ups: 'UPS', unitedparcelservice: 'UPS', fedex: 'FedEx', federalexpress: 'FedEx', usps: 'USPS', unitedstatespostalservice: 'USPS', dhl: 'DHL', dhlexpress: 'DHL' };
  return key && Object.prototype.hasOwnProperty.call(carriers, key) ? carriers[key] : null;
}
/** Never accept stored/user/provider URLs. Only generate links to known HTTPS carrier endpoints. */
export function carrierTrackingUrl(carrier: string | null | undefined, number: string | null | undefined): string | null {
  const value = number?.trim();
  if (!value || !/^[a-zA-Z0-9 -]{5,80}$/.test(value)) return null;
  const encoded = encodeURIComponent(value);
  switch (trackingCarrier(carrier)) {
    case 'UPS': return `https://www.ups.com/track?tracknum=${encoded}`;
    case 'FedEx': return `https://www.fedex.com/fedextrack/?trknbr=${encoded}`;
    case 'USPS': return `https://tools.usps.com/go/TrackConfirmAction?tLabels=${encoded}`;
    case 'DHL': return `https://www.dhl.com/global-en/home/tracking.html?tracking-id=${encoded}`;
    default: return null;
  }
}
export type ShipmentTrackingPackage = {
  shipmentId: string | null; packageId: string | null; carrier: string | null; trackingNumber: string | null; serviceLevel: string | null;
  trackingUrl: string | null; status: CarrierTrackingStatus; lastCarrierUpdateAt: string | null;
  lastCheckedAt: string | null; estimatedDeliveryDate: string | null; deliveredAt: string | null; updatesUnavailable: boolean;
};
export type CarrierTrackingEvent = {
  status: CarrierTrackingStatus; occurredAt: string; description: string; estimatedDeliveryDate?: string | null;
};
