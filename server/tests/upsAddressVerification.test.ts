import { describe, expect, jest, test } from '@jest/globals';
import { normalizeUpsAddress, upsAddressFormatIssues } from '@shared/upsAddress';
import type { ShippingParty } from '@shared/shippingDocuments';
import { parseUpsAddressVerification, verifyUpsAddress } from '../services/ups/upsAddressVerification';

const entered: ShippingParty = { name: 'QA Recipient', company: null, address1: '123 Test Street', address2: 'Suite 4',
  city: 'Orlando', state: ' Florida ', postalCode: '32801', country: ' United States ', phone: null, email: null };

describe('UPS address normalization and verification', () => {
  test('normalizes existing saved US state and country without losing the suite', () => {
    expect(normalizeUpsAddress(entered)).toMatchObject({ state: 'FL', country: 'US', address2: 'Suite 4' });
    expect(normalizeUpsAddress({ ...entered, state: 'fl' }).state).toBe('FL');
    expect(upsAddressFormatIssues(normalizeUpsAddress(entered))).toEqual([]);
    expect(upsAddressFormatIssues({ ...entered, state: 'Not a state' })).toContain('Select a valid US state or territory.');
  });

  test('preserves international province names and supported country aliases', () => {
    const canadian = normalizeUpsAddress({ ...entered, state: 'Ontario', country: ' Canada ' });
    expect(canadian).toMatchObject({ state: 'Ontario', country: 'CA', address2: 'Suite 4' });
    expect(upsAddressFormatIssues(canadian)).toEqual([]);
    expect(normalizeUpsAddress({ ...entered, country: 'United Kingdom' }).country).toBe('GB');
  });

  test('distinguishes verified, suggested and ambiguous UPS results without altering the entered address', () => {
    const candidate = { AddressKeyFormat: { AddressLine: ['123 TEST ST'], PoliticalDivision2: 'ORLANDO',
      PoliticalDivision1: 'FL', PostcodePrimaryLow: '32801', CountryCode: 'US' } };
    const suggested = parseUpsAddressVerification({ XAVResponse: { ValidAddressIndicator: '', Candidate: [candidate] } }, entered);
    expect(suggested.status).toBe('suggested');
    expect(suggested.normalized.address1).toBe('123 Test Street');
    expect(suggested.candidates[0]).toMatchObject({ address1: '123 TEST ST', address2: 'Suite 4', state: 'FL' });
    expect(parseUpsAddressVerification({ XAVResponse: { ValidAddressIndicator: '', Candidate: [
      { AddressKeyFormat: { AddressLine: ['123 Test Street'], PoliticalDivision2: 'Orlando', PoliticalDivision1: 'FL',
        PostcodePrimaryLow: '32801', CountryCode: 'US' } }] } }, entered).status).toBe('verified');
    expect(parseUpsAddressVerification({ XAVResponse: { AmbiguousAddressIndicator: '', Candidate: [candidate, candidate] } }, entered).status).toBe('ambiguous');
    expect(parseUpsAddressVerification({ XAVResponse: { NoCandidatesIndicator: '' } }, entered).status).toBe('no_match');
  });

  test('does not claim sandbox coverage for Florida, and provider outage does not block rating', async () => {
    const fetchSpy = jest.spyOn(globalThis, 'fetch');
    const sandbox = await verifyUpsAddress(entered, { baseUrl: 'https://wwwcie.ups.com', token: 'test-token', mode: 'test' });
    expect(sandbox.status).toBe('unsupported');
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockResolvedValueOnce({ ok: false, status: 503 } as Response);
    const live = await verifyUpsAddress(entered, { baseUrl: 'https://onlinetools.ups.com', token: 'test-token', mode: 'live' });
    expect(live.status).toBe('unavailable');
    const request = JSON.parse(String(fetchSpy.mock.calls[0][1]?.body));
    expect(request.XAVRequest.AddressKeyFormat).toMatchObject({ PoliticalDivision1: 'FL', CountryCode: 'US',
      AddressLine: ['123 Test Street', 'Suite 4'] });
    fetchSpy.mockRestore();
  });
});
