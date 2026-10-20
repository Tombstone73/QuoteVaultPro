import type { ShippingParty } from '@shared/shippingDocuments';
import { normalizeUpsAddress, upsCountryCode } from '@shared/upsAddress';

export type UpsAddressVerification = { status: 'verified' | 'suggested' | 'ambiguous' | 'no_match' | 'unsupported' | 'unavailable';
  message: string; normalized: ShippingParty; candidates: ShippingParty[] };
type Credentials = { baseUrl: string; token: string; mode: 'test' | 'live' };
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const text = (value: unknown) => typeof value === 'string' ? value.trim() : '';

export function parseUpsAddressVerification(payload: unknown, entered: ShippingParty): UpsAddressVerification {
  const normalized = normalizeUpsAddress(entered);
  const response = record(record(payload).XAVResponse);
  const raw = response.Candidate;
  const candidateRows = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const candidates = candidateRows.slice(0, 10).map(row => {
    const address = record(record(row).AddressKeyFormat);
    const lines = Array.isArray(address.AddressLine) ? address.AddressLine.map(text) : [text(address.AddressLine)];
    const postal = text(address.PostcodePrimaryLow);
    const extension = text(address.PostcodeExtendedLow);
    return normalizeUpsAddress({ ...normalized,
      address1: lines[0] || normalized.address1,
      // A candidate with no secondary line does not erase a saved suite or apartment.
      address2: lines[1] || normalized.address2,
      city: text(address.PoliticalDivision2) || normalized.city,
      state: text(address.PoliticalDivision1) || normalized.state,
      postalCode: postal ? postal + (extension ? `-${extension}` : '') : normalized.postalCode,
      country: text(address.CountryCode) || normalized.country });
  });
  if (Object.hasOwn(response, 'AmbiguousAddressIndicator') || candidates.length > 1)
    return { status: 'ambiguous', message: 'UPS found multiple candidates. Select one or retain the entered address.', normalized, candidates };
  if (Object.hasOwn(response, 'NoCandidatesIndicator'))
    return { status: 'no_match', message: 'UPS found no matching address. Review the entered address; rating may still be available.', normalized, candidates: [] };
  if (!Object.hasOwn(response, 'ValidAddressIndicator') || candidates.length === 0)
    return { status: 'unavailable', message: 'UPS did not return a conclusive address result. You can still request rates.', normalized, candidates };
  const candidate = candidates[0];
  const fields: Array<keyof ShippingParty> = ['address1', 'address2', 'city', 'state', 'postalCode', 'country'];
  const changed = fields.some(key => (candidate[key] ?? '').trim().toUpperCase() !== (normalized[key] ?? '').trim().toUpperCase());
  return { status: changed ? 'suggested' : 'verified',
    message: changed ? 'UPS suggests a different address. Review it before accepting; the entered address remains saved.'
      : 'UPS matched this address. Validation does not guarantee delivery.', normalized, candidates };
}

export async function verifyUpsAddress(entered: ShippingParty, credentials: Credentials): Promise<UpsAddressVerification> {
  const normalized = normalizeUpsAddress(entered);
  const country = upsCountryCode(normalized.country);
  if (country !== 'US' && country !== 'PR') return { status: 'unsupported',
    message: 'UPS street-level verification covers US and Puerto Rico addresses. Rating can proceed for this destination.',
    normalized, candidates: [] };
  if (credentials.mode === 'test' && !['NY', 'CA'].includes(normalized.state ?? '')) return { status: 'unsupported',
    message: 'UPS sandbox street-level verification only returns results for New York and California. Rating can proceed.',
    normalized, candidates: [] };
  const postal = normalized.postalCode ?? '';
  const [primary, extension] = postal.split('-');
  const request = { XAVRequest: { AddressKeyFormat: { AddressLine: [normalized.address1, normalized.address2].filter(Boolean),
    PoliticalDivision2: normalized.city, PoliticalDivision1: normalized.state, PostcodePrimaryLow: primary,
    ...(extension ? { PostcodeExtendedLow: extension } : {}), CountryCode: country } } };
  try {
    const response = await fetch(`${credentials.baseUrl}/api/addressvalidation/v2/1?maximumcandidatelistsize=10`, {
      method: 'POST', signal: AbortSignal.timeout(8_000),
      headers: { Authorization: `Bearer ${credentials.token}`, 'Content-Type': 'application/json', Accept: 'application/json', transactionSrc: 'PrintersHero' },
      body: JSON.stringify(request) });
    if (!response.ok) return { status: 'unavailable',
      message: response.status === 401 || response.status === 403
        ? 'UPS address verification is not authorized for this connection. Check developer-app API access; rating can still proceed.'
        : 'UPS address verification is unavailable. Rating can still proceed.', normalized, candidates: [] };
    return parseUpsAddressVerification(await response.json(), normalized);
  } catch {
    return { status: 'unavailable', message: 'UPS address verification timed out. Rating can still proceed.', normalized, candidates: [] };
  }
}
