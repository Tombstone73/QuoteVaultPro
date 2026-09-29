import { beforeAll, beforeEach, describe, expect, jest, test } from "@jest/globals";
import { PgDialect } from "drizzle-orm/pg-core";
import { getTableName } from "drizzle-orm";

let rows: Record<string, any[]>;
let writes: string[];
let failOrderWrite = false;
const recalculate = jest.fn<any>();
const retrieveIntent = jest.fn<(...args: any[]) => Promise<any>>();
const cancelIntent = jest.fn<(...args: any[]) => Promise<any>>();
jest.unstable_mockModule('../lib/stripe', () => ({ getStripeClient: () => ({ paymentIntents: { retrieve: retrieveIntent, cancel: cancelIntent } }) }));
const query = () => {
  let table = "";
  const q: any = {
    from: (t: any) => { table = getTableName(t); return q; },
    where: () => q,
    limit: async (n: number) => structuredClone((rows[table] ?? []).slice(0, n)),
    for: () => q,
    then: (resolve: any, reject: any) => Promise.resolve(structuredClone(rows[table] ?? [])).then(resolve, reject),
  };
  return q;
};
const tx: any = {
  select: query,
  execute: jest.fn(async (statement: any) => {
    const query = new PgDialect().sqlToQuery(statement);
    if (!query.sql.includes('from audit_logs a')) return { rows: [] };
    expect(query.params).toEqual(['org', 'invoice']);
    const hold = (rows.audit_logs ?? []).find(event => event.actionType === 'invoice_billing_ownership_override'
      && !(rows.audit_logs ?? []).some(resolved => resolved.actionType === 'invoice_billing_ownership_reconciled' && resolved.newValues.overrideId === event.id));
    return { rows: hold ? [{ id: hold.id, invoiceId: 'invoice', reason: hold.newValues.reason, createdAt: hold.createdAt }] : [] };
  }),
  update: (t: any) => ({ set: (patch: any) => ({ where: async () => {
    const table = getTableName(t); if (!rows[table]?.length) return; writes.push(table); Object.assign(rows[table][0], patch);
  } }) }),
  insert: (table: any) => ({ values: async (event: any) => {
    const name = getTableName(table); (rows[name] ??= []).push({ id: 'event-' + rows[name].length, createdAt: new Date(), ...event });
  } }),
};
const database = {
  select: query,
  execute: tx.execute,
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
  recalculateEditableOrderFinancialsInTransaction: recalculate,
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
  recalculate.mockReset().mockImplementation(async (handle: any) => { expect(handle).toBe(tx); return rows.orders[0]; });
  retrieveIntent.mockReset().mockResolvedValue({ id: 'pi_unpaid', status: 'requires_payment_method', amount_received: 0, latest_charge: null, metadata: { organizationId: 'org', invoiceId: 'invoice' } });
  cancelIntent.mockReset().mockResolvedValue({ id: 'pi_unpaid', status: 'canceled' });
});
const save = (changes: any) => operations.updateEditableHeader({ organizationId: "org", actorUserId: "staff", orderId: "order", changes });

describe("canonical contact billing owner transaction (mocked persistence)", () => {
  test('mutable Customer change updates both identities and captures before/after audit', async () => {
    await save({ customerId: 'zionsville', contactId: null });
    expect(rows.orders[0].customerId).toBe('zionsville');
    expect(rows.invoices[0].customerId).toBe('zionsville');
    expect(rows.audit_logs).toEqual(expect.arrayContaining([expect.objectContaining({ entityType: 'order',
      oldValues: { customerId: 'company', contactId: 'contact' }, newValues: { customerId: 'zionsville', contactId: null } })]));
  });
  test('reselecting current Customer repairs a mutable stale Invoice through the same transaction', async () => {
    rows.orders[0].customerId = 'zionsville';
    await save({ customerId: 'zionsville' });
    expect(rows.invoices[0]).toMatchObject({ customerId: 'zionsville', invoiceVersion: 2 });
    expect(writes).toEqual(['invoices', 'orders']);
  });
  test.each(['amountPaid', 'syncedAt'])('reselecting current Customer cannot silently repair protected %s history', async field => {
    rows.orders[0].customerId = 'zionsville'; rows.invoices[0][field] = field === 'amountPaid' ? '85.00' : new Date();
    await expect(save({ customerId: 'zionsville' })).rejects.toThrow(/Invoice|payment/);
    expect(rows.invoices[0].customerId).toBe('company'); expect(writes).toEqual([]);
  });
  test('same-owner stale Invoice repair rolls back when the Order write fails', async () => {
    rows.orders[0].customerId = 'zionsville'; failOrderWrite = true;
    await expect(save({ customerId: 'zionsville' })).rejects.toThrow('order write failed');
    expect(rows.invoices[0].customerId).toBe('company');
  });
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
  await expect(save({ customerId: null })).rejects.toThrow('payment has been applied or refunded');
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

// Matches the observed 20491 sequence: approved/exported, then edited/revoked.
// Versions/reference are representative fixtures, not a claim about raw MAIN fields.
test('20491 prior successful sync remains immutable after current approval is revoked', async () => {
  Object.assign(rows.invoices[0], { status: 'finalized', invoiceVersion: 3, amountPaid: '0.00',
    accountingApprovedAt: null, accountingApprovedVersion: null, accountingApprovalRevokedAt: new Date('2026-09-28'),
    qbSyncStatus: 'needs_resync', lastQbSyncedVersion: 1, syncedAt: new Date('2026-09-23'), qbInvoiceId: 'fixture-qb-reference' });
  await expect(save({ customerId: 'different-company' })).rejects.toThrow('this Invoice was synchronized to QuickBooks');
  expect(writes).toEqual([]);
  expect(rows.orders[0].customerId).toBe('company');
});

test.each(['not_synced', 'pending', 'failed'])('internally finalized, unapproved Invoice with %s and no export changes both owners', async qbSyncStatus => {
  Object.assign(rows.invoices[0], { status: 'finalized', qbSyncStatus, accountingApprovedAt: null,
    accountingApprovedVersion: null, qbInvoiceId: null, lastQbSyncedVersion: null, syncedAt: null });
  rows.quickbooks_sync_queue = [{ id: 'attempt', status: qbSyncStatus }];
  await save({ customerId: 'different-company', contactId: null });
  expect(rows.orders[0]).toMatchObject({ customerId: 'different-company', contactId: null });
  expect(rows.invoices[0]).toMatchObject({ customerId: 'different-company', contactId: null });
  expect(writes).toEqual(['invoices', 'orders']);
});

const regression20491 = () => {
  Object.assign(rows.orders[0], { orderNumber: '20491', status: 'operationally_complete', fulfillmentStatus: 'delivered',
    updatedAt: new Date('2026-09-28T17:00:00Z'), total: '350.36', tax: '0.00' });
  Object.assign(rows.invoices[0], { status: 'finalized', invoiceVersion: 3, invoiceNumber: 20491, total: '350.36', totalCents: 35036,
    subtotal: '350.36', tax: '0.00', taxCents: 0, balanceDue: '350.36', amountPaid: '0.00', qbInvoiceId: 'qb-existing',
    externalAccountingId: 'qb-existing', syncedAt: new Date('2026-09-23T15:14:00Z'), lastQbSyncedVersion: 1,
    accountingApprovedAt: new Date('2026-09-23T15:13:00Z'), accountingApprovedVersion: 1, accountingApprovalRevokedAt: new Date('2026-09-28'), qbSyncStatus: 'needs_resync' });
};
const overriddenSave = (changes: any = { customerId: null, contactId: 'janet' }, extras: any = {}) => operations.updateEditableHeader({
  organizationId: 'org', actorUserId: 'admin-user', actorOrgRole: 'admin', orderId: 'order', allowNonNew: true, changes,
  billingOwnershipOverride: { invoiceId: 'invoice', invoiceVersion: 3, orderUpdatedAt: '2026-09-28T17:00:00.000Z', confirmed: true, reason: 'Correct locally; accounting will correct QuickBooks.' }, ...extras,
});

describe('audited unpaid QuickBooks ownership override (mocked persistence)', () => {
  test('20491 normal save still blocks and offers context only to an authorized reviewer', async () => {
    regression20491();
    await expect(operations.updateEditableHeader({ organizationId: 'org', actorUserId: 'admin', actorOrgRole: 'admin', orderId: 'order', allowNonNew: true, changes: { customerId: 'new' } }))
      .rejects.toMatchObject({ details: { billingOwnershipOverride: { invoiceId: 'invoice', invoiceVersion: 3 } } });
    expect(writes).toEqual([]);
  });
  test.each([{ customerId: null, contactId: 'janet' }, { customerId: 'correct-customer', contactId: null }])('changes both owners while preserving all financial and operational fields: %j', async target => {
    regression20491();
    const invoiceBefore = structuredClone(rows.invoices[0]);
    await overriddenSave(target);
    expect(rows.orders[0]).toMatchObject({ ...target, status: 'operationally_complete', fulfillmentStatus: 'delivered', total: '350.36', tax: '0.00' });
    expect(rows.invoices[0]).toMatchObject({ ...target, qbSyncStatus: 'needs_resync', accountingApprovedAt: null, invoiceVersion: 4 });
    for (const key of ['total', 'totalCents', 'subtotal', 'tax', 'taxCents', 'balanceDue', 'amountPaid', 'qbInvoiceId', 'externalAccountingId', 'syncedAt', 'lastQbSyncedVersion', 'invoiceNumber']) expect(rows.invoices[0][key]).toEqual(invoiceBefore[key]);
    expect(rows.payments).toBeUndefined(); expect(cancelIntent).not.toHaveBeenCalled();
    expect(recalculate).not.toHaveBeenCalled();
    const event = rows.audit_logs.find(row => row.actionType === 'invoice_billing_ownership_override');
    expect(event).toMatchObject({ userId: 'admin-user', oldValues: { customerId: 'company', contactId: null },
      newValues: { orderId: 'order', orderNumber: '20491', ...target, accountingState: 'ownership_review_required', reason: expect.any(String), overriddenAt: expect.any(String), priorQuickBooks: { qbInvoiceId: 'qb-existing', lastQbSyncedVersion: 1 } } });
    expect(event.createdAt).toBeInstanceOf(Date);
  });
  test.each(['succeeded', 'captured', 'refunded', 'partially_refunded'])('blocks %s money history without writes', async status => {
    regression20491(); rows.payments = [{ id: 'paid', status }];
    await expect(overriddenSave()).rejects.toThrow('Override is unavailable'); expect(writes).toEqual([]);
  });
  test.each(['customerPaymentBatchId', 'customerAccountCreditApplicationId'])('blocks payment allocation %s', async key => {
    regression20491(); rows.payments = [{ status: 'pending', [key]: 'allocated' }];
    await expect(overriddenSave()).rejects.toThrow('Override is unavailable'); expect(writes).toEqual([]);
  });
  test('blocks partial rollup and refund request evidence', async () => {
    regression20491(); rows.invoices[0].amountPaid = '10';
    await expect(overriddenSave()).rejects.toThrow('Override is unavailable');
    rows.invoices[0].amountPaid = '0'; rows.stripe_refund_requests = [{ id: 'refund' }];
    await expect(overriddenSave()).rejects.toThrow('Override is unavailable'); expect(writes).toEqual([]);
  });
  test.each(['stripe_payment_attempts', 'customer_payment_batches'])('unresolved %s must be handled separately; no cancellation performed', async table => {
    regression20491(); rows[table] = [{ id: 'pending', status: 'pending' }];
    await expect(overriddenSave()).rejects.toThrow('Override is unavailable'); expect(writes).toEqual([]); expect(cancelIntent).not.toHaveBeenCalled();
  });
  test('denies unauthorized roles, missing confirmation/reason, extra financial fields, and stale invoice/order', async () => {
    regression20491();
    await expect(overriddenSave(undefined, { actorOrgRole: 'employee' })).rejects.toMatchObject({ statusCode: 403 });
    await expect(overriddenSave(undefined, { billingOwnershipOverride: { confirmed: false, reason: 'reason' } })).rejects.toThrow('Confirm');
    await expect(overriddenSave(undefined, { billingOwnershipOverride: { confirmed: true, reason: ' ' } })).rejects.toThrow('Confirm');
    await expect(overriddenSave({ customerId: 'new', total: '0' })).rejects.toThrow('only Customer and Contact');
    rows.invoices[0].invoiceVersion = 4;
    await expect(overriddenSave()).rejects.toThrow('Invoice changed');
    rows.orders[0].updatedAt = new Date('2026-09-29');
    await expect(overriddenSave()).rejects.toThrow('Order changed'); expect(writes).toEqual([]);
  });
  test('an unsynced Invoice needs ordinary save, not an accounting override', async () => {
    regression20491(); Object.assign(rows.invoices[0], { qbInvoiceId: null, externalAccountingId: null, syncedAt: null, lastQbSyncedVersion: null, qbSyncStatus: 'not_synced' });
    await expect(overriddenSave()).rejects.toThrow('Override is unavailable'); expect(writes).toEqual([]);
  });
  test('failed Order write rolls back the owner, revoked approval, and audit hold', async () => {
    regression20491(); failOrderWrite = true;
    await expect(overriddenSave()).rejects.toThrow('order write failed');
    expect(rows.invoices[0]).toMatchObject({ customerId: 'company', invoiceVersion: 3 });
    expect(rows.audit_logs.some(row => row.actionType === 'invoice_billing_ownership_override')).toBe(false);
  });
  test('hold blocks automatic/manual provider callbacks and approval, then acknowledgment releases only that hold', async () => {
    regression20491(); await overriddenSave();
    const review = await import('../services/billingOwnershipReview.service');
    const transmit = jest.fn(async () => 'sent');
    for (const source of ['automatic', 'manual']) {
      await expect(review.withBillingOwnershipSyncGuard('org', 'invoice', transmit)).rejects.toThrow('Update the customer in QuickBooks');
    }
    expect(transmit).not.toHaveBeenCalled();
    const quickBooks = await import('../quickbooksService');
    await expect(quickBooks.syncSingleInvoiceToQuickBooksForOrganization('org', 'invoice')).rejects.toMatchObject({ code: 'BILLING_OWNERSHIP_REVIEW_REQUIRED' });
    const approval = await import('../services/invoiceAccountingApproval.service');
    const result = await approval.approveInvoicesForAccounting({ organizationId: 'org', invoiceIds: ['invoice'], actorUserId: 'admin' });
    expect(result.results[0]).toMatchObject({ outcome: 'skipped', code: 'BILLING_OWNERSHIP_REVIEW_REQUIRED' });
    const hold = await review.getBillingOwnershipReview('org', 'invoice');
    await expect(review.acknowledgeBillingOwnershipReview({ organizationId: 'org', invoiceId: 'invoice', overrideId: 'stale', actorUserId: 'admin', actorOrgRole: 'admin', reason: 'Corrected QB', confirmed: true })).rejects.toThrow('review changed');
    await review.acknowledgeBillingOwnershipReview({ organizationId: 'org', invoiceId: 'invoice', overrideId: hold!.id, actorUserId: 'admin', actorOrgRole: 'admin', reason: 'Corrected QB', confirmed: true });
    expect(await review.getBillingOwnershipReview('org', 'invoice')).toBeNull();
    expect(rows.invoices[0].accountingApprovedAt).toBeNull();
    expect(rows.audit_logs.filter(row => row.actionType === 'invoice_billing_ownership_override')).toHaveLength(1);
    await expect(review.withBillingOwnershipSyncGuard('org', 'invoice', transmit)).resolves.toBe('sent');
    expect(rows.audit_logs.some(row => row.actionType === 'invoice_billing_ownership_reconciled')).toBe(true);
  });
});
