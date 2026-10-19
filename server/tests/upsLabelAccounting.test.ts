import { describe, expect, jest, test } from '@jest/globals';

jest.unstable_mockModule('../db', () => ({ db: {}, pool: {},
  hasQuoteAttachmentPagesTable: () => false, hasPageCountStatusColumn: () => false,
  probeDatabaseSchema: async () => undefined }));
const { buildUpsLabelRequest, normalizeUpsPurchase, classifyUpsVoidResponse } = await import('../services/ups/upsLabels');
const { projectUpsProfitability, upsProfitabilityCsv } = await import('../services/ups/upsProfitability');
const { isDispatchableUpsLabel, isOriginalUpsEnvironment, isUpsPlaceholderTracking } = await import('../services/ups/upsLabelEnvironment');

const party = (name: string, address1: string) => ({ name, company: null, address1, address2: null,
  city: 'Carmel', state: 'IN', postalCode: '46032', country: 'US', phone: '3175550100', email: null });
const tinyGif = Buffer.from('GIF89a\x01\x00\x01\x00\x80\x00\x00\x00\x00\x00\xff\xff\xff!\xf9\x04\x01\x00\x00\x00\x00,\x00\x00\x00\x00\x01\x00\x01\x00\x00\x02\x02D\x01\x00;').toString('base64');

describe('UPS purchase and profitability contracts', () => {
  test('purchase request uses the shop account, separate blind sender, custom Ship To, and each saved package', () => {
    const request = buildUpsLabelRequest({ origin: party('Shop', '1 Origin St'),
      sender: party('Blind Sender', '2 Sender St'), destination: party('Recipient', '3 Custom Ship To St'),
      accountNumber: 'QA1234', serviceCode: '03', packages: [
        { id: 'a', packagingType: '02', weightLbs: 2, lengthIn: 10, widthIn: 8, heightIn: 4 },
        { id: 'b', packagingType: '21', weightLbs: 3, lengthIn: 12, widthIn: 9, heightIn: 5 },
      ] });
    const shipment = request.ShipmentRequest.Shipment;
    expect(shipment.Shipper.ShipperNumber).toBe('QA1234');
    expect(shipment.ShipFrom.Address.AddressLine).toEqual(['2 Sender St']);
    expect(shipment.ShipTo.Address.AddressLine).toEqual(['3 Custom Ship To St']);
    expect(shipment.Package).toHaveLength(2);
    expect(shipment.Package.map(pkg => pkg.Packaging.Code)).toEqual(['02', '21']);
    expect(request.ShipmentRequest.LabelSpecification).toMatchObject({ LabelImageFormat: { Code: 'GIF' },
      LabelStockSize: { Height: '6', Width: '4' } });
  });

  test('normalizes purchased cost and two reusable package labels, rejecting incomplete provider evidence', () => {
    const response = { ShipmentResponse: { ShipmentResults: { ShipmentIdentificationNumber: '1ZSHIPMENT',
      ShipmentCharges: { TotalCharges: { CurrencyCode: 'USD', MonetaryValue: '25.00' } },
      NegotiatedRateCharges: { TotalCharge: { CurrencyCode: 'USD', MonetaryValue: '18.40' } },
      PackageResults: ['1ZPKG0001', '1ZPKG0002'].map(TrackingNumber => ({ TrackingNumber,
        ShippingLabel: { ImageFormat: { Code: 'GIF' }, GraphicImage: tinyGif } })) } } };
    const result = normalizeUpsPurchase(response, 2);
    expect(result).toMatchObject({ providerShipmentId: '1ZSHIPMENT', carrierCostCents: 1840,
      carrierCurrency: 'USD', labels: [{ trackingNumber: '1ZPKG0001' }, { trackingNumber: '1ZPKG0002' }] });
    expect(result?.labels[0].sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(normalizeUpsPurchase(response, 1)).toBeNull();
    expect(normalizeUpsPurchase({ ShipmentResponse: { ShipmentResults: {
      ...response.ShipmentResponse.ShipmentResults, PackageResults: [{ TrackingNumber: '1ZPKG0001' }] } } }, 1)).toBeNull();
  });

  test('distinguishes a confirmed UPS void from provider rejection and an uncertain response', () => {
    const accepted = { VoidShipmentResponse: { Response: { ResponseStatus: { Code: '1' } },
      SummaryResult: { Status: { Code: '1' } } } };
    expect(classifyUpsVoidResponse(200, accepted)).toBe('ACCEPTED');
    expect(classifyUpsVoidResponse(400, { error: 'void unavailable' })).toBe('REJECTED');
    expect(classifyUpsVoidResponse(429, null)).toBe('UNCERTAIN');
    expect(classifyUpsVoidResponse(200, { VoidShipmentResponse: { Response: { ResponseStatus: { Code: '1' } } } })).toBe('UNCERTAIN');
  });

  test('combined and replacement labels retain both costs while attributing each Order charge once', () => {
    const at = new Date('2026-10-19T12:00:00.000Z');
    const purchases = [
      { id: 'old', shipmentId: 'shipment-1', createdAt: at, purchasedAt: at, status: 'VOID_ACCEPTED', environment: 'live',
        serviceName: 'UPS Ground', providerShipmentId: '1ZOLD', estimateCents: 2100, estimateCurrency: 'USD',
        carrierCostCents: 1900, carrierCurrency: 'USD', voidAcceptedAt: at, externalCanceledAt: null },
      { id: 'new', shipmentId: 'shipment-1', createdAt: at, purchasedAt: new Date(at.getTime() + 1000), status: 'PURCHASED', environment: 'live',
        serviceName: 'UPS Ground', providerShipmentId: '1ZNEW', estimateCents: 2300, estimateCurrency: 'USD',
        carrierCostCents: 2200, carrierCurrency: 'USD', voidAcceptedAt: null, externalCanceledAt: null },
    ];
    const orderLinks = purchases.flatMap(purchase => [
      { purchaseId: purchase.id, orderId: 'order-a', invoiceId: 'invoice-a', customerShippingChargeCents: 1500,
        customerChargeDecision: 'manual', invoiceShippingCents: 1500, invoiceStatus: 'issued' },
      { purchaseId: purchase.id, orderId: 'order-b', invoiceId: null, customerShippingChargeCents: 800,
        customerChargeDecision: 'free', invoiceShippingCents: null, invoiceStatus: null },
    ]);
    const rows = projectUpsProfitability({ purchases, orderLinks,
      adjustments: [{ purchaseId: 'old', kind: 'CONFIRMED_CREDIT', amountCents: 1900,
        currency: 'USD', providerReference: 'credit-1' }],
      orderNames: new Map(), invoiceState: new Map([['invoice-a', { status: 'issued', shippingCents: 1500 }]]),
      shipmentDetails: new Map([['shipment-1', { reference: 'SH-QA-01',
        shipDate: new Date('2026-10-20T00:00:00Z'), shippedAt: null }]]),
      trackingByPurchase: new Map([['new', ['1ZPKG0001', '1ZPKG0002']]]) });
    expect(rows.map(row => row.carrierCostCents)).toEqual([1900, 2200]);
    expect(rows.map(row => row.confirmedCreditsCents)).toEqual([1900, 0]);
    expect(rows.map(row => row.customerShippingChargeCents)).toEqual([0, 2300]);
    expect(rows.map(row => row.issuedInvoiceShippingCents)).toEqual([0, 1500]);
    expect(rows[1].differenceCents).toBe(100);
    expect(rows[0].orders.every(order => !order.attributedHere)).toBe(true);
    expect(rows[1].orders.every(order => order.attributedHere)).toBe(true);
    expect(rows[1]).toMatchObject({ shipmentReference: 'SH-QA-01', shipDate: '2026-10-20',
      trackingNumbers: ['1ZPKG0001', '1ZPKG0002'] });
  });

  test('does not subtract USD customer charge from a foreign-currency carrier cost', () => {
    const at = new Date('2026-10-19T12:00:00.000Z');
    const rows = projectUpsProfitability({ purchases: [{ id: 'cad', shipmentId: 'shipment', createdAt: at,
      purchasedAt: at, status: 'PURCHASED', environment: 'live', serviceName: 'UPS Standard', providerShipmentId: '1ZCAD',
      estimateCents: 2000, estimateCurrency: 'CAD', carrierCostCents: 1900, carrierCurrency: 'CAD',
      voidAcceptedAt: null, externalCanceledAt: null }],
      orderLinks: [{ purchaseId: 'cad', orderId: 'order', invoiceId: null,
        customerShippingChargeCents: 2500, customerChargeDecision: 'manual', invoiceShippingCents: null, invoiceStatus: null }],
      adjustments: [], orderNames: new Map(), invoiceState: new Map() });
    expect(rows[0].differenceCents).toBeNull();
    expect(upsProfitabilityCsv(rows)).toContain('"CAD"');
  });

  test('uses the current Order charge for profitability while retaining the purchase-time amount', () => {
    const at = new Date('2026-10-19T12:00:00.000Z');
    const rows = projectUpsProfitability({ purchases: [{ id: 'label', shipmentId: 'shipment', createdAt: at,
      purchasedAt: at, status: 'PURCHASED', environment: 'live', serviceName: 'UPS Ground', providerShipmentId: '1ZLABEL01',
      estimateCents: 1800, estimateCurrency: 'USD', carrierCostCents: 1700, carrierCurrency: 'USD',
      voidAcceptedAt: null, externalCanceledAt: null }],
      orderLinks: [{ purchaseId: 'label', orderId: 'order', invoiceId: null,
        customerShippingChargeCents: 1800, customerChargeDecision: 'ups_rate', invoiceShippingCents: null, invoiceStatus: null }],
      adjustments: [], orderNames: new Map([['order', { orderNumber: 'QA-1', customerName: 'QA', shippingCents: 2000 }]]),
      invoiceState: new Map() });
    expect(rows[0]).toMatchObject({ customerShippingChargeCents: 2000,
      customerShippingChargeAtPurchaseCents: 1800, differenceCents: 300 });
  });

  test('includes a later single issued Invoice without multiplying the purchased label cost', () => {
    const at = new Date('2026-10-19T12:00:00.000Z');
    const rows = projectUpsProfitability({ purchases: [{ id: 'label', shipmentId: 'shipment', createdAt: at,
      purchasedAt: at, status: 'PURCHASED', environment: 'live', serviceName: 'UPS Ground', providerShipmentId: '1ZLABEL01',
      estimateCents: 1800, estimateCurrency: 'USD', carrierCostCents: 1700, carrierCurrency: 'USD',
      voidAcceptedAt: null, externalCanceledAt: null }],
      orderLinks: [{ purchaseId: 'label', orderId: 'order', invoiceId: null,
        customerShippingChargeCents: 1800, customerChargeDecision: 'ups_rate', invoiceShippingCents: null, invoiceStatus: null }],
      adjustments: [], orderNames: new Map(), invoiceState: new Map(),
      currentInvoiceByOrder: new Map([['order', { id: 'invoice-later', status: 'issued', shippingCents: 1800 }]]) });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ carrierCostCents: 1700, issuedInvoiceShippingCents: 1800,
      orders: [{ invoiceId: 'invoice-later', invoiceStatus: 'issued' }] });
  });

  test('excludes sandbox and unverified purchases before attributing customer charges', () => {
    const at = new Date('2026-10-19T12:00:00.000Z');
    const base = { shipmentId: 'shipment', createdAt: at, purchasedAt: at, status: 'PURCHASED',
      serviceName: 'UPS Ground', providerShipmentId: '1ZLABEL01', estimateCents: 1200,
      estimateCurrency: 'USD', carrierCostCents: 1100, carrierCurrency: 'USD', voidAcceptedAt: null,
      externalCanceledAt: null };
    const purchases = [{ ...base, id: 'live', environment: 'live' as const },
      { ...base, id: 'test', environment: 'test' as const, purchasedAt: new Date(at.getTime() + 1000) },
      { ...base, id: 'old', environment: 'unknown' as const, purchasedAt: new Date(at.getTime() + 2000) }];
    const orderLinks = purchases.map(purchase => ({ purchaseId: purchase.id, orderId: 'order',
      invoiceId: null, customerShippingChargeCents: 1500, customerChargeDecision: 'manual',
      invoiceShippingCents: null, invoiceStatus: null }));
    const rows = projectUpsProfitability({ purchases, orderLinks, adjustments: [],
      orderNames: new Map(), invoiceState: new Map() });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ purchaseId: 'live', carrierCostCents: 1100,
      customerShippingChargeCents: 1500, differenceCents: 400 });
  });

  test('test, unknown, and sample-tracking labels cannot authorize dispatch', () => {
    expect(isUpsPlaceholderTracking('1ZXXXXXXXXXXXXXXXX')).toBe(true);
    expect(isDispatchableUpsLabel('test', '1ZREAL123456')).toBe(false);
    expect(isDispatchableUpsLabel('unknown', '1ZREAL123456')).toBe(false);
    expect(isDispatchableUpsLabel('live', '1ZXXXXXXXXXXXXXXXX')).toBe(false);
    expect(isDispatchableUpsLabel('live', '1ZREAL123456')).toBe(true);
  });

  test('a void is bound to the original verified provider environment', () => {
    expect(isOriginalUpsEnvironment('test', 'test')).toBe(true);
    expect(isOriginalUpsEnvironment('live', 'live')).toBe(true);
    expect(isOriginalUpsEnvironment('test', 'live')).toBe(false);
    expect(isOriginalUpsEnvironment('unknown', 'test')).toBe(false);
  });
});
