import type { ShippingParty } from './shippingDocuments';

export const US_STATE_OPTIONS = [
  ['AL', 'Alabama'], ['AK', 'Alaska'], ['AZ', 'Arizona'], ['AR', 'Arkansas'], ['CA', 'California'],
  ['CO', 'Colorado'], ['CT', 'Connecticut'], ['DE', 'Delaware'], ['DC', 'District of Columbia'],
  ['FL', 'Florida'], ['GA', 'Georgia'], ['HI', 'Hawaii'], ['ID', 'Idaho'], ['IL', 'Illinois'],
  ['IN', 'Indiana'], ['IA', 'Iowa'], ['KS', 'Kansas'], ['KY', 'Kentucky'], ['LA', 'Louisiana'],
  ['ME', 'Maine'], ['MD', 'Maryland'], ['MA', 'Massachusetts'], ['MI', 'Michigan'], ['MN', 'Minnesota'],
  ['MS', 'Mississippi'], ['MO', 'Missouri'], ['MT', 'Montana'], ['NE', 'Nebraska'], ['NV', 'Nevada'],
  ['NH', 'New Hampshire'], ['NJ', 'New Jersey'], ['NM', 'New Mexico'], ['NY', 'New York'],
  ['NC', 'North Carolina'], ['ND', 'North Dakota'], ['OH', 'Ohio'], ['OK', 'Oklahoma'],
  ['OR', 'Oregon'], ['PA', 'Pennsylvania'], ['RI', 'Rhode Island'], ['SC', 'South Carolina'],
  ['SD', 'South Dakota'], ['TN', 'Tennessee'], ['TX', 'Texas'], ['UT', 'Utah'], ['VT', 'Vermont'],
  ['VA', 'Virginia'], ['WA', 'Washington'], ['WV', 'West Virginia'], ['WI', 'Wisconsin'],
  ['WY', 'Wyoming'], ['AS', 'American Samoa'], ['GU', 'Guam'], ['MP', 'Northern Mariana Islands'],
  ['PR', 'Puerto Rico'], ['VI', 'U.S. Virgin Islands'], ['AA', 'Armed Forces Americas'],
  ['AE', 'Armed Forces Europe'], ['AP', 'Armed Forces Pacific'],
] as const;

const clean = (value: string | null | undefined) => (value ?? '').trim().replace(/\s+/g, ' ');
const stateByName = new Map(US_STATE_OPTIONS.flatMap(([code, name]) => [
  [code.toUpperCase(), code], [name.toUpperCase(), code],
] as const));
const countryNames: Record<string, string> = {
  US: 'US', USA: 'US', 'UNITED STATES': 'US', 'UNITED STATES OF AMERICA': 'US',
  CA: 'CA', CAN: 'CA', CANADA: 'CA', GB: 'GB', UK: 'GB', 'UNITED KINGDOM': 'GB',
  MX: 'MX', MEX: 'MX', MEXICO: 'MX', PR: 'PR', 'PUERTO RICO': 'PR',
};

export function upsCountryCode(value: string | null | undefined): string | null {
  const input = clean(value).toUpperCase();
  return countryNames[input] ?? (/^[A-Z]{2}$/.test(input) ? input : null);
}

export function normalizeUpsAddress(party: ShippingParty): ShippingParty {
  const country = upsCountryCode(party.country);
  const state = clean(party.state);
  return { ...party, country: country ?? party.country,
    state: country === 'US' ? (stateByName.get(state.toUpperCase()) ?? state) : party.state };
}

export function upsAddressFormatIssues(party: ShippingParty): string[] {
  const country = upsCountryCode(party.country);
  if (!country) return ['Enter a supported two-letter country code.'];
  if (country === 'US' && !stateByName.has(clean(party.state).toUpperCase()))
    return ['Select a valid US state or territory.'];
  return [];
}
