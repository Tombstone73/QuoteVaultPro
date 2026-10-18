import { eq } from 'drizzle-orm';
import { companySettings } from '@shared/schema';
import { shippingPartyValidationErrors, type ShippingParty } from '@shared/shippingDocuments';
import { db } from '../../db';
import { canonicalFulfillmentOperations } from '../fulfillment/canonicalFulfillmentOperations';
import { FulfillmentHttpError } from '../fulfillment/types';
import { markUpsAccountVerified, upsRateCredentials } from './upsConnection';

export type UpsPackageType = '02' | '21';
export type UpsRatePackage = { id: string; packagingType: UpsPackageType; weightLbs: number; lengthIn: number; widthIn: number; heightIn: number };
export type UpsRate = { serviceCode: string; serviceName: string; currency: string; total: string; negotiated: boolean; estimatedArrival: string | null };
const names: Record<string, string> = { '01': 'UPS Next Day Air', '02': 'UPS 2nd Day Air', '03': 'UPS Ground', '07': 'UPS Worldwide Express', '08': 'UPS Worldwide Expedited', '11': 'UPS Standard', '12': 'UPS 3 Day Select', '13': 'UPS Next Day Air Saver', '14': 'UPS Next Day Air Early', '54': 'UPS Worldwide Express Plus', '59': 'UPS 2nd Day Air A.M.', '65': 'UPS Worldwide Saver' };
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const text = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
const list = (value: unknown): unknown[] => Array.isArray(value) ? value : value == null ? [] : [value];
function countryCode(value: string | null): string | null {
  const code = text(value).toUpperCase();
  if (['USA', 'UNITED STATES', 'UNITED STATES OF AMERICA'].includes(code)) return 'US';
  if (['CAN', 'CANADA'].includes(code)) return 'CA';
  return /^[A-Z]{2}$/.test(code) ? code : null;
}

function address(party: ShippingParty) {
  return { AddressLine: [party.address1, party.address2].filter(Boolean), City: party.city, StateProvinceCode: party.state,
    PostalCode: party.postalCode, CountryCode: countryCode(party.country) };
}

export function buildUpsRateRequest(input: { origin: ShippingParty; destination: ShippingParty; shipperNumber: string; packages: UpsRatePackage[] }) {
  const { origin, destination, shipperNumber, packages } = input;
  return { RateRequest: { Request: { RequestOption: 'Shop' }, Shipment: {
    Shipper: { Name: origin.company || origin.name, ShipperNumber: shipperNumber, Address: address(origin) },
    ShipFrom: { Name: origin.company || origin.name, Address: address(origin) },
    ShipTo: { Name: destination.company || destination.name, Address: address(destination) },
    PaymentDetails: { ShipmentCharge: [{ Type: '01', BillShipper: { AccountNumber: shipperNumber } }] },
    Package: packages.map(pkg => ({ PackagingType: { Code: pkg.packagingType },
      Dimensions: { UnitOfMeasurement: { Code: 'IN' }, Length: String(pkg.lengthIn), Width: String(pkg.widthIn), Height: String(pkg.heightIn) },
      PackageWeight: { UnitOfMeasurement: { Code: 'LBS' }, Weight: String(pkg.weightLbs) } })),
    ShipmentRatingOptions: { NegotiatedRatesIndicator: 'Y' },
  } } };
}

export function normalizeUpsRates(payload: unknown): UpsRate[] {
  return list(object(object(payload).RateResponse).RatedShipment).flatMap(value => {
    const row = object(value);
    const code = text(object(row.Service).Code);
    const negotiated = object(object(row.NegotiatedRateCharges).TotalCharge);
    const published = object(row.TotalCharges);
    const charge = text(negotiated.MonetaryValue) ? negotiated : published;
    const total = text(charge.MonetaryValue);
    const currency = text(charge.CurrencyCode);
    if (!code || !currency || !/^\d+(?:\.\d{1,2})?$/.test(total)) return [];
    const transit = object(row.TimeInTransit);
    const guaranteed = object(row.GuaranteedDelivery);
    const arrival = object(object(transit.ServiceSummary).EstimatedArrival);
    const days = text(guaranteed.BusinessDaysInTransit);
    return [{ serviceCode: code, serviceName: names[code] ?? `UPS service ${code}`, currency, total, negotiated: charge === negotiated,
      estimatedArrival: text(arrival.Date) || text(transit.EstimatedArrival) || (days ? `${days} business days` : null) }];
  });
}

function validatePackages(packages: UpsRatePackage[], savedIds: string[]) {
  if (!packages.length || packages.length !== savedIds.length || new Set(packages.map(pkg => pkg.id)).size !== packages.length ||
    packages.some(pkg => !savedIds.includes(pkg.id))) throw new FulfillmentHttpError(400, 'Rate each package on this DRAFT exactly once.', 'UPS_PACKAGE_MISMATCH');
  if (packages.some(pkg => !['02', '21'].includes(pkg.packagingType) ||
    ![pkg.weightLbs, pkg.lengthIn, pkg.widthIn, pkg.heightIn].every(value => Number.isFinite(value) && value > 0))) {
    throw new FulfillmentHttpError(400, 'Every UPS package needs a supported type and positive weight and dimensions.', 'UPS_INVALID_PACKAGE');
  }
}

export async function getUpsRates(orgId: string, shipmentId: string, packages: UpsRatePackage[]) {
  const shipment = await canonicalFulfillmentOperations.getShipment(orgId, shipmentId);
  if (!shipment) throw new FulfillmentHttpError(404, 'Shipment not found.', 'NOT_FOUND');
  if (shipment.status !== 'DRAFT') throw new FulfillmentHttpError(409, 'UPS rates require a DRAFT shipment.', 'UPS_INVALID_SHIPMENT');
  const context = shipment.shippingContext;
  if (!context) throw new FulfillmentHttpError(409, 'Save a shipping destination before requesting rates.', 'UPS_DESTINATION_MISSING');
  const missing = shippingPartyValidationErrors(context.destination);
  if (missing.length) throw new FulfillmentHttpError(409, `Ship To is incomplete: ${missing.join(', ')}.`, 'UPS_DESTINATION_INCOMPLETE');
  if (!countryCode(context.destination.country)) throw new FulfillmentHttpError(409, 'Ship To needs a two-letter country code for UPS rating.', 'UPS_DESTINATION_INCOMPLETE');
  if (context.blindShipping && (!context.blindSender || shippingPartyValidationErrors(context.blindSender).length)) {
    throw new FulfillmentHttpError(409, 'Complete the blind-shipping sender on the DRAFT before requesting rates.', 'UPS_SENDER_INCOMPLETE');
  }
  const [settings] = await db.select({ companyName: companySettings.companyName, phone: companySettings.phone,
    email: companySettings.email, physicalAddress: companySettings.physicalAddress })
    .from(companySettings).where(eq(companySettings.organizationId, orgId)).limit(1);
  const physical = settings?.physicalAddress;
  const origin: ShippingParty = { name: null, company: settings?.companyName ?? null, address1: physical?.line1 ?? null,
    address2: physical?.line2 ?? null, city: physical?.city ?? null, state: physical?.state ?? null,
    postalCode: physical?.postalCode ?? null, country: physical?.country ?? null, phone: settings?.phone ?? null, email: settings?.email ?? null };
  const originMissing = shippingPartyValidationErrors(origin);
  if (originMissing.length) throw new FulfillmentHttpError(409, `Shop shipper/origin is incomplete in Company Settings: ${originMissing.join(', ')}.`, 'UPS_ORIGIN_INCOMPLETE');
  if (!countryCode(origin.country)) throw new FulfillmentHttpError(409, 'Shop shipper/origin needs a two-letter country code in Company Settings.', 'UPS_ORIGIN_INCOMPLETE');
  validatePackages(packages, shipment.packages.map(pkg => pkg.id));
  const credentials = await upsRateCredentials(orgId);
  let response: Response;
  try {
    response = await fetch(`${credentials.baseUrl}/api/rating/v2409/Shop`, { method: 'POST', signal: AbortSignal.timeout(15_000),
      headers: { Authorization: `Bearer ${credentials.token}`, 'Content-Type': 'application/json', Accept: 'application/json', transactionSrc: 'PrintersHero' },
      body: JSON.stringify(buildUpsRateRequest({ origin, destination: context.destination, shipperNumber: credentials.accountNumber, packages })) });
  } catch { throw new FulfillmentHttpError(503, 'UPS rating timed out or is unavailable. Package inputs are unchanged.', 'UPS_RATE_UNAVAILABLE'); }
  const body = object(await response.json().catch(() => ({})));
  if (response.status === 401 || response.status === 403) {
    throw new FulfillmentHttpError(409, 'UPS authorization or Rating API access failed. Reconnect in Shipping Settings or check account entitlement.', 'UPS_AUTH_FAILED');
  }
  if (!response.ok) throw new FulfillmentHttpError(response.status === 429 ? 503 : 422,
    response.status === 429 ? 'UPS rate limits are active. Try again shortly.' : 'UPS could not rate these addresses or packages. Review the details and retry.', 'UPS_RATE_REJECTED');
  const rates = normalizeUpsRates(body);
  if (!rates.length) throw new FulfillmentHttpError(422, 'UPS returned no available services for these addresses and packages.', 'UPS_NO_SERVICES');
  if (!credentials.row.verifiedAt) await markUpsAccountVerified(orgId, credentials.row);
  return { rates, requestedAt: new Date().toISOString() };
}
