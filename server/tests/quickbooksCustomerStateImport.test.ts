import { describe, expect, test } from '@jest/globals';
import { mapQBCustomerToLocal, mapQBCustomerPullUpdate } from '../lib/quickbooksCustomerMapping';
import { assessQuickBooksCustomerStates } from '../lib/quickbooksCustomerStateAssessment';

// Synthetic addresses. These are not original import payloads or live customer evidence.
const billing = { Line1: '123 Test Way', Line2: 'Suite 2', City: 'Toronto', CountrySubDivisionCode: ' ON ', PostalCode: 'M5V 1A1', Country: 'Canada' };
const shipping = { Line1: '456 QA Lane', City: 'Indianapolis', CountrySubDivisionCode: 'IN', PostalCode: '46201', Country: 'US' };
const source = () => ({ Id: 'qb-1', DisplayName: 'Synthetic Customer', BillAddr: { ...billing }, ShipAddr: { ...shipping } });
const imported = () => ({ ...mapQBCustomerToLocal(source()), id: 'customer-1', organizationId: 'org-1', qbFieldOverrides: null }) as any;
const assess = (local: any, qb: any[] | null = [source()]) => assessQuickBooksCustomerStates('org-1', [local], qb);

describe('QuickBooks structured customer address mapping and repeat pull policy', () => {
  test('new import preserves distinct billing province and shipping state alongside supported address fields', () => {
    expect(mapQBCustomerToLocal(source())).toMatchObject({ billingStreet1: '123 Test Way', billingStreet2: 'Suite 2', billingCity: 'Toronto', billingState: 'ON', billingPostalCode: 'M5V 1A1', billingCountry: 'Canada', shippingStreet1: '456 QA Lane', shippingState: 'IN', shippingCountry: 'US' });
  });
  test('preserves extra address lines without guessing a region from them', () => {
    const mapped = mapQBCustomerToLocal({ BillAddr: { Line1: '123 Test Way', Line2: 'Office', Line3: 'Floor 3', Line4: 'Building A', Line5: 'IN 46201', City: 'Test City' } });
    expect(mapped.billingStreet2).toBe('Office, Floor 3, Building A, IN 46201');
    expect(mapped).not.toHaveProperty('billingState');
    expect(mapped).not.toHaveProperty('shippingState');
  });
  test.each(['British Columbia', 'NSW', 'Île-de-France'])('preserves supported regional value %s without US-only inference', region => {
    expect(mapQBCustomerToLocal({ BillAddr: { ...billing, CountrySubDivisionCode: region } }).billingState).toBe(region);
  });
  test('missing or blank source fields do not clear valid local state or address', () => {
    const local = imported();
    for (const qb of [{ Id: 'qb-1' }, { ...source(), BillAddr: { ...billing, CountrySubDivisionCode: ' ' }, ShipAddr: null }]) {
      const patch = mapQBCustomerPullUpdate(qb, local);
      expect(patch).not.toHaveProperty('billingState'); expect(patch).not.toHaveProperty('shippingState');
      expect({ ...local, ...patch }).toMatchObject({ billingState: 'ON', shippingState: 'IN', billingStreet1: '123 Test Way' });
    }
  });
  test('legacy flattened import gains structured fields only for the same address', () => {
    const local = { id: 'customer-1', organizationId: 'org-1', billingAddress: imported().billingAddress } as any;
    expect(mapQBCustomerPullUpdate(source(), local)).toMatchObject({ billingState: 'ON', billingStreet1: '123 Test Way' });
    expect(mapQBCustomerPullUpdate(source(), { ...local, billingAddress: '987 Different Address' })).not.toHaveProperty('billingState');
  });
  test.each(['billingAddress', 'billingStreet1', 'billingState'])('address override %s protects the entire billing group', field => {
    const local = { ...imported(), billingState: null, qbFieldOverrides: { [field]: true } };
    expect(mapQBCustomerPullUpdate(source(), local)).not.toHaveProperty('billingState');
  });
  test('staff corrections without override markers are not overwritten or mixed with a different address', () => {
    expect(mapQBCustomerPullUpdate(source(), { ...imported(), billingState: 'QC' })).not.toHaveProperty('billingState');
    expect(mapQBCustomerPullUpdate(source(), { ...imported(), billingStreet1: '789 Staff Correction', billingState: null })).not.toHaveProperty('billingState');
  });
  test('repeat imports preserve the same structured values and linkage', () => {
    const local = imported(); const once = { ...local, ...mapQBCustomerPullUpdate(source(), local) };
    const twice = { ...once, ...mapQBCustomerPullUpdate(source(), once) };
    expect(twice).toMatchObject({ id: local.id, externalAccountingId: 'qb-1', billingState: 'ON', shippingState: 'IN' });
    expect(mapQBCustomerPullUpdate(source(), once)).not.toHaveProperty('billingState');
  });
  test('existing non-address overrides still apply', () => {
    const patch = mapQBCustomerPullUpdate({ ...source(), PrimaryEmailAddr: { Address: 'source@example.test' } }, { ...imported(), qbFieldOverrides: { email: true } });
    expect(patch).not.toHaveProperty('email');
  });
});

describe('read-only state repair assessment', () => {
  test('proposes only missing state on a uniquely linked matching address; does not mutate inputs', () => {
    const local = { ...imported(), billingState: null, shippingState: null }; const before = structuredClone(local);
    const report = assess(local);
    expect(report.counts).toMatchObject({ linkedCustomers: 1, missingBillingStateWithAddress: 1, missingShippingStateWithAddress: 1, proposedStateFields: 2 });
    expect(report.rows).toEqual([expect.objectContaining({ field: 'billingState', proposedValue: 'ON', decision: 'proposed' }), expect.objectContaining({ field: 'shippingState', proposedValue: 'IN', decision: 'proposed' })]);
    expect(local).toEqual(before);
    expect(JSON.stringify(report)).not.toContain('123 Test Way');
  });
  test('a valid local state is not a repair candidate', () => { expect(assess(imported()).rows).toEqual([]); });
  test.each([
    [{ billingAddress: 'Different legacy address' }, 'address_conflict'],
    [{ billingStreet1: '999 Different Street' }, 'address_conflict'],
    [{ billingStreet2: 'Different Unit' }, 'address_conflict'],
    [{ billingCity: 'Different City' }, 'address_conflict'],
    [{ billingPostalCode: 'Different ZIP' }, 'address_conflict'],
    [{ billingCountry: 'US' }, 'address_conflict'],
    [{ qbFieldOverrides: { billingAddress: true } }, 'local_override'],
    [{ qbFieldOverrides: { billingState: true } }, 'local_override'],
    [{ mergedIntoCustomerId: 'survivor' }, 'inactive_or_merged'],
  ])('skips conflicts, overrides and merged records: %j', (patch, decision) => {
    const report = assess({ ...imported(), billingState: null, ...patch });
    expect(report.rows[0].decision).toBe(decision); expect(report.counts.proposedStateFields).toBe(0);
  });
  test('customer linkage alone and partial address matches cannot justify copying a state', () => {
    const local = { id: 'customer-1', organizationId: 'org-1', externalAccountingId: 'qb-1', billingCity: 'Toronto' };
    expect(assess(local).rows[0].decision).toBe('address_ambiguous');
  });
  test('source unavailable and missing state are distinguished', () => {
    const local = { ...imported(), billingState: null };
    expect(assess(local, null).rows[0].decision).toBe('source_not_read');
    expect(assess(local, []).rows[0].decision).toBe('source_customer_missing');
    expect(assess(local, [{ ...source(), BillAddr: { ...billing, CountrySubDivisionCode: undefined } }]).rows[0].decision).toBe('source_state_missing');
  });
  test('duplicate local or provider IDs fail closed', () => {
    const local = { ...imported(), billingState: null };
    expect(assessQuickBooksCustomerStates('org-1', [local, { ...local, id: 'duplicate' }], [source()]).rows.every(row => row.decision === 'duplicate_local_linkage')).toBe(true);
    expect(assess(local, [source(), source()]).rows[0].decision).toBe('duplicate_source_id');
  });
  test('tenant scope is mandatory and cross-tenant rows are rejected', () => {
    expect(() => assessQuickBooksCustomerStates('', [imported()], [])).toThrow('TENANT');
    expect(() => assess({ ...imported(), organizationId: 'other-org' })).toThrow('TENANT');
  });
  test('does not use shipping state to repair billing', () => {
    const local = { ...imported(), billingState: null };
    const qb = { ...source(), BillAddr: undefined };
    expect(assess(local, [qb]).counts.proposedStateFields).toBe(0);
  });
  test('unsupported region length is skipped, never truncated into a proposed repair', () => {
    const local = { ...imported(), billingState: null };
    expect(assess(local, [{ ...source(), BillAddr: { ...billing, CountrySubDivisionCode: 'x'.repeat(101) } }]).rows[0].decision).toBe('source_address_unsupported');
  });
});
