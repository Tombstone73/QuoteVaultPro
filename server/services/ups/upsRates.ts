import { and, eq } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import { companySettings, integrationConnections } from '@shared/schema';
import { shippingPartyValidationErrors, type ShippingParty } from '@shared/shippingDocuments';
import { db } from '../../db';
import { canonicalFulfillmentOperations } from '../fulfillment/canonicalFulfillmentOperations';
import { FulfillmentHttpError } from '../fulfillment/types';

export type UpsPackageType = '02' | '21';
export type UpsRatePackage = { id: string; packagingType: UpsPackageType; weightLbs: number; lengthIn: number; widthIn: number; heightIn: number };
export type UpsRate = { serviceCode: string; serviceName: string; currency: string; total: string; negotiated: boolean; estimatedArrival: string | null };
type Config = { organizationId: string; clientId: string; clientSecret: string; shipperNumber: string; mode: 'test' | 'live'; baseUrl: string };
const tokens = new Map<string, { token: string; expiresAt: number }>();
const tokenRequests = new Map<string, Promise<string>>();
const names: Record<string, string> = { '01': 'UPS Next Day Air', '02': 'UPS 2nd Day Air', '03': 'UPS Ground', '07': 'UPS Worldwide Express', '08': 'UPS Worldwide Expedited', '11': 'UPS Standard', '12': 'UPS 3 Day Select', '13': 'UPS Next Day Air Saver', '14': 'UPS Next Day Air Early', '54': 'UPS Worldwide Express Plus', '59': 'UPS 2nd Day Air A.M.', '65': 'UPS Worldwide Saver' };
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const text = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
const list = (value: unknown): unknown[] => Array.isArray(value) ? value : value == null ? [] : [value];
const accountFingerprint = (value: string): string => createHash('sha256').update(value).digest('hex');
function countryCode(value: string | null): string | null {
  const code = text(value).toUpperCase();
  if (['USA', 'UNITED STATES', 'UNITED STATES OF AMERICA'].includes(code)) return 'US';
  if (['CAN', 'CANADA'].includes(code)) return 'CA';
  return /^[A-Z]{2}$/.test(code) ? code : null;
}

function configuration(orgId: string): Config | null {
  const organizationId = text(process.env.UPS_ORGANIZATION_ID);
  const clientId = text(process.env.UPS_CLIENT_ID);
  const clientSecret = text(process.env.UPS_CLIENT_SECRET);
  const shipperNumber = text(process.env.UPS_SHIPPER_NUMBER);
  if (organizationId !== orgId || !organizationId || !clientId || !clientSecret || !shipperNumber) return null;
  const mode = process.env.UPS_ENVIRONMENT === 'production' ? 'live' : 'test';
  return { organizationId, clientId, clientSecret, shipperNumber, mode, baseUrl: mode === 'live' ? 'https://onlinetools.ups.com' : 'https://wwwcie.ups.com' };
}

async function tokenFor(config: Config): Promise<string> {
  const key = `${config.organizationId}:${config.mode}:${config.clientId}`;
  const cached = tokens.get(key);
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;
  if (tokenRequests.has(key)) return tokenRequests.get(key)!;
  const pending = (async () => {
    let response: Response;
    try {
      response = await fetch(`${config.baseUrl}/security/v1/oauth/token`, { method: 'POST', signal: AbortSignal.timeout(10_000),
        headers: { Authorization: `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, body: 'grant_type=client_credentials' });
    } catch { throw new FulfillmentHttpError(503, 'UPS authentication is temporarily unavailable. Retry shortly.', 'UPS_AUTH_UNAVAILABLE'); }
    // Never log or return the upstream response, which may include sensitive data.
    const body = object(await response.json().catch(() => ({})));
    if (!response.ok || !text(body.access_token)) throw new FulfillmentHttpError(502, 'UPS rejected the configured credentials. Ask an administrator to check the connection.', 'UPS_AUTH_FAILED');
    const lifetime = Number(body.expires_in);
    const token = text(body.access_token);
    tokens.set(key, { token, expiresAt: Date.now() + (Number.isFinite(lifetime) && lifetime > 0 ? lifetime : 300) * 1000 });
    return token;
  })();
  tokenRequests.set(key, pending);
  try { return await pending; } finally { tokenRequests.delete(key); }
}

export async function upsConnectionStatus(orgId: string) {
  const config = configuration(orgId);
  const [row] = await db.select({ status: integrationConnections.status, mode: integrationConnections.mode, account: integrationConnections.externalAccountId, connectedAt: integrationConnections.connectedAt })
    .from(integrationConnections).where(and(eq(integrationConnections.organizationId, orgId), eq(integrationConnections.provider, 'ups'))).limit(1);
  const connected = Boolean(config && row?.status === 'connected' && row.mode === config.mode && row.account === accountFingerprint(config.shipperNumber));
  return { connected, configured: Boolean(config), mode: config?.mode ?? null, accountLast4: connected ? config!.shipperNumber.slice(-4) : null,
    connectedAt: connected ? row!.connectedAt : null, message: connected ? 'UPS credentials authenticated. Request a rate to verify account and Rating API access.' : config
      ? 'UPS credentials are configured. An Owner or Admin must verify the connection.'
      : 'UPS is not configured for this organization. An administrator must set server-side UPS credentials and account number.' };
}

export async function connectUps(orgId: string) {
  const config = configuration(orgId);
  if (!config) throw new FulfillmentHttpError(409, 'UPS server configuration is incomplete for this organization.', 'UPS_NOT_CONFIGURED');
  tokens.delete(`${orgId}:${config.mode}:${config.clientId}`);
  await tokenFor(config);
  const now = new Date();
  await db.insert(integrationConnections).values({ organizationId: orgId, provider: 'ups', externalAccountId: accountFingerprint(config.shipperNumber),
    status: 'connected', mode: config.mode, connectedAt: now, disconnectedAt: null, lastError: null })
    .onConflictDoUpdate({ target: [integrationConnections.organizationId, integrationConnections.provider], set: {
      externalAccountId: accountFingerprint(config.shipperNumber), status: 'connected', mode: config.mode, connectedAt: now, disconnectedAt: null, lastError: null, updatedAt: now } });
  return upsConnectionStatus(orgId);
}

export async function disconnectUps(orgId: string) {
  await db.update(integrationConnections).set({ status: 'disconnected', disconnectedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(integrationConnections.organizationId, orgId), eq(integrationConnections.provider, 'ups')));
  for (const key of Array.from(tokens.keys())) if (key.startsWith(`${orgId}:`)) tokens.delete(key);
  return upsConnectionStatus(orgId);
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
  const config = configuration(orgId);
  if (!config || !(await upsConnectionStatus(orgId)).connected) throw new FulfillmentHttpError(409,
    'UPS is not connected. Ask an administrator to verify the UPS account in Integrations.', 'UPS_NOT_CONNECTED');
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
  const token = await tokenFor(config);
  let response: Response;
  try {
    response = await fetch(`${config.baseUrl}/api/rating/v2409/Shop`, { method: 'POST', signal: AbortSignal.timeout(15_000),
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json', transactionSrc: 'PrintersHero' },
      body: JSON.stringify(buildUpsRateRequest({ origin, destination: context.destination, shipperNumber: config.shipperNumber, packages })) });
  } catch { throw new FulfillmentHttpError(503, 'UPS rating timed out or is unavailable. Package inputs are unchanged.', 'UPS_RATE_UNAVAILABLE'); }
  const body = object(await response.json().catch(() => ({})));
  if (response.status === 401 || response.status === 403) {
    tokens.delete(`${orgId}:${config.mode}:${config.clientId}`);
    throw new FulfillmentHttpError(502, 'UPS authentication or Rating API access failed. Ask an administrator to verify the account and Rating API entitlement.', 'UPS_AUTH_FAILED');
  }
  if (!response.ok) throw new FulfillmentHttpError(response.status === 429 ? 503 : 422,
    response.status === 429 ? 'UPS rate limits are active. Try again shortly.' : 'UPS could not rate these addresses or packages. Review the details and retry.', 'UPS_RATE_REJECTED');
  const rates = normalizeUpsRates(body);
  if (!rates.length) throw new FulfillmentHttpError(422, 'UPS returned no available services for these addresses and packages.', 'UPS_NO_SERVICES');
  return { rates, requestedAt: new Date().toISOString() };
}
