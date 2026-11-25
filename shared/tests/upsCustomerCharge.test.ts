import { expect, test } from '@jest/globals';
import { upsCustomerChargeCents } from '../upsCustomerCharge';

test('the customer default equals the selected UPS rate when no fee is configured', () => {
  expect(upsCustomerChargeCents({ total: '14.36', currency: 'USD' })).toBe(1436);
  expect(upsCustomerChargeCents({ total: '14.36', currency: 'USD' }, 0)).toBe(1436);
});

test('the same fixed company fee is added once to each selected shipment rate', () => {
  expect(upsCustomerChargeCents({ total: '14.36', currency: 'USD' }, 250)).toBe(1686);
  expect(upsCustomerChargeCents({ total: '19.12', currency: 'USD' }, 250)).toBe(2162);
});

test('invalid currency, fee, or overflow cannot produce an automatic USD charge', () => {
  expect(upsCustomerChargeCents({ total: '14.36', currency: 'CAD' }, 250)).toBeNull();
  expect(upsCustomerChargeCents({ total: '14.36', currency: 'USD' }, -1)).toBeNull();
  expect(upsCustomerChargeCents({ total: '14.36', currency: 'USD' }, 1.5)).toBeNull();
  expect(upsCustomerChargeCents({ total: '21474836.47', currency: 'USD' }, 1)).toBeNull();
});
