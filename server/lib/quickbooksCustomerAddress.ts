import type { Customer } from '../../shared/schema';

export type AddressSide = 'billing' | 'shipping';
const suffixes = ['Street1', 'Street2', 'City', 'State', 'PostalCode', 'Country'] as const;
type AddressSuffix = typeof suffixes[number];
type AddressField = `${AddressSide}${AddressSuffix}` | `${AddressSide}Address`;
export type CustomerAddresses = Partial<Pick<Customer, AddressField | 'qbFieldOverrides'>>;
export type QBAddress = {
  Line1?: unknown; Line2?: unknown; Line3?: unknown; Line4?: unknown; Line5?: unknown;
  City?: unknown; CountrySubDivisionCode?: unknown; PostalCode?: unknown; Country?: unknown;
};
export type QBCustomerAddresses = { BillAddr?: QBAddress | null; ShipAddr?: QBAddress | null };

const text = (value: unknown) => typeof value === 'string' ? value.trim() : '';
const comparable = (value: unknown) => text(value).replace(/\s+/g, ' ').toLowerCase();
function country(value: unknown) {
  const name = comparable(value);
  if (['us', 'usa', 'united states', 'united states of america'].includes(name)) return 'us';
  if (['ca', 'can', 'canada'].includes(name)) return 'ca';
  if (['gb', 'gbr', 'uk', 'united kingdom'].includes(name)) return 'gb';
  return name;
}
function equalField(suffix: AddressSuffix, left: unknown, right: unknown) {
  if (suffix === 'Country') return country(left) === country(right);
  if (suffix === 'PostalCode') return comparable(left).replace(/\s/g, '') === comparable(right).replace(/\s/g, '');
  return comparable(left) === comparable(right);
}

/** Structured QBO fields only. Never extract a region from a city, postal code or free-text line. */
export function normalizeQBCustomerAddress(address?: QBAddress | null) {
  return {
    Street1: text(address?.Line1),
    Street2: [address?.Line2, address?.Line3, address?.Line4, address?.Line5].map(text).filter(Boolean).join(', '),
    City: text(address?.City),
    State: text(address?.CountrySubDivisionCode),
    PostalCode: text(address?.PostalCode),
    Country: text(address?.Country),
  };
}

export function formatQBCustomerAddress(address?: QBAddress | null) {
  return [address?.Line1, address?.Line2, address?.Line3, address?.Line4, address?.Line5,
    address?.City, address?.CountrySubDivisionCode, address?.PostalCode, address?.Country]
    .map(text).filter(Boolean).join(', ');
}

const addressKeys = (side: AddressSide): AddressField[] => [`${side}Address`, ...suffixes.map(suffix => `${side}${suffix}` as AddressField)];
export const customerAddressFields = [...addressKeys('billing'), ...addressKeys('shipping')];

export function assessQBCustomerAddress(side: AddressSide, source: QBAddress | null | undefined, existing: CustomerAddresses) {
  const normalized = normalizeQBCustomerAddress(source);
  const keys = addressKeys(side);
  if (keys.some(key => existing.qbFieldOverrides?.[key])) return 'local_override';
  if (!Object.values(normalized).some(Boolean)) return 'source_address_missing';
  const limits = { Street1: 255, Street2: 255, City: 100, State: 100, PostalCode: 20, Country: 100 };
  if (suffixes.some(suffix => normalized[suffix].length > limits[suffix])) return 'source_address_unsupported';
  if (!keys.some(key => text(existing[key]))) return 'local_address_missing';

  // Any populated local component is authoritative for this conservative enrichment.
  // Missing source state is not an instruction to clear a local state.
  if (suffixes.some(suffix => {
    const local = existing[`${side}${suffix}`];
    if (!text(local) || (suffix === 'State' && !normalized.State)) return false;
    return !equalField(suffix, local, normalized[suffix]);
  })) return 'address_conflict';

  const legacy = text(existing[`${side}Address`]);
  if (legacy) {
    // Old pulls stored Line1..3 only. Accept that exact historical projection too.
    const oldSource = source ? { ...source, Line4: undefined, Line5: undefined } : source;
    const candidates = [source, oldSource].flatMap(address => [
      formatQBCustomerAddress(address),
      formatQBCustomerAddress(address ? { ...address, CountrySubDivisionCode: undefined } : address),
    ]);
    if (!candidates.some(value => comparable(value) === comparable(legacy))) return 'address_conflict';
  }
  const strongSource = normalized.Street1 && normalized.City && normalized.PostalCode;
  const structuredMatch = (['Street1', 'City', 'PostalCode'] as const).every(suffix =>
    text(existing[`${side}${suffix}`]) && equalField(suffix, existing[`${side}${suffix}`], normalized[suffix]));
  return strongSource && (legacy || structuredMatch) ? 'same_address' : 'address_ambiguous';
}

/** New imports populate both address groups. Repeat pulls only enrich the same address.
 * Never overwrite a populated structured component, staff correction or address override.
 */
export function mapQBCustomerAddresses(source: QBCustomerAddresses, existing?: CustomerAddresses): CustomerAddresses {
  const patch: CustomerAddresses = {};
  for (const side of ['billing', 'shipping'] as const) {
    const address = side === 'billing' ? source.BillAddr : source.ShipAddr;
    const decision = assessQBCustomerAddress(side, address, existing ?? {});
    if (decision !== 'local_address_missing' && decision !== 'same_address') continue;
    const normalized = normalizeQBCustomerAddress(address);
    for (const suffix of suffixes) {
      const field: AddressField = `${side}${suffix}`;
      if (normalized[suffix] && !text(existing?.[field])) patch[field] = normalized[suffix];
    }
    const field: AddressField = `${side}Address`;
    if (!text(existing?.[field])) patch[field] = formatQBCustomerAddress(address);
  }
  return patch;
}
