import { beforeEach, describe, expect, jest, test } from '@jest/globals';

const selectRows = jest.fn<() => unknown[]>();
const updateEditableHeader = jest.fn<(...args: unknown[]) => Promise<unknown>>();
const upsRateCredentials = jest.fn<() => Promise<unknown>>();
const resolveUpsShippingContext = jest.fn<() => Promise<unknown>>();
const db = { select: jest.fn(() => ({ from: () => ({
  innerJoin: () => ({ where: async () => selectRows() }),
  where: () => ({ limit: async () => selectRows() }),
}) })) };
jest.unstable_mockModule('../db', () => ({ db }));
jest.unstable_mockModule('../services/orders/canonicalOrderOperations', () => ({ canonicalOrderOperations: { updateEditableHeader } }));
jest.unstable_mockModule('../services/ups/upsConnection', () => ({ upsRateCredentials }));
jest.unstable_mockModule('../services/ups/upsRates', () => ({ resolveUpsShippingContext,
  upsShippingFingerprint: () => 'current-fingerprint',
  selectedUpsQuoteRate: (rates: Array<{ optionId: string }>, optionId: string) => rates.find(rate => rate.optionId === optionId) ?? null }));
const { applyUpsRateToCustomerCharge } = await import('../services/ups/upsCharges');

const order = { orderId: 'order-1', orderNumber: 'QA-1', shippingCents: 0, shippingChargeDecision: 'unset',
  shippingChargeRateQuoteId: null, shippingChargeRateServiceCode: null, shippingChargeRateOptionId: null,
  updatedAt: new Date('2026-10-19T12:00:00Z') };
const quote = { id: 'quote-1', environment: 'test', requestFingerprint: 'current-fingerprint', expiresAt: new Date('2099-01-01'),
  rates: [{ optionId: '0', serviceCode: '03', serviceName: 'UPS Ground', total: '18.40', currency: 'USD' }] };
const input = { organizationId: 'tenant-a', shipmentId: 'shipment-1', quoteId: 'quote-1',
  optionId: '0', intent: 'default_if_unset' as const, actorUserId: 'staff-1' };

beforeEach(() => {
  db.select.mockClear(); selectRows.mockReset(); updateEditableHeader.mockReset();
  upsRateCredentials.mockReset(); resolveUpsShippingContext.mockReset();
  selectRows.mockReturnValueOnce([order]).mockReturnValueOnce([quote]);
  upsRateCredentials.mockResolvedValue({ accountNumber: 'QA1234', row: { mode: 'test' } });
  resolveUpsShippingContext.mockResolvedValue({ origin: {}, sender: {}, destination: {}, packages: [],
    shipment: { shipDate: null } });
  updateEditableHeader.mockResolvedValue({ id: order.orderId, shippingCents: 1840 });
});

describe('UPS customer charge policy', () => {
  test('defaults a genuinely unset charge through the canonical Order and Invoice transaction', async () => {
    const result = await applyUpsRateToCustomerCharge(input);
    expect(result.applied).toBe(true);
    expect(updateEditableHeader).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: 'tenant-a', orderId: 'order-1', requireInvoiceParity: true,
      expectedUpdatedAt: order.updatedAt,
      changes: { shippingCents: 1840, shippingChargeDecision: 'ups_rate',
        shippingChargeRateQuoteId: 'quote-1', shippingChargeRateServiceCode: '03', shippingChargeRateOptionId: '0' },
    }));
  });

  test('uses the chosen Ground option rather than the first rate with the same service code', async () => {
    selectRows.mockReset().mockReturnValueOnce([order]).mockReturnValueOnce([{ ...quote, rates: [
      { ...quote.rates[0], optionId: '0', total: '19.77', estimatedArrival: '2026-10-26' },
      { ...quote.rates[0], optionId: '1', total: '23.77', estimatedArrival: '2026-10-27' },
    ] }]);
    await applyUpsRateToCustomerCharge({ ...input, optionId: '1' });
    expect(updateEditableHeader).toHaveBeenCalledWith(expect.objectContaining({ changes: expect.objectContaining({
      shippingCents: 2377, shippingChargeRateOptionId: '1' }) }));
  });

  test('does not apply a quote from another UPS environment', async () => {
    upsRateCredentials.mockResolvedValueOnce({ accountNumber: 'QA1234', row: { mode: 'live' } });
    await expect(applyUpsRateToCustomerCharge(input)).rejects.toMatchObject({ code: 'UPS_RATE_STALE' });
    expect(updateEditableHeader).not.toHaveBeenCalled();
  });

  test.each([
    ['free', 0], ['manual', 900], ['legacy', 0], ['ups_rate', 1840],
  ])('preserves an existing %s decision unless operator explicitly chooses UPS', async (decision, cents) => {
    selectRows.mockReset().mockReturnValueOnce([{ ...order, shippingChargeDecision: decision, shippingCents: cents }]);
    const result = await applyUpsRateToCustomerCharge(input);
    expect(result.applied).toBe(false);
    expect(updateEditableHeader).not.toHaveBeenCalled();
  });

  test('explicit use of UPS rate may replace free shipping but retains Invoice protections', async () => {
    selectRows.mockReset().mockReturnValueOnce([{ ...order, shippingChargeDecision: 'free' }]).mockReturnValueOnce([quote]);
    await applyUpsRateToCustomerCharge({ ...input, intent: 'use_ups_rate' });
    expect(updateEditableHeader).toHaveBeenCalledWith(expect.objectContaining({ requireInvoiceParity: true,
      changes: expect.objectContaining({ shippingCents: 1840, shippingChargeDecision: 'ups_rate' }) }));
  });

  test('combined Orders never receive the full carrier rate on each Order', async () => {
    selectRows.mockReset().mockReturnValueOnce([order, { ...order, orderId: 'order-2' }]);
    await expect(applyUpsRateToCustomerCharge(input)).rejects.toMatchObject({ code: 'UPS_COMBINED_CHARGE_ALLOCATION_REQUIRED' });
    expect(updateEditableHeader).not.toHaveBeenCalled();
  });

  test('a blocked linked Invoice leaves the attempted customer charge unreported as applied', async () => {
    updateEditableHeader.mockRejectedValueOnce({ code: 'ORDER_INVOICE_SYNC_BLOCKED', statusCode: 409 });
    await expect(applyUpsRateToCustomerCharge(input)).rejects.toMatchObject({ code: 'ORDER_INVOICE_SYNC_BLOCKED' });
  });
});
