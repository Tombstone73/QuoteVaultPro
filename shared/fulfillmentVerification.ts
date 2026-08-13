export type FulfillmentVerificationPolicy = 'strict_separate_verification' | 'packing_completes_fulfillment';
export type FulfillmentPackingMode = 'simple_verified_packing' | 'advanced_separate_packing';

export function parseShipmentDate(value: string | null | undefined): string | null {
  if (value == null || value === '') return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('Ship date must use YYYY-MM-DD');
  const [year, month, day] = value.split('-').map(Number);
  const checked = new Date(Date.UTC(year, month - 1, day));
  if (checked.getUTCFullYear() !== year || checked.getUTCMonth() !== month - 1 || checked.getUTCDate() !== day) {
    throw new Error('Ship date is not a valid calendar date');
  }
  return value;
}

export function fulfillmentVerificationPolicyFromSettings(settings: any): FulfillmentVerificationPolicy {
  return settings?.preferences?.fulfillment?.verificationPolicy === 'packing_completes_fulfillment'
    ? 'packing_completes_fulfillment'
    : 'strict_separate_verification';
}

/** The old packing-completes value remains a compatible spelling for the
 * simple workflow. Existing strict organizations retain explicit packing. */
export function fulfillmentPackingModeFromSettings(settings: any): FulfillmentPackingMode {
  return settings?.preferences?.fulfillment?.verificationPolicy === 'strict_separate_verification'
    ? 'advanced_separate_packing'
    : 'simple_verified_packing';
}
