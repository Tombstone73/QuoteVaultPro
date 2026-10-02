import { describe, expect, jest, test } from '@jest/globals';
import { PgDialect } from 'drizzle-orm/pg-core';
import { orderShippingContext, commonShipmentShippingContext, orderingCustomerSender, resolveOrderingCustomerSender, resolveShipmentShippingContext, validateShipmentShippingContext } from '../services/fulfillment/shippingContext';
import { patchShipmentSchema } from '../services/fulfillment/schemas';

const flatOrder = { id: 'order-a', shipToName: ' Recipient ', shipToAddress1: '12 Main', shipToCity: 'Phoenix', shipToState: 'AZ', shipToPostalCode: '85001', shipToPhone: '111' };
const legacy = { name: 'Legacy recipient', address1: '34 Other', city: 'Austin', state: 'TX', zip: '78701', phone: '222' };
const account = { customerId: 'customer-a', companyName: 'Ordering Company', email: 'orders@example.test', phone: '317-555-0100',
  billingStreet1: '100 Billing Street', billingStreet2: null, billingCity: 'Indianapolis', billingState: 'IN', billingPostalCode: '46250', billingCountry: 'US' };

describe('shipment-owned shipping context', () => {
  test('flat address is authoritative as a whole, including intentionally absent fields', () => {
    const context = orderShippingContext({ ...flatOrder, shippingAddress: legacy });
    expect(context).toMatchObject({ source: 'order', destination: { name: 'Recipient', address1: '12 Main', city: 'Phoenix', phone: '111', email: null } });
    const partial = orderShippingContext({ id: 'order-a', shipToAddress1: '12 Main', shippingAddress: legacy });
    expect(partial.destination).toMatchObject({ address1: '12 Main', name: null, city: null, phone: null });
    expect(() => validateShipmentShippingContext(partial, ['order-a'], true)).toThrow('Complete Ship To');
  });

  test('no flat address uses the entire legacy JSON without mixing flat identity/contact', () => {
    const context = orderShippingContext({ id: 'order-a', shipToName: 'Unrelated flat name', shipToPhone: '999', shippingAddress: legacy });
    expect(context).toMatchObject({ source: 'legacy_order', destination: { name: 'Legacy recipient', address1: '34 Other', postalCode: '78701', phone: '222' } });
  });

  test('common blind preference is captured but never guesses an organization sender', () => {
    const first = orderShippingContext({ ...flatOrder, blindShipping: true });
    const second = { ...first, sourceOrderId: 'order-b' };
    expect(commonShipmentShippingContext([first, second])).toMatchObject({ blindShipping: true, blindSender: null });
    expect(() => validateShipmentShippingContext(first, ['order-a'], true)).toThrow('explicit confirmation');
    expect(validateShipmentShippingContext({ ...first, source: 'staff', blindSender: { ...first.destination, company: 'Confirmed alternate' } }, ['order-a'], true).blindSender?.company).toBe('Confirmed alternate');
  });

  test('an Order-level blind sender is distinct from Ship To and overrides the Customer default', () => {
    const blindSender = {
      company: 'Alternate Sender', name: 'Shipping Desk', address1: '90 Sender Way', address2: null,
      city: 'Carmel', state: 'IN', postalCode: '46032', country: 'US', phone: null, email: null,
    };
    const enabled = orderShippingContext({ ...flatOrder, customerBlindShipping: false, blindShipping: true, blindShippingAddress: blindSender });
    expect(enabled).toMatchObject({
      blindShipping: true,
      blindSenderSource: 'custom',
      blindSender: { company: 'Alternate Sender', address1: '90 Sender Way' },
      destination: { address1: '12 Main' },
    });
    expect(orderShippingContext({ ...flatOrder, customerBlindShipping: true, blindShipping: false }).blindShipping).toBe(false);
  });

  test('ordering customer uses one account billing address, not Ship To or another linked customer', () => {
    expect(orderingCustomerSender([{ ...account, ...flatOrder }]).sender).toMatchObject({
      company: 'Ordering Company', address1: '100 Billing Street', city: 'Indianapolis', phone: '317-555-0100',
    });
    expect(orderingCustomerSender([account, { ...account, customerId: 'other' }])).toMatchObject({ sender: null });
    expect(orderingCustomerSender([{ ...account, billingStreet1: null }]).issue).toContain('street address');
    expect(orderingCustomerSender([{ ...account, billingStreet1: null }]).sender?.address1).toBeNull();
    expect(orderingCustomerSender([{ ...account, companyName: 'A'.repeat(255) }]).issue).toContain('field limits');
  });

  test('combined destination and blind preference conflicts are actionable instead of primary-order guesses', () => {
    const first = orderShippingContext(flatOrder);
    expect(() => commonShipmentShippingContext([first, { ...first, blindShipping: true }])).toThrow('conflicting blind-shipping');
    expect(() => commonShipmentShippingContext([first, { ...first, destination: { ...first.destination, phone: 'Other phone' } }])).toThrow('different Ship To');
  });

  test('combined blind-shipping Orders require the same explicit sender', () => {
    const first = orderShippingContext({
      ...flatOrder,
      blindShipping: true,
      blindShippingAddress: { name: null, company: 'First Sender', address1: '1 Sender Way', address2: null, city: 'Carmel', state: 'IN', postalCode: '46032', country: null, phone: null, email: null },
    });
    const second = orderShippingContext({
      ...flatOrder,
      id: 'order-b',
      blindShipping: true,
      blindShippingAddress: { name: null, company: 'Second Sender', address1: '2 Sender Way', address2: null, city: 'Carmel', state: 'IN', postalCode: '46032', country: null, phone: null, email: null },
    });
    expect(() => commonShipmentShippingContext([first, second])).toThrow('different blind-shipping sender details');
  });

  test('PATCH shipping context is strict, source is bound, and blank logistics remain valid', () => {
    const context = orderShippingContext(flatOrder);
    expect(() => patchShipmentSchema.parse({ shippingContext: { ...context, unexpected: true } })).toThrow();
    expect(() => patchShipmentSchema.parse({ shippingContext: { ...context, destination: { ...context.destination, price: 10 } } })).toThrow();
    expect(() => validateShipmentShippingContext({ ...context, sourceOrderId: 'other-tenant-order' }, ['order-a'])).toThrow('linked');
    expect(() => validateShipmentShippingContext({ ...context, sourceOrderId: null }, ['order-a'])).toThrow('linked');
    expect(validateShipmentShippingContext({ ...context, source: 'staff', sourceOrderId: null }, ['order-a'])).toMatchObject({ source: 'staff' });
    expect(patchShipmentSchema.parse({ carrier: '', serviceLevel: ' ', trackingNumber: '', shipDate: null, shipmentItems: [] })).toMatchObject({ carrier: '', serviceLevel: '', trackingNumber: '', shipmentItems: [] });
  });

  test('resolver scopes Orders and customer defaults to organization and reads without writes', async () => {
    const queries: any[] = [];
    const write = jest.fn(() => { throw new Error('Resolver must be read-only'); });
    const dialect = new PgDialect();
    const executor: any = { insert: write, update: write, delete: write, select: () => {
      const chain: any = { from: () => chain, leftJoin: (_table: unknown, predicate: any) => { queries.push(dialect.sqlToQuery(predicate)); return chain; },
        where: (predicate: any) => { queries.push(dialect.sqlToQuery(predicate)); return Promise.resolve([{ ...flatOrder, blindShipping: true }]); } };
      return chain;
    } };
    await expect(resolveShipmentShippingContext('org-a', ['order-a'], executor)).resolves.toMatchObject({ blindShipping: true, blindSender: null });
    expect(queries[0].params).toContain('org-a');
    expect(queries[1].params).toEqual(['org-a', 'order-a']);
    expect(write).not.toHaveBeenCalled();
    await expect(resolveShipmentShippingContext('org-a', ['order-a', 'missing'], executor)).rejects.toMatchObject({ status: 404, code: 'ORDER_NOT_FOUND' });
  });

  test('resolver preserves an explicit Order blind sender over the ordering-customer fallback', async () => {
    const blindShippingAddress = {
      company: 'Alternate Sender', name: 'Shipping Desk', address1: '90 Sender Way', address2: null,
      city: 'Carmel', state: 'IN', postalCode: '46032', country: 'US', phone: null, email: null,
    };
    const write = jest.fn(() => { throw new Error('Resolver must be read-only'); });
    const executor: any = { insert: write, update: write, delete: write, select: () => {
      const chain: any = {
        from: () => chain,
        leftJoin: () => chain,
        where: () => Promise.resolve([{
          ...flatOrder, ...account, blindShipping: true, customerBlindShipping: true, blindShippingAddress,
        }]),
      };
      return chain;
    } };
    await expect(resolveShipmentShippingContext('org-a', ['order-a'], executor)).resolves.toMatchObject({
      blindShipping: true,
      blindSenderSource: 'custom',
      blindSender: { company: 'Alternate Sender', address1: '90 Sender Way' },
    });
    expect(write).not.toHaveBeenCalled();
  });

  test('an explicit custom source never falls back to a Customer address when its sender is incomplete', async () => {
    const executor: any = { select: () => {
      const chain: any = { from: () => chain, leftJoin: () => chain, where: () => Promise.resolve([{
        ...flatOrder, ...account, blindShipping: true, blindShippingAddressSource: 'custom', blindShippingAddress: { company: 'Incomplete sender' },
      }]) };
      return chain;
    } };
    await expect(resolveShipmentShippingContext('org-a', ['order-a'], executor)).resolves.toMatchObject({
      blindShipping: true,
      blindSender: null,
    });
  });

  test('an explicit Customer source resolves the ordering Customer address without modifying Ship To', async () => {
    const write = jest.fn(() => { throw new Error('Resolver must be read-only'); });
    const executor: any = { insert: write, update: write, delete: write, select: () => {
      const chain: any = { from: () => chain, leftJoin: () => chain, where: () => Promise.resolve([{
        ...flatOrder, ...account, blindShipping: true, blindShippingAddressSource: 'customer',
      }]) };
      return chain;
    } };
    await expect(resolveShipmentShippingContext('org-a', ['order-a'], executor)).resolves.toMatchObject({
      blindShipping: true,
      blindSenderSource: 'ordering_customer',
      blindSender: { company: 'Ordering Company', address1: '100 Billing Street' },
      destination: { address1: '12 Main' },
    });
    expect(write).not.toHaveBeenCalled();
  });

  test('new blind draft snapshots the ordering customer; later account changes cannot alter saved context', async () => {
    const dialect = new PgDialect();
    const predicates: any[] = [];
    const write = jest.fn(() => { throw new Error('Customer must not be mutated'); });
    let accountAddress = account.billingStreet1;
    const executor: any = { insert: write, update: write, delete: write, select: () => {
      const chain: any = { from: () => chain, leftJoin: (_table: unknown, predicate: any) => { predicates.push(dialect.sqlToQuery(predicate)); return chain; },
        where: (predicate: any) => { predicates.push(dialect.sqlToQuery(predicate)); return Promise.resolve([{ ...flatOrder, ...account, billingStreet1: accountAddress, blindShipping: true }]); } };
      return chain;
    } };
    const saved = await resolveShipmentShippingContext('org-a', ['order-a'], executor);
    expect(saved).toMatchObject({ blindShipping: true, blindSenderSource: 'ordering_customer', blindSender: { company: 'Ordering Company', address1: '100 Billing Street' }, destination: { address1: '12 Main' } });
    expect(validateShipmentShippingContext(saved, ['order-a'], true)).toEqual(saved);
    accountAddress = '200 Later Street';
    expect((await resolveOrderingCustomerSender('org-a', ['order-a'], executor)).sender?.address1).toBe('200 Later Street');
    expect(saved.blindSender?.address1).toBe('100 Billing Street');
    expect(predicates.every(predicate => predicate.params.includes('org-a'))).toBe(true);
    expect(write).not.toHaveBeenCalled();
  });
});
