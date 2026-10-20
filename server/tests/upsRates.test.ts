import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';

const selectRows = jest.fn<() => unknown[]>();
const getShipment = jest.fn<() => Promise<unknown>>();
const upsRateCredentials = jest.fn<() => Promise<unknown>>();
const markUpsAccountVerified = jest.fn<() => Promise<void>>();
const dbMock = { select: jest.fn(() => ({ from: () => ({ where: () => ({ limit: async () => selectRows() }) }) })),
  insert: jest.fn(() => ({ values: () => ({ returning: async () => [{ id: 'quote-1' }] }) })), update: jest.fn() };
jest.unstable_mockModule('../db', () => ({ db: dbMock }));
jest.unstable_mockModule('../services/fulfillment/canonicalFulfillmentOperations', () => ({ canonicalFulfillmentOperations: { getShipment } }));
jest.unstable_mockModule('../services/ups/upsConnection', () => ({ upsRateCredentials, markUpsAccountVerified }));

const { buildUpsRateRequest, normalizeUpsRates, getUpsRates, upsProviderRateError,
  upsShippingFingerprint, upsQuoteLifetimeMs } = await import('../services/ups/upsRates');
const party = { name: 'Receiver', company: 'Custom Destination', address1: '10 QA Street', address2: null,
  city: 'Carmel', state: 'IN', postalCode: '46032', country: 'US', phone: null, email: null };
const origin = { ...party, company: 'Print Shop', address1: '20 Origin Road' };
const packages = [{ id: 'package-1', packagingType: '02' as const, weightLbs: 2, lengthIn: 10, widthIn: 8, heightIn: 4 }];
const originalEnv = { ...process.env };

beforeEach(() => {
  dbMock.insert.mockClear(); dbMock.update.mockClear(); selectRows.mockReset(); getShipment.mockReset();
  upsRateCredentials.mockReset(); markUpsAccountVerified.mockReset();
  upsRateCredentials.mockResolvedValue({ token: 'tenant-token', accountNumber: 'QA1234', baseUrl: 'https://wwwcie.ups.com', row: { mode: 'test', verifiedAt: null } });
  selectRows.mockReturnValue([{ companyName: 'Print Shop', phone: null, email: null,
      physicalAddress: { line1: '20 Origin Road', city: 'Carmel', state: 'IN', postalCode: '46032', country: 'US' } }]);
  getShipment.mockResolvedValue({ status: 'DRAFT', shippingContext: { destination: party, blindShipping: false, blindSender: null },
    packages: [{ id: 'package-1', upsPackagingType: '02', weightLbs: '2',
      dimLengthIn: '10', dimWidthIn: '8', dimHeightIn: '4' }] });
});
afterEach(() => { process.env = { ...originalEnv }; jest.restoreAllMocks(); });

describe('UPS rating boundary', () => {
  test('uses the saved custom destination, shop origin and account for a read-only Shop request', () => {
    const request = buildUpsRateRequest({ origin, destination: party, shipperNumber: 'QA1234', packages });
    expect(request.RateRequest.Shipment.ShipTo.Address.AddressLine).toEqual(['10 QA Street']);
    expect(request.RateRequest.Shipment.ShipFrom.Address.AddressLine).toEqual(['20 Origin Road']);
    expect(request.RateRequest.Shipment.Shipper.ShipperNumber).toBe('QA1234');
    expect(request.RateRequest.Shipment.ShipmentRatingOptions.NegotiatedRatesIndicator).toBe('Y');
    expect(request.RateRequest.Request.RequestOption).toBe('Shop');
    expect(request.RateRequest.Shipment.Package).toHaveLength(1);
  });

  test('normalizes both saved origin and destination before calling UPS without changing saved records', async () => {
    const savedDestination = { ...party, state: ' Florida ', country: 'United States' };
    getShipment.mockResolvedValueOnce({ status: 'DRAFT', shippingContext: { destination: savedDestination,
      blindShipping: false, blindSender: null }, packages: [{ id: 'package-1', upsPackagingType: '02', weightLbs: '2',
      dimLengthIn: '10', dimWidthIn: '8', dimHeightIn: '4' }] });
    selectRows.mockReturnValueOnce([{ companyName: 'Print Shop', phone: null, email: null,
      physicalAddress: { line1: '20 Origin Road', city: 'Orlando', state: 'Florida', postalCode: '32801', country: 'USA' } }]);
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce({ ok: true, status: 200,
      json: async () => ({ RateResponse: { RatedShipment: { Service: { Code: '03' },
        TotalCharges: { CurrencyCode: 'USD', MonetaryValue: '20.00' } } } }) } as Response);
    await getUpsRates('qa-org', 'draft-1', packages);
    const request = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(request.RateRequest.Shipment.Shipper.Address).toMatchObject({ StateProvinceCode: 'FL', CountryCode: 'US' });
    expect(request.RateRequest.Shipment.ShipTo.Address).toMatchObject({ StateProvinceCode: 'FL', CountryCode: 'US' });
    expect(savedDestination.state).toBe(' Florida ');
  });

  test('quote fingerprints ignore unrelated names while retaining rate-relevant changes', () => {
    const input = { origin, sender: origin, destination: party, accountNumber: 'QA1234', packages, shipDate: '2026-10-23' };
    const fingerprint = upsShippingFingerprint(input);
    expect(upsShippingFingerprint({ ...input, destination: { ...party, name: 'Another recipient' } })).toBe(fingerprint);
    expect(upsShippingFingerprint({ ...input, shipDate: '2026-10-24' })).not.toBe(fingerprint);
    expect(upsShippingFingerprint({ ...input, packages: [{ ...packages[0], weightLbs: 3 }] })).not.toBe(fingerprint);
    expect(upsShippingFingerprint({ ...input, destination: { ...party, state: 'Florida' } })).not.toBe(fingerprint);
    expect(upsQuoteLifetimeMs()).toBe(15 * 60_000);
    process.env.UPS_RATE_QUOTE_TTL_MINUTES = '20';
    expect(upsQuoteLifetimeMs()).toBe(20 * 60_000);
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

  test('uses the planned ship date and only a provider calendar date for delivery display', () => {
    const request = buildUpsRateRequest({ origin, destination: party, shipperNumber: 'QA1234', packages, shipDate: '2026-10-23' });
    expect(request.RateRequest.Request.RequestOption).toBe('shopTimeInTransit');
    expect(request.RateRequest.Shipment.DeliveryTimeInformation).toMatchObject({ Pickup: { Date: '20261023' } });
    expect(normalizeUpsRates({ RateResponse: { RatedShipment: [
      { Service: { Code: '03' }, TotalCharges: { CurrencyCode: 'USD', MonetaryValue: '20.00' },
        TimeInTransit: { ServiceSummary: { EstimatedArrival: { Arrival: { Date: '20261027', Time: '1600' } } } } },
      { Service: { Code: '02' }, TotalCharges: { CurrencyCode: 'USD', MonetaryValue: '40.00' },
        GuaranteedDelivery: { BusinessDaysInTransit: '2' } },
    ] } })).toMatchObject([{ estimatedArrival: '2026-10-27', estimatedDeliveryTime: '1600' },
      { estimatedArrival: null }]);
  });

  test('uses UPS time-in-transit rating only when the draft has a planned ship date', async () => {
    getShipment.mockResolvedValueOnce({ status: 'DRAFT', shipDate: '2026-10-23',
      shippingContext: { destination: party, blindShipping: false, blindSender: null },
      packages: [{ id: 'package-1', upsPackagingType: '02', weightLbs: '2', dimLengthIn: '10', dimWidthIn: '8', dimHeightIn: '4' }] });
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce({ ok: true, status: 200,
      json: async () => ({ RateResponse: { RatedShipment: { Service: { Code: '03' },
        TotalCharges: { CurrencyCode: 'USD', MonetaryValue: '22.30' } } } }) } as Response);
    await getUpsRates('qa-org', 'draft-1', packages);
    expect(fetchMock.mock.calls[0][0]).toBe('https://wwwcie.ups.com/api/rating/v2409/Shoptimeintransit');
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body.RateRequest.Request.RequestOption).toBe('shopTimeInTransit');
    expect(body.RateRequest.Shipment.DeliveryTimeInformation.Pickup.Date).toBe('20261023');
  });

  test('preserves safe UPS reason, code and affected box without exposing credentials', () => {
    expect(upsProviderRateError({ response: { errors: [{ code: '111590',
      message: 'Package 1 length is invalid for this service.' }] } }, packages))
      .toMatchObject({ code: '111590', description: 'Package 1 length is invalid for this service.', affectedField: 'Box 1' });
    expect(upsProviderRateError({ response: { errors: [{ code: 'BAD!', message: 'token: secretvalue test@example.com 12345678' }] } }, packages))
      .toMatchObject({ code: null, description: '[credential] [email] [number]' });
    expect(upsProviderRateError({ response: { errors: [{ code: '110001', message: 'Unable to rate 123 Main Street for package 1.' }] } }, packages))
      .toMatchObject({ description: 'Unable to rate [address] for package 1.', affectedField: 'Box 1' });
  });

  test('rejects invalid packages before calling UPS and never writes shipment or financial records', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch');
    await expect(getUpsRates('qa-org', 'draft-1', [{ ...packages[0], weightLbs: 0 }])).rejects.toMatchObject({ code: 'UPS_INVALID_PACKAGE' });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(dbMock.insert).not.toHaveBeenCalled(); expect(dbMock.update).not.toHaveBeenCalled();
  });

  test('returns account rates and saves only a bounded quote, leaving shipment and finances unchanged', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ RateResponse: { RatedShipment: {
        Service: { Code: '03' }, TotalCharges: { CurrencyCode: 'USD', MonetaryValue: '22.30' } } } }) } as Response);
    const result = await getUpsRates('qa-org', 'draft-1', packages);
    expect(result.rates).toMatchObject([{ total: '22.30', negotiated: false }]);
    const ratingCall = fetchMock.mock.calls[0];
    expect(ratingCall[0]).toBe('https://wwwcie.ups.com/api/rating/v2409/Shop');
    const body = JSON.parse(String(ratingCall[1]?.body));
    expect(new Headers(ratingCall[1]?.headers).get('Authorization')).toBe('Bearer tenant-token');
    expect(body.RateRequest.Shipment.Shipper.ShipperNumber).toBe('QA1234');
    expect(body.RateRequest.Shipment.ShipTo.Address.AddressLine).toEqual(['10 QA Street']);
    expect(body.RateRequest.Shipment.ShipFrom.Address.AddressLine).toEqual(['20 Origin Road']);
    expect(result.quoteId).toBe('quote-1');
    expect(result.environment).toBe('test');
    expect(dbMock.insert).toHaveBeenCalledTimes(1); expect(dbMock.update).not.toHaveBeenCalled();
    expect(markUpsAccountVerified).toHaveBeenCalledTimes(1);
  });

  test('rates two differently sized saved boxes as one shipment total', async () => {
    const second = { id: 'package-2', packagingType: '21' as const, weightLbs: 6,
      lengthIn: 20, widthIn: 12, heightIn: 8 };
    getShipment.mockResolvedValueOnce({ status: 'DRAFT',
      shippingContext: { destination: party, blindShipping: false, blindSender: null },
      packages: [
        { id: 'package-1', upsPackagingType: '02', weightLbs: '2', dimLengthIn: '10', dimWidthIn: '8', dimHeightIn: '4' },
        { id: 'package-2', upsPackagingType: '21', weightLbs: '6', dimLengthIn: '20', dimWidthIn: '12', dimHeightIn: '8' },
      ] });
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce({ ok: true, status: 200,
      json: async () => ({ RateResponse: { RatedShipment: { Service: { Code: '03' },
        TotalCharges: { CurrencyCode: 'USD', MonetaryValue: '30.00' } } } }) } as Response);
    const result = await getUpsRates('qa-org', 'draft-1', [...packages, second]);
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body.RateRequest.Shipment.Package).toHaveLength(2);
    expect(body.RateRequest.Shipment.Package.map((item: any) => item.PackageWeight.Weight)).toEqual(['2', '6']);
    expect(result.rates).toMatchObject([{ total: '30.00' }]);
    expect(dbMock.insert).toHaveBeenCalledTimes(1);
    expect(dbMock.update).not.toHaveBeenCalled();
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

  test('provider rejection carries the sanitized UPS explanation and correlation reference', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce({ ok: false, status: 400,
      json: async () => ({ response: { errors: [{ code: '111590', message: 'Package 1 length is invalid.' }] } }) } as Response);
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(getUpsRates('qa-org', 'draft-1', packages)).rejects.toMatchObject({ code: 'UPS_RATE_REJECTED',
      providerCode: '111590', providerDescription: 'Package 1 length is invalid.', affectedField: 'Box 1',
      requestReference: expect.stringMatching(/^[a-f0-9]{32}$/) });
    expect(warn).toHaveBeenCalledWith('[UPS RATE] Provider rejection', expect.objectContaining({ providerCode: '111590' }));
    expect(dbMock.insert).not.toHaveBeenCalled();
  });

  test('does not expose another tenant connection', async () => {
    upsRateCredentials.mockRejectedValueOnce({ code: 'UPS_NOT_CONNECTED' });
    await expect(getUpsRates('another-org', 'draft-1', packages)).rejects.toMatchObject({ code: 'UPS_NOT_CONNECTED' });
    expect(upsRateCredentials).toHaveBeenCalledWith('another-org');
  });
});
