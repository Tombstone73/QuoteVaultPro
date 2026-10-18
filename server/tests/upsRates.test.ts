import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';

const selectRows = jest.fn<() => unknown[]>();
const getShipment = jest.fn<() => Promise<unknown>>();
const upsRateCredentials = jest.fn<() => Promise<unknown>>();
const markUpsAccountVerified = jest.fn<() => Promise<void>>();
const dbMock = { select: jest.fn(() => ({ from: () => ({ where: () => ({ limit: async () => selectRows() }) }) })),
  insert: jest.fn(), update: jest.fn() };
jest.unstable_mockModule('../db', () => ({ db: dbMock }));
jest.unstable_mockModule('../services/fulfillment/canonicalFulfillmentOperations', () => ({ canonicalFulfillmentOperations: { getShipment } }));
jest.unstable_mockModule('../services/ups/upsConnection', () => ({ upsRateCredentials, markUpsAccountVerified }));

const { buildUpsRateRequest, normalizeUpsRates, getUpsRates } = await import('../services/ups/upsRates');
const party = { name: 'Receiver', company: 'Custom Destination', address1: '10 QA Street', address2: null,
  city: 'Carmel', state: 'IN', postalCode: '46032', country: 'US', phone: null, email: null };
const origin = { ...party, company: 'Print Shop', address1: '20 Origin Road' };
const packages = [{ id: 'package-1', packagingType: '02' as const, weightLbs: 2, lengthIn: 10, widthIn: 8, heightIn: 4 }];
const originalEnv = { ...process.env };

beforeEach(() => {
  dbMock.insert.mockClear(); dbMock.update.mockClear(); selectRows.mockReset(); getShipment.mockReset();
  upsRateCredentials.mockReset(); markUpsAccountVerified.mockReset();
  upsRateCredentials.mockResolvedValue({ token: 'tenant-token', accountNumber: 'QA1234', baseUrl: 'https://wwwcie.ups.com', row: { verifiedAt: null } });
  selectRows.mockReturnValue([{ companyName: 'Print Shop', phone: null, email: null,
      physicalAddress: { line1: '20 Origin Road', city: 'Carmel', state: 'IN', postalCode: '46032', country: 'US' } }]);
  getShipment.mockResolvedValue({ status: 'DRAFT', shippingContext: { destination: party, blindShipping: false, blindSender: null },
    packages: [{ id: 'package-1' }] });
});
afterEach(() => { process.env = { ...originalEnv }; jest.restoreAllMocks(); });

describe('UPS rating boundary', () => {
  test('uses the saved custom destination, shop origin and account for a read-only Shop request', () => {
    const request = buildUpsRateRequest({ origin, destination: party, shipperNumber: 'QA1234', packages });
    expect(request.RateRequest.Shipment.ShipTo.Address.AddressLine).toEqual(['10 QA Street']);
    expect(request.RateRequest.Shipment.ShipFrom.Address.AddressLine).toEqual(['20 Origin Road']);
    expect(request.RateRequest.Shipment.Shipper.ShipperNumber).toBe('QA1234');
    expect(request.RateRequest.Shipment.ShipmentRatingOptions.NegotiatedRatesIndicator).toBe('Y');
    expect(request.RateRequest.Shipment.Package).toHaveLength(1);
  });

  test('normalizes published and negotiated totals without falsely labeling published prices', () => {
    expect(normalizeUpsRates({ RateResponse: { RatedShipment: [
      { Service: { Code: '03' }, TotalCharges: { CurrencyCode: 'USD', MonetaryValue: '19.50' } },
      { Service: { Code: '02' }, TotalCharges: { CurrencyCode: 'USD', MonetaryValue: '40.00' },
        NegotiatedRateCharges: { TotalCharge: { CurrencyCode: 'USD', MonetaryValue: '31.25' } } },
    ] } })).toMatchObject([
      { serviceName: 'UPS Ground', total: '19.50', negotiated: false },
      { serviceName: 'UPS 2nd Day Air', total: '31.25', negotiated: true },
    ]);
    expect(normalizeUpsRates({ RateResponse: { RatedShipment: [] } })).toEqual([]);
  });

  test('rejects invalid packages before calling UPS and never writes shipment or financial records', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch');
    await expect(getUpsRates('qa-org', 'draft-1', [{ ...packages[0], weightLbs: 0 }])).rejects.toMatchObject({ code: 'UPS_INVALID_PACKAGE' });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(dbMock.insert).not.toHaveBeenCalled(); expect(dbMock.update).not.toHaveBeenCalled();
  });

  test('returns account rates while leaving persisted shipment state unchanged', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ RateResponse: { RatedShipment: {
        Service: { Code: '03' }, TotalCharges: { CurrencyCode: 'USD', MonetaryValue: '22.30' } } } }) } as Response);
    const result = await getUpsRates('qa-org', 'draft-1', packages);
    expect(result.rates).toMatchObject([{ total: '22.30', negotiated: false }]);
    const ratingCall = fetchMock.mock.calls[0];
    const body = JSON.parse(String(ratingCall[1]?.body));
    expect(new Headers(ratingCall[1]?.headers).get('Authorization')).toBe('Bearer tenant-token');
    expect(body.RateRequest.Shipment.Shipper.ShipperNumber).toBe('QA1234');
    expect(body.RateRequest.Shipment.ShipTo.Address.AddressLine).toEqual(['10 QA Street']);
    expect(body.RateRequest.Shipment.ShipFrom.Address.AddressLine).toEqual(['20 Origin Road']);
    expect(dbMock.insert).not.toHaveBeenCalled(); expect(dbMock.update).not.toHaveBeenCalled();
    expect(markUpsAccountVerified).toHaveBeenCalledTimes(1);
  });

  test('authentication failure reports safe recovery instructions and preserves package inputs', async () => {
    const originalPackages = structuredClone(packages);
    jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce({ ok: false, status: 401,
      json: async () => ({ error: 'secret upstream detail' }) } as Response);
    await expect(getUpsRates('qa-org', 'draft-1', packages)).rejects.toMatchObject({ code: 'UPS_AUTH_FAILED' });
    expect(packages).toEqual(originalPackages);
    expect(dbMock.insert).not.toHaveBeenCalled(); expect(dbMock.update).not.toHaveBeenCalled();
  });

  test('provider rejection does not write or replace draft package data', async () => {
    const originalPackages = structuredClone(packages);
    jest.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({ ok: false, status: 400, json: async () => ({ detail: 'private address data' }) } as Response);
    await expect(getUpsRates('qa-org', 'draft-1', packages)).rejects.toMatchObject({ code: 'UPS_RATE_REJECTED' });
    expect(packages).toEqual(originalPackages);
    expect(dbMock.insert).not.toHaveBeenCalled(); expect(dbMock.update).not.toHaveBeenCalled();
  });

  test('does not expose another tenant connection', async () => {
    upsRateCredentials.mockRejectedValueOnce({ code: 'UPS_NOT_CONNECTED' });
    await expect(getUpsRates('another-org', 'draft-1', packages)).rejects.toMatchObject({ code: 'UPS_NOT_CONNECTED' });
    expect(upsRateCredentials).toHaveBeenCalledWith('another-org');
  });
});
