import { shipmentShippingContextSchema, shippingPartyValidationErrors, shippingPartyAddressLines, shippingDocumentTypeSchema, type ShippingParty } from '../shippingDocuments';

const destination: ShippingParty = {
  name: 'Recipient', company: 'Customer', address1: '100 Main Street', address2: null,
  city: 'Phoenix', state: 'AZ', postalCode: '85001', country: 'US', phone: null, email: null,
};

describe('shared shipment document contract', () => {
  it('keeps sender and destination identities distinct and rejects unknown context fields', () => {
    const input = { version: 1, source: 'staff', sourceOrderId: 'order-one', destination, blindShipping: true,
      blindSender: { ...destination, name: 'Approved sender', company: 'Alternate sender' } };
    const result = shipmentShippingContextSchema.parse(input);
    expect(result.blindSender?.name).toBe('Approved sender');
    expect(result.destination.name).toBe('Recipient');
    expect(shipmentShippingContextSchema.safeParse({ ...input, customerId: 'changed-customer' }).success).toBe(false);
  });

  it('reports missing destination fields without inventing an address', () => {
    expect(shippingPartyValidationErrors(destination)).toEqual([]);
    expect(shippingPartyValidationErrors({ ...destination, name: null, company: null, address1: null, city: null, state: null, postalCode: null }))
      .toEqual(['recipient or company name', 'street address', 'city', 'state', 'ZIP/postal code']);
    expect(shippingPartyValidationErrors({ ...destination, country: 'GB', state: null })).toEqual([]);
    expect(shippingPartyAddressLines(destination)).toEqual(['Recipient', 'Customer', '100 Main Street', 'Phoenix AZ 85001', 'US']);
  });

  it('admits only explicit shipping document identities', () => {
    for (const type of ['packing_slip', 'shipment_manifest', 'package_ticket']) expect(shippingDocumentTypeSchema.safeParse(type).success).toBe(true);
    for (const type of ['traveler', 'unknown', 'https://example.com/document']) expect(shippingDocumentTypeSchema.safeParse(type).success).toBe(false);
  });
});
