import { beforeAll, beforeEach, describe, expect, jest, test } from "@jest/globals";
const existing = { id: "order", organizationId: "org", customerId: "customer", contactId: "contact", status: "new", state: "open", total: "500.00", orderNumber: "20500", updatedAt: new Date() };
const updateOrder = jest.fn<any>();
const createOrder = jest.fn<any>();
const recalculate = jest.fn<any>();
const audit = jest.fn<any>();
const oldCreditGuard = jest.fn<any>();
const select = () => ({ from: () => ({ where: () => ({ limit: async () => [existing] }) }) });
const tx = { select, insert: () => ({ values: audit }) };
jest.unstable_mockModule('../db', () => ({ db: { ...tx, transaction: async (fn: any) => fn(tx) } }));
jest.unstable_mockModule('../storage', () => ({ storage: { createOrder, convertQuoteToOrder: createOrder } }));
jest.unstable_mockModule('../storage/orders.repo', () => ({ OrdersRepository: class { updateOrder = updateOrder; } }));
jest.unstable_mockModule('../services/orderCustomerResolutionService', () => ({ resolveOrderCustomerContactIds: async () => ({ customerId: 'customer', contactId: 'contact' }) }));
jest.unstable_mockModule('../services/customerCreditPolicyService', () => ({ assertCustomerCreditForOrder: oldCreditGuard, orderPayloadTotalCents: () => 50000 }));
jest.unstable_mockModule('../services/orders/orderTaxCalculationService', () => ({ recalculateEditableOrderFinancialsInTransaction: recalculate }));
let operations: typeof import('../services/orders/canonicalOrderOperations').canonicalOrderOperations;
beforeAll(async () => { operations = (await import('../services/orders/canonicalOrderOperations')).canonicalOrderOperations; });
beforeEach(() => { jest.clearAllMocks(); createOrder.mockResolvedValue(existing); updateOrder.mockImplementation(async (_org: string, _id: string, changes: any) => ({ ...existing, ...changes })); recalculate.mockResolvedValue({ ...existing, total: '700.00' }); audit.mockResolvedValue(undefined); oldCreditGuard.mockImplementation(() => { throw new Error('credit limit exceeded'); }); });
describe('Order entry remains available without granting production credit', () => {
  test('creates an over-credit Order and preserves canonical state', async () => {
    await expect(operations.create({ organizationId: 'org', actorUserId: 'staff', payload: { customerId: 'customer', lineItems: [{ totalPrice: 500 }] } as any })).resolves.toMatchObject({ status: 'new', state: 'open' });
    expect(createOrder).toHaveBeenCalled(); expect(oldCreditGuard).not.toHaveBeenCalled(); expect(audit).toHaveBeenCalled();
  });
  test.each([{ poNumber: 'PO-1' }, { total: '700.00' }, { dueDate: new Date() }])('permits header edits while credit is insufficient: %p', async changes => {
    await expect(operations.updateEditableHeader({ organizationId: 'org', actorUserId: 'staff', orderId: 'order', changes: changes as any })).resolves.toBeDefined();
    expect(updateOrder).toHaveBeenCalledWith('org', 'order', changes); expect(oldCreditGuard).not.toHaveBeenCalled();
  });
  test('retains commercial recalculation after a price change', async () => {
    await operations.updateEditableHeader({ organizationId: 'org', actorUserId: 'staff', orderId: 'order', changes: { total: '700.00' } as any });
    expect(recalculate).toHaveBeenCalledWith(tx, expect.objectContaining({ orderId: 'order' }));
  });
  test('keeps metadata edits outside financial recalculation', async () => {
    await operations.updateEditableHeader({ organizationId: 'org', actorUserId: 'staff', orderId: 'order', changes: { poNumber: 'PO-1' } as any });
    expect(recalculate).not.toHaveBeenCalled();
  });
  test('Quote conversion retains its canonical entry path', async () => {
    await expect(operations.convertQuoteToOrder({ organizationId: 'org', actorUserId: 'staff', quoteId: 'quote' })).resolves.toBe(existing);
    expect(oldCreditGuard).not.toHaveBeenCalled();
  });
});
