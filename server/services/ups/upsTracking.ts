import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { CarrierTrackingEvent, CarrierTrackingStatus } from '@shared/shipmentTracking';
import { upsEnvironmentMode, upsRateCredentials } from './upsConnection';

const statusSchema = z.object({ type: z.string().optional(), code: z.string().optional(), description: z.string().max(500).optional() });
const activitySchema = z.object({ date: z.string().optional(), time: z.string().optional(), gmtDate: z.string().optional(),
  gmtTime: z.string().optional(), gmtOffset: z.string().optional(), status: statusSchema });
const responseSchema = z.object({ trackResponse: z.object({ shipment: z.array(z.object({ package: z.array(z.object({
  trackingNumber: z.string(), suppressionIndicators: z.array(z.string()).optional(), activity: z.array(activitySchema).max(200).optional(),
  deliveryDate: z.array(z.object({ type: z.string(), date: z.string() })).optional(),
})) })) }) });
function carrierDate(raw?: string): string | null {
  if (!raw || !/^\d{8}$/.test(raw)) return null;
  const date = `${raw.slice(0,4)}-${raw.slice(4,6)}-${raw.slice(6,8)}`;
  const instant = new Date(`${date}T00:00:00Z`);
  return Number.isFinite(instant.getTime()) && instant.toISOString().slice(0,10) === date ? date : null;
}
export function upsTrackingStatus(type?: string, code?: string, description = ''): CarrierTrackingStatus {
  if (type === 'D') return 'delivered';
  if (type === 'X') return 'exception';
  if (code === 'OT' || /\bout for delivery\b/i.test(description)) return 'out_for_delivery';
  if (/awaiting (the )?package|not (yet )?received/i.test(description)) return 'awaiting_package';
  if (type === 'M') return 'label_created';
  if (type === 'I' || type === 'P') return 'in_transit';
  return 'unavailable';
}
/** Only package-matched status evidence; no addresses, signatures, POD or raw response. */
export function parseUpsTracking(body: unknown, trackingNumber: string): CarrierTrackingEvent[] {
  const parsed = responseSchema.parse(body);
  const pkg = parsed.trackResponse.shipment.flatMap(row => row.package).find(row => row.trackingNumber === trackingNumber);
  if (!pkg || pkg.suppressionIndicators?.includes('DETAIL')) return [];
  const estimate = pkg.deliveryDate?.find(date => date.type === 'RDD') ?? pkg.deliveryDate?.find(date => date.type === 'SDD');
  return (pkg.activity ?? []).flatMap(activity => {
    const hasGmt = Boolean(carrierDate(activity.gmtDate) && activity.gmtTime);
    const date = carrierDate(hasGmt ? activity.gmtDate : activity.date);
    const time = (hasGmt ? activity.gmtTime : activity.time)?.padStart(6, '0');
    const offset = hasGmt ? 'Z' : activity.gmtOffset;
    if (!date || !time || !/^(?:[01]\d|2[0-3])[0-5]\d[0-5]\d$/.test(time) || !offset || !/^(?:Z|[+-](?:0\d|1[0-4]):[0-5]\d)$/.test(offset)) return [];
    const occurredAt = new Date(`${date}T${time.slice(0,2)}:${time.slice(2,4)}:${time.slice(4,6)}${offset}`).toISOString();
    return [{ status: upsTrackingStatus(activity.status.type, activity.status.code, activity.status.description), occurredAt,
      description: activity.status.description ?? '', estimatedDeliveryDate: carrierDate(estimate?.date) }];
  });
}
export async function fetchUpsTracking(organizationId: string, trackingNumber: string): Promise<CarrierTrackingEvent[]> {
  // Sandbox canned responses must never become customer delivery confirmations.
  if (upsEnvironmentMode() !== 'live' || !/^[a-zA-Z0-9]{7,34}$/.test(trackingNumber)) throw new Error('Live UPS tracking unavailable');
  const credentials = await upsRateCredentials(organizationId);
  if (credentials.row.mode !== 'live') throw new Error('Live UPS tracking unavailable');
  const response = await fetch(`${credentials.baseUrl}/api/track/v1/details/${encodeURIComponent(trackingNumber)}?locale=en_US&returnSignature=false&returnPOD=false`, {
    headers: { Authorization: `Bearer ${credentials.token}`, transId: randomUUID(), transactionSrc: 'TitanOS', Accept: 'application/json' }, signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error('UPS tracking temporarily unavailable or not authorized');
  const text = await response.text();
  if (text.length > 1_000_000) throw new Error('UPS tracking response too large');
  return parseUpsTracking(JSON.parse(text), trackingNumber);
}
