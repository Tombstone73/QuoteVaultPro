import { fulfillmentVerificationPolicyFromSettings, parseShipmentDate } from '@shared/fulfillmentVerification';

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
});
