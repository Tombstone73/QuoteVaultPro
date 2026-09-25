import { beforeAll, beforeEach, describe, expect, jest, test } from "@jest/globals";
import { getTableName } from "drizzle-orm";

let rows: Record<string, any[]>;
let writes: string[];
let failOrderWrite = false;
const retrieveIntent = jest.fn<(...args: any[]) => Promise<any>>();
const cancelIntent = jest.fn<(...args: any[]) => Promise<any>>();
jest.unstable_mockModule('../lib/stripe', () => ({ getStripeClient: () => ({ paymentIntents: { retrieve: retrieveIntent, cancel: cancelIntent } }) }));
const query = () => {
  let table = "";
  const q: any = {
    from: (t: any) => { table = getTableName(t); return q; },
    where: () => q,
    limit: async (n: number) => (rows[table] ?? []).slice(0, n),
    then: (resolve: any, reject: any) => Promise.resolve(rows[table] ?? []).then(resolve, reject),
  };
  return q;
};
const tx: any = {
  select: query,
  execute: jest.fn(async () => ({ rows: [] })),
  update: (t: any) => ({ set: (patch: any) => ({ where: async () => {
    const table = getTableName(t); if (!rows[table]?.length) return; writes.push(table); Object.assign(rows[table][0], patch);
  } }) }),
  insert: () => ({ values: async () => {} }),
};
const database = {
  select: query,
  transaction: async (fn: (handle: any) => any) => {
    const before = structuredClone(rows);
    try { return await fn(tx); } catch (error) { rows = before; throw error; }
  },
};
jest.unstable_mockModule("../db", () => ({ db: database }));
jest.unstable_mockModule("../storage", () => ({ storage: {} }));
jest.unstable_mockModule("../services/orderCustomerResolutionService", () => ({
  resolveOrderCustomerContactIds: async (input: any) => ({ customerId: input.customerId, contactId: input.contactId }),
}));
jest.unstable_mockModule("../services/customerCreditPolicyService", () => ({
  assertCustomerCreditForOrder: async () => ({}), orderPayloadTotalCents: () => 2500,
}));
jest.unstable_mockModule("../storage/orders.repo", () => ({ OrdersRepository: class {
  constructor(handle: any) { expect(handle).toBe(tx); }
  async updateOrder(_org: string, _id: string, patch: any) {
    if (failOrderWrite) throw new Error("order write failed");
    writes.push("orders"); Object.assign(rows.orders[0], patch); return rows.orders[0];
  }
} }));
jest.unstable_mockModule("../services/orders/orderTaxCalculationService", () => ({
  recalculateEditableOrderFinancialsInTransaction: async (handle: any) => { expect(handle).toBe(tx); return rows.orders[0]; },
}));
let operations: typeof import("../services/orders/canonicalOrderOperations").canonicalOrderOperations;
beforeAll(async () => { operations = (await import("../services/orders/canonicalOrderOperations")).canonicalOrderOperations; });
beforeEach(() => {
  rows = {
    orders: [{ id: "order", organizationId: "org", customerId: "company", contactId: "contact", status: "new", total: "25.00" }],
    invoices: [{ id: "invoice", organizationId: "org", customerId: "company", contactId: null, status: "billed", issuedAt: new Date(), amountPaid: "0", invoiceVersion: 1 }],
    audit_logs: [{ id: "automatic-creation" }],
  };
  writes = []; failOrderWrite = false;
  retrieveIntent.mockReset().mockResolvedValue({ id: 'pi_unpaid', status: 'requires_payment_method', amount_received: 0, latest_charge: null, metadata: { organizationId: 'org', invoiceId: 'invoice' } });
  cancelIntent.mockReset().mockResolvedValue({ id: 'pi_unpaid', status: 'canceled' });
});
const save = (changes: any) => operations.updateEditableHeader({ organizationId: "org", actorUserId: "staff", orderId: "order", changes });

describe("canonical contact billing owner transaction (mocked persistence)", () => {
  test("explicit clear retains Contact and retargets the safe automatic Invoice in the same transaction", async () => {
    await save({ customerId: null });
    expect(rows.orders[0]).toMatchObject({ customerId: null, contactId: "contact" });
    expect(rows.invoices[0]).toMatchObject({ customerId: null, contactId: "contact", invoiceVersion: 2 });
    expect(writes).toEqual(["invoices", "orders"]);
  });
  test("omitted Customer preserves Customer-only ownership", async () => {
    await save({ contactId: null });
    expect(rows.orders[0]).toMatchObject({ customerId: "company", contactId: null });
    expect(writes).toEqual(["orders"]);
  });
  test("neither-owner request fails before any write", async () => {
    await expect(save({ customerId: null, contactId: null })).rejects.toThrow("Select a customer or contact");
    expect(writes).toEqual([]);
  });
  test.each(["payments", "invoice_email_logs", "invoice_email_delivery_jobs", "customer_payment_batches"])("blocks %s evidence without changing either owner", async table => {
    rows[table] = [{ id: "history", status: "succeeded" }];
    await expect(save({ customerId: null })).rejects.toThrow(/Invoice|payment/);
    expect(writes).toEqual([]);
    expect(rows.invoices[0].customerId).toBe("company");
  });
  test.each(["accountingApprovedAt", "qbInvoiceId", "importedAt", "lastSentAt"])("blocks immutable %s", async field => {
    rows.invoices[0][field] = "history";
    await expect(save({ customerId: null })).rejects.toThrow(/Invoice/);
    expect(writes).toEqual([]);
  });
  test("an Order write failure rolls back the Invoice update through the transaction boundary", async () => {
    failOrderWrite = true;
    await expect(save({ customerId: null })).rejects.toThrow("order write failed");
    expect(rows.invoices[0]).toMatchObject({ customerId: "company", contactId: null, invoiceVersion: 1 });
  });
});

for (const status of ['requires_payment_method', 'requires_confirmation', 'requires_action', 'canceled']) {
  test(`20544 incomplete intent ${status} is retired before both owners change`, async () => {
    rows.payments = [{ id: 'payment', provider: 'stripe', status: 'pending', amountCents: 25000, appliedAt: new Date(), stripePaymentIntentId: 'pi_unpaid', metadata: { stripeAccountId: 'acct_original' } }];
    retrieveIntent.mockResolvedValue({ status, amount_received: 0, latest_charge: null, metadata: { organizationId: 'org', invoiceId: 'invoice' } });
    await save({ customerId: 'correct-company', contactId: null });
    expect(rows.orders[0].customerId).toBe('correct-company');
    expect(rows.invoices[0]).toMatchObject({ customerId: 'correct-company', contactId: null });
    expect(rows.payments[0].status).toBe('canceled');
    if (status !== 'canceled') expect(cancelIntent).toHaveBeenCalledWith('pi_unpaid', {}, expect.objectContaining({ stripeAccount: 'acct_original' }));
    else expect(cancelIntent).not.toHaveBeenCalled();
  });
}
test.each(['failed', 'canceled'])('%s attempt without money does not lock the owner', async status => {
  rows.payments = [{ id: 'payment', provider: 'stripe', status, amountCents: 25000, appliedAt: new Date() }];
  await save({ customerId: 'correct-company' });
  expect(rows.invoices[0].customerId).toBe('correct-company');
});
test.each(['succeeded', 'captured', 'refunded'])('%s payment preserves financial ownership', async status => {
  rows.payments = [{ id: 'payment', status }];
  await expect(save({ customerId: null })).rejects.toThrow('payment applied or refunded');
  expect(writes).toEqual([]);
});
test.each(['customer_account_credit_applications', 'customer_account_credits', 'stripe_refund_requests'])('%s locks financial ownership', async table => {
  rows[table] = [{ id: 'financial-history' }];
  await expect(save({ customerId: null })).rejects.toThrow(/credit|refund/);
  expect(writes).toEqual([]);
});
test('processing or externally succeeded payment cannot be reattributed despite a stale pending ledger', async () => {
  rows.payments = [{ id: 'payment', provider: 'stripe', status: 'pending', stripePaymentIntentId: 'pi_unpaid', metadata: { stripeAccountId: 'acct_original' } }];
  for (const status of ['processing', 'requires_capture', 'succeeded']) {
    retrieveIntent.mockResolvedValue({ status, amount_received: status === 'succeeded' ? 25000 : 0, metadata: { organizationId: 'org', invoiceId: 'invoice' } });
    await expect(save({ customerId: null })).rejects.toThrow(/Stripe/);
    expect(rows.invoices[0].customerId).toBe('company');
  }
  expect(cancelIntent).not.toHaveBeenCalled();
});
test('a Stripe confirmation racing cancellation leaves both owners unchanged', async () => {
  rows.payments = [{ id: 'payment', provider: 'stripe', status: 'pending', stripePaymentIntentId: 'pi_unpaid', metadata: { stripeAccountId: 'acct_original' } }];
  cancelIntent.mockRejectedValue(new Error('payment_intent_unexpected_state'));
  await expect(save({ customerId: null })).rejects.toThrow('Billing details were not changed');
  expect(rows.invoices[0].customerId).toBe('company');
  expect(rows.orders[0].customerId).toBe('company');
  expect(rows.payments[0].status).toBe('pending');
});

test('an unfunded grouped session is canceled before owner transfer without creating allocation rows', async () => {
  rows.customer_payment_batches = [{ id: 'batch', status: 'pending', stripeAccountId: 'acct_original', stripePaymentIntentId: 'pi_grouped' }];
  retrieveIntent.mockResolvedValue({ status: 'requires_confirmation', amount_received: 0, metadata: { organizationId: 'org', customerPaymentBatchId: 'batch' } });
  await save({ customerId: 'correct-company' });
  expect(rows.customer_payment_batches[0].status).toBe('canceled');
  expect(rows.invoices[0].customerId).toBe('correct-company');
  expect(rows.payments).toBeUndefined();
});

test('provider identity mismatch fails closed without canceling another billing context', async () => {
  rows.payments = [{ id: 'payment', provider: 'stripe', status: 'pending', stripePaymentIntentId: 'pi_other', metadata: { stripeAccountId: 'acct_original' } }];
  retrieveIntent.mockResolvedValue({ status: 'requires_payment_method', amount_received: 0, metadata: { organizationId: 'other', invoiceId: 'invoice' } });
  await expect(save({ customerId: null })).rejects.toThrow('identity does not match');
  expect(cancelIntent).not.toHaveBeenCalled();
  expect(rows.invoices[0].customerId).toBe('company');
});
