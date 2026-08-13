import { fulfillmentPackingModeFromSettings, fulfillmentVerificationPolicyFromSettings, hasExplicitSplitAllocations, parseShipmentDate } from '@shared/fulfillmentVerification';

describe('fulfillment shipment date contract', () => {
  it('accepts only real ISO calendar dates without locale parsing', () => {
    expect(parseShipmentDate('2026-08-13')).toBe('2026-08-13');
    expect(() => parseShipmentDate('08/13/2026')).toThrow('YYYY-MM-DD');
    expect(() => parseShipmentDate('2026-02-30')).toThrow('valid calendar date');
  });

  it('keeps existing organizations in strict verification mode until configured', () => {
    expect(fulfillmentVerificationPolicyFromSettings({})).toBe('strict_separate_verification');
    expect(fulfillmentVerificationPolicyFromSettings({ preferences: { fulfillment: { verificationPolicy: 'packing_completes_fulfillment' } } })).toBe('packing_completes_fulfillment');
  });

  it('uses simple verified packing by default while preserving strict advanced compatibility', () => {
    expect(fulfillmentPackingModeFromSettings({})).toBe('simple_verified_packing');
    expect(fulfillmentPackingModeFromSettings({ preferences: { fulfillment: { verificationPolicy: 'packing_completes_fulfillment' } } })).toBe('simple_verified_packing');
    expect(fulfillmentPackingModeFromSettings({ preferences: { fulfillment: { verificationPolicy: 'strict_separate_verification' } } })).toBe('advanced_separate_packing');
  });

  it('preserves an explicit split allocation without treating an empty extra package as a mode switch', () => {
    const packages = [{ id: 'p1', ordinal: 1 }, { id: 'p2', ordinal: 2 }];
    expect(hasExplicitSplitAllocations({ packages, items: [{ packageId: 'p1' }] })).toBe(false);
    expect(hasExplicitSplitAllocations({ packages, items: [{ packageId: 'p2' }] })).toBe(true);
  });
});
