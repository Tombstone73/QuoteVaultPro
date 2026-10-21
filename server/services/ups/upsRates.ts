import { createHash, randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { companySettings, upsShipmentRateQuotes } from '@shared/schema';
import { shippingPartyValidationErrors, type ShippingParty } from '@shared/shippingDocuments';
import { normalizeUpsAddress, upsAddressFormatIssues, upsCountryCode } from '@shared/upsAddress';
import { db } from '../../db';
import { canonicalFulfillmentOperations } from '../fulfillment/canonicalFulfillmentOperations';
import { FulfillmentHttpError } from '../fulfillment/types';
import { markUpsAccountVerified, upsRateCredentials } from './upsConnection';
import { verifyUpsAddress } from './upsAddressVerification';

export type UpsPackageType = '02' | '21';
export type UpsRatePackage = { id: string; packagingType: UpsPackageType; weightLbs: number; lengthIn: number; widthIn: number; heightIn: number };
export type UpsRate = { optionId: string; serviceCode: string; serviceName: string; currency: string; total: string; negotiated: boolean; estimatedArrival: string | null; estimatedDeliveryTime?: string | null; deliveryCommitment?: 'estimated' | 'guaranteed' };
const names: Record<string, string> = { '01': 'UPS Next Day Air', '02': 'UPS 2nd Day Air', '03': 'UPS Ground', '07': 'UPS Worldwide Express', '08': 'UPS Worldwide Expedited', '11': 'UPS Standard', '12': 'UPS 3 Day Select', '13': 'UPS Next Day Air Saver', '14': 'UPS Next Day Air Early', '54': 'UPS Worldwide Express Plus', '59': 'UPS 2nd Day Air A.M.', '65': 'UPS Worldwide Saver' };
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const text = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
const list = (value: unknown): unknown[] => Array.isArray(value) ? value : value == null ? [] : [value];
export function countryCode(value: string | null): string | null {
  return upsCountryCode(value);
}

function address(party: ShippingParty) {
  return { AddressLine: [party.address1, party.address2].filter(Boolean), City: party.city, StateProvinceCode: party.state,
    PostalCode: party.postalCode, CountryCode: countryCode(party.country) };
}

export function buildUpsRateRequest(input: { origin: ShippingParty; sender?: ShippingParty; destination: ShippingParty; shipperNumber: string; packages: UpsRatePackage[]; shipDate?: string | null }) {
  const { origin, destination, shipperNumber, packages } = input;
  const sender = input.sender ?? origin;
  return { RateRequest: { Request: { RequestOption: input.shipDate ? 'shopTimeInTransit' : 'Shop' }, Shipment: {
    Shipper: { Name: origin.company || origin.name, ShipperNumber: shipperNumber, Address: address(origin) },
    ShipFrom: { Name: sender.company || sender.name, Address: address(sender) },
    ShipTo: { Name: destination.company || destination.name, Address: address(destination) },
    PaymentDetails: { ShipmentCharge: [{ Type: '01', BillShipper: { AccountNumber: shipperNumber } }] },
    Package: packages.map(pkg => ({ PackagingType: { Code: pkg.packagingType },
      Dimensions: { UnitOfMeasurement: { Code: 'IN' }, Length: String(pkg.lengthIn), Width: String(pkg.widthIn), Height: String(pkg.heightIn) },
      PackageWeight: { UnitOfMeasurement: { Code: 'LBS' }, Weight: String(pkg.weightLbs) } })),
    ShipmentRatingOptions: { NegotiatedRatesIndicator: 'Y' },
    ...(input.shipDate && /^\d{4}-\d{2}-\d{2}$/.test(input.shipDate) ? { DeliveryTimeInformation: { PackageBillType: '03', Pickup: { Date: input.shipDate.replace(/-/g, ''), Time: '1200' } } } : {}),
  } } };
}

function providerDate(value: unknown): string | null {
  const raw = text(value);
  const iso = /^\d{8}$/.test(raw) ? `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6)}` : raw;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const date = new Date(`${iso}T12:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === iso ? iso : null;
}

function safeProviderText(value: unknown): string | null {
  const raw = text(value);
  if (!raw) return null;
  return raw.slice(0, 240).replace(/[\r\n\x00-\x1f]/g, ' ').replace(/https?:\/\/\S+/gi, '[link]')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[email]')
    .replace(/\b\d{1,5}\s+(?:[A-Za-z]+\s+){0,4}(?:Street|St|Avenue|Ave|Road|Rd|Drive|Dr|Lane|Ln|Boulevard|Blvd)\b\.?/gi, '[address]')
    .replace(/\b\d{6,}\b/g, '[number]').replace(/\b(?:bearer|token|secret|password)\s*[:=]?\s*\S+/gi, '[credential]').trim() || null;
}

export function upsProviderRateError(payload: unknown, packages: UpsRatePackage[]) {
  const response = object(object(payload).response);
  const first = object(list(response.errors)[0]);
  const code = /^[A-Za-z0-9_-]{1,24}$/.test(text(first.code)) ? text(first.code) : null;
  const description = safeProviderText(first.message || first.description);
  const lower = (description ?? '').toLowerCase();
  const index = /\b(?:package|box)\s*(?:number|#|no\.?|:)??\s*(\d{1,2})\b/i.exec(description ?? '');
  const affectedBox = index && Number(index[1]) > 0 && Number(index[1]) <= packages.length ? `Box ${index[1]}` : null;
  const affectedField = affectedBox ?? (/\bship\s*to|destination|recipient\b/.test(lower) ? 'Ship To'
    : /\bship\s*from|origin|shipper\b/.test(lower) ? 'Shop origin / sender'
    : /\baccount|entitlement\b/.test(lower) ? 'UPS account' : null);
  return { code, description, affectedField };
}

export class UpsRateRejection extends FulfillmentHttpError {
  constructor(status: number, message: string, public readonly providerCode: string | null,
    public readonly providerDescription: string | null, public readonly requestReference: string,
    public readonly affectedField: string | null) { super(status, message, 'UPS_RATE_REJECTED'); }
}

export function normalizeUpsRates(payload: unknown): UpsRate[] {
  return list(object(object(payload).RateResponse).RatedShipment).flatMap((value, index) => {
    const row = object(value);
    const code = text(object(row.Service).Code);
    const negotiated = object(object(row.NegotiatedRateCharges).TotalCharge);
    const published = object(row.TotalCharges);
    const charge = text(negotiated.MonetaryValue) ? negotiated : published;
    const total = text(charge.MonetaryValue);
    const currency = text(charge.CurrencyCode);
    if (!code || !currency || !/^\d+(?:\.\d{1,2})?$/.test(total)) return [];
    const transit = object(row.TimeInTransit);
    const arrival = object(object(object(transit.ServiceSummary).EstimatedArrival).Arrival);
    const estimatedArrival = providerDate(arrival.Date);
    const estimatedDeliveryTime = /^\d{4}(?:\d{2})?$/.test(text(arrival.Time)) ? text(arrival.Time) : null;
    return [{ optionId: String(index), serviceCode: code, serviceName: names[code] ?? `UPS service ${code}`, currency, total, negotiated: charge === negotiated,
      estimatedArrival, estimatedDeliveryTime: estimatedArrival ? estimatedDeliveryTime : null,
      deliveryCommitment: 'estimated' as const }];
  });
}

/** An option is unique only within its stored quote. Older quotes have no option identity and must be rerated. */
export function selectedUpsQuoteRate(rates: UpsRate[], optionId: string): UpsRate | null {
  return rates.find(rate => rate.optionId === optionId) ?? null;
}

type SavedPackage = { id: string; upsPackagingType: string; weightLbs: string | null; dimLengthIn: string | null; dimWidthIn: string | null; dimHeightIn: string | null };
function validatePackages(packages: UpsRatePackage[], saved: SavedPackage[]) {
  const byId = new Map(saved.map(pkg => [pkg.id, pkg]));
  if (!packages.length || packages.length !== saved.length || new Set(packages.map(pkg => pkg.id)).size !== packages.length ||
    packages.some(pkg => !byId.has(pkg.id))) throw new FulfillmentHttpError(400, 'Rate each package on this DRAFT exactly once.', 'UPS_PACKAGE_MISMATCH');
  if (packages.some(pkg => !['02', '21'].includes(pkg.packagingType) ||
    ![pkg.weightLbs, pkg.lengthIn, pkg.widthIn, pkg.heightIn].every(value => Number.isFinite(value) && value > 0))) {
    throw new FulfillmentHttpError(400, 'Every UPS package needs a supported type and positive weight and dimensions.', 'UPS_INVALID_PACKAGE');
  }
  if (packages.some(pkg => { const row = byId.get(pkg.id)!; return pkg.packagingType !== row.upsPackagingType ||
    pkg.weightLbs !== Number(row.weightLbs) || pkg.lengthIn !== Number(row.dimLengthIn) ||
    pkg.widthIn !== Number(row.dimWidthIn) || pkg.heightIn !== Number(row.dimHeightIn); })) {
    throw new FulfillmentHttpError(409, 'Package details changed or have not finished saving. Save the draft and get fresh UPS rates.', 'UPS_PACKAGE_STALE');
  }
}

export function upsShippingFingerprint(input: { origin: ShippingParty; sender: ShippingParty; destination: ShippingParty; accountNumber: string; packages: UpsRatePackage[]; shipDate?: string | null }) {
  const rateAddress = (party: ShippingParty) => {
    const normalized = normalizeUpsAddress(party);
    return [normalized.address1, normalized.address2, normalized.city, normalized.state, normalized.postalCode, normalized.country];
  };
  return createHash('sha256').update(JSON.stringify({ origin: rateAddress(input.origin), sender: rateAddress(input.sender),
    destination: rateAddress(input.destination), accountNumber: input.accountNumber, packages: input.packages,
    shipDate: input.shipDate ?? null })).digest('hex');
}

export function upsQuoteLifetimeMs(): number {
  const configured = Number(process.env.UPS_RATE_QUOTE_TTL_MINUTES);
  return (Number.isInteger(configured) && configured >= 1 && configured <= 120 ? configured : 15) * 60_000;
}

export async function resolveUpsShippingContext(orgId: string, shipmentId: string) {
  const shipment = await canonicalFulfillmentOperations.getShipment(orgId, shipmentId);
  if (!shipment) throw new FulfillmentHttpError(404, 'Shipment not found.', 'NOT_FOUND');
  if (shipment.status !== 'DRAFT') throw new FulfillmentHttpError(409, 'UPS labels and rates require a DRAFT shipment.', 'UPS_INVALID_SHIPMENT');
  const context = shipment.shippingContext;
  if (!context) throw new FulfillmentHttpError(409, 'Save a shipping destination before requesting rates.', 'UPS_DESTINATION_MISSING');
  const destination = normalizeUpsAddress(context.destination);
  const missing = shippingPartyValidationErrors(destination);
  if (missing.length) throw new FulfillmentHttpError(409, `Ship To is incomplete: ${missing.join(', ')}.`, 'UPS_DESTINATION_INCOMPLETE');
  const destinationFormat = upsAddressFormatIssues(destination);
  if (destinationFormat.length) throw new FulfillmentHttpError(409, `Ship To: ${destinationFormat.join(' ')}`, 'UPS_DESTINATION_INCOMPLETE');
  if (context.blindShipping && (!context.blindSender || shippingPartyValidationErrors(context.blindSender).length))
    throw new FulfillmentHttpError(409, 'Complete the blind-shipping sender on the DRAFT before requesting UPS.', 'UPS_SENDER_INCOMPLETE');
  const [settings] = await db.select({ companyName: companySettings.companyName, phone: companySettings.phone,
    email: companySettings.email, physicalAddress: companySettings.physicalAddress })
    .from(companySettings).where(eq(companySettings.organizationId, orgId)).limit(1);
  const physical = settings?.physicalAddress;
  const origin: ShippingParty = { name: null, company: settings?.companyName ?? null, address1: physical?.line1 ?? null,
    address2: physical?.line2 ?? null, city: physical?.city ?? null, state: physical?.state ?? null,
    postalCode: physical?.postalCode ?? null, country: physical?.country ?? null, phone: settings?.phone ?? null, email: settings?.email ?? null };
  const normalizedOrigin = normalizeUpsAddress(origin);
  const originMissing = shippingPartyValidationErrors(normalizedOrigin);
  if (originMissing.length) throw new FulfillmentHttpError(409, `Shop shipper/origin is incomplete in Company Settings: ${originMissing.join(', ')}.`, 'UPS_ORIGIN_INCOMPLETE');
  const originFormat = upsAddressFormatIssues(normalizedOrigin);
  if (originFormat.length) throw new FulfillmentHttpError(409, `Shop shipper/origin in Company Settings: ${originFormat.join(' ')}`, 'UPS_ORIGIN_INCOMPLETE');
  const sender = context.blindShipping ? normalizeUpsAddress(context.blindSender!) : normalizedOrigin;
  const senderFormat = upsAddressFormatIssues(sender);
  if (senderFormat.length) throw new FulfillmentHttpError(409, `Sender: ${senderFormat.join(' ')}`, 'UPS_SENDER_INCOMPLETE');
  const packages: UpsRatePackage[] = shipment.packages.map(pkg => ({ id: pkg.id, packagingType: pkg.upsPackagingType as UpsPackageType,
    weightLbs: Number(pkg.weightLbs), lengthIn: Number(pkg.dimLengthIn), widthIn: Number(pkg.dimWidthIn), heightIn: Number(pkg.dimHeightIn) }));
  validatePackages(packages, shipment.packages);
  return { shipment, origin: normalizedOrigin, sender, destination, packages };
}

export async function getUpsRates(orgId: string, shipmentId: string, packages: UpsRatePackage[]) {
  const { origin, sender, destination, shipment } = await resolveUpsShippingContext(orgId, shipmentId);
  validatePackages(packages, shipment.packages);
  const credentials = await upsRateCredentials(orgId);
  const verification = await Promise.all([verifyUpsAddress(origin, { ...credentials, mode: credentials.row.mode }),
    verifyUpsAddress(destination, { ...credentials, mode: credentials.row.mode })]);
  const shipDate = shipment.shipDate ? new Date(shipment.shipDate).toISOString().slice(0, 10) : null;
  const fingerprint = upsShippingFingerprint({ origin, sender, destination, accountNumber: credentials.accountNumber, packages, shipDate });
  const requestReference = randomUUID().replace(/-/g, '');
  let response: Response;
  try {
    response = await fetch(`${credentials.baseUrl}/api/rating/v2409/${shipDate ? 'Shoptimeintransit' : 'Shop'}`, { method: 'POST', signal: AbortSignal.timeout(15_000),
      headers: { Authorization: `Bearer ${credentials.token}`, 'Content-Type': 'application/json', Accept: 'application/json', transactionSrc: 'PrintersHero', transId: requestReference },
      body: JSON.stringify(buildUpsRateRequest({ origin, sender, destination, shipperNumber: credentials.accountNumber, packages, shipDate })) });
  } catch { throw new FulfillmentHttpError(503, 'UPS rating timed out or is unavailable. Package inputs are unchanged.', 'UPS_RATE_UNAVAILABLE'); }
  const body = object(await response.json().catch(() => ({})));
  if (response.status === 401 || response.status === 403) {
    throw new FulfillmentHttpError(409, 'UPS authorization or Rating API access failed. Reconnect in Shipping Settings or check account entitlement.', 'UPS_AUTH_FAILED');
  }
  if (!response.ok) {
    const provider = upsProviderRateError(body, packages);
    console.warn('[UPS RATE] Provider rejection', { status: response.status, requestReference,
      providerCode: provider.code, providerDescription: provider.description, affectedField: provider.affectedField, boxCount: packages.length });
    const reason = provider.description ? `${provider.description}${provider.code ? ` (UPS ${provider.code})` : ''}` : 'UPS did not return a specific reason.';
    const action = provider.affectedField ? ` Check ${provider.affectedField} and try again.` : ' Review the addresses, packages, and account access, then try again.';
    throw new UpsRateRejection(response.status === 429 ? 503 : 422,
      response.status === 429 ? 'UPS rate limits are active. Try again shortly.' : `UPS rejected this rate request: ${reason}${action}`,
      provider.code, provider.description, requestReference, provider.affectedField);
  }
  const rates = normalizeUpsRates(body);
  if (!rates.length) throw new FulfillmentHttpError(422, 'UPS returned no available services for these addresses and packages.', 'UPS_NO_SERVICES');
  if (!credentials.row.verifiedAt) await markUpsAccountVerified(orgId, credentials.row);
  const expiresAt = new Date(Date.now() + upsQuoteLifetimeMs());
  const [quote] = await db.insert(upsShipmentRateQuotes).values({ organizationId: orgId, shipmentId,
    environment: credentials.row.mode, requestFingerprint: fingerprint, rates,
    expiresAt }).returning({ id: upsShipmentRateQuotes.id });
  return { rates, quoteId: quote.id, environment: credentials.row.mode, requestedAt: new Date().toISOString(), expiresAt: expiresAt.toISOString(),
    addressVerification: { origin: verification[0], destination: verification[1] } };
}

export async function verifyUpsShipmentDestination(orgId: string, shipmentId: string) {
  const shipment = await canonicalFulfillmentOperations.getShipment(orgId, shipmentId);
  if (!shipment || shipment.status !== 'DRAFT' || !shipment.shippingContext)
    throw new FulfillmentHttpError(409, 'Save a DRAFT shipping destination before verifying it.', 'UPS_DESTINATION_MISSING');
  const destination = normalizeUpsAddress(shipment.shippingContext.destination);
  const missing = shippingPartyValidationErrors(destination);
  if (missing.length) throw new FulfillmentHttpError(409, `Ship To is incomplete: ${missing.join(', ')}.`, 'UPS_DESTINATION_INCOMPLETE');
  const format = upsAddressFormatIssues(destination);
  if (format.length) throw new FulfillmentHttpError(409, `Ship To: ${format.join(' ')}`, 'UPS_DESTINATION_INCOMPLETE');
  const credentials = await upsRateCredentials(orgId);
  return verifyUpsAddress(destination, { ...credentials, mode: credentials.row.mode });
}
