import { fulfillmentPackingModeFromSettings, fulfillmentVerificationPolicyFromSettings, hasExplicitSplitAllocations, parseShipmentDate, shipmentDateValue } from '@shared/fulfillmentVerification';
import { shipments } from '@shared/schema';

describe('fulfillment shipment date contract', () => {
  it('reproduces and fixes the actual Drizzle DATE serializer failure', () => {
    expect(() => shipments.shipDate.mapToDriverValue('2026-10-01' as any)).toThrow('toISOString');
    for (const input of ['2026-10-01', new Date('2026-10-01T19:00:00Z')]) {
      expect(shipments.shipDate.mapToDriverValue(shipmentDateValue(input)!)).toContain('2026-10-01');
    }
    expect(shipmentDateValue(null)).toBeNull();
    expect(() => shipmentDateValue(new Date('invalid'))).toThrow();
    expect(() => shipmentDateValue('2026-02-30')).toThrow();
  });
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
