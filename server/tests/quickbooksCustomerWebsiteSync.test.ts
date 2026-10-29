import { afterEach, beforeAll, beforeEach, describe, expect, jest, test } from '@jest/globals';
import { getTableName, sql } from 'drizzle-orm';

let customer: any; let invoice: any; let lineItems: any[];
let qbCustomer: any; let qbInvoice: any; let matchedCustomers: any[]; let customerApiError: boolean;
const writes: Array<{ table: string; patch: any }> = [];
const requests: Array<{ method: string; path: string; body?: any }> = [];
const connection = { id: 'connection-1', organizationId: 'org-1', provider: 'quickbooks', companyId: 'synthetic-realm', isActive: true, updatedAt: new Date(), createdAt: new Date(), metadata: {} };
const query = () => {
  let rows: any[] = [];
  const q: any = {
    from: (table: any) => { rows = ({ invoices: [invoice], customers: [customer], invoice_line_items: lineItems, oauth_connections: [connection] } as any)[getTableName(table)] ?? []; return q; },
    where: () => q, limit: () => q, orderBy: () => q,
    then: (resolve: any, reject: any) => Promise.resolve(rows).then(resolve, reject),
  };
  return q;
};
jest.unstable_mockModule('../db', () => ({ db: {
  select: query,
  update: (table: any) => ({ set: (patch: any) => ({ where: async () => {
    const name = getTableName(table); writes.push({ table: name, patch: structuredClone(patch) });
    if (name === 'customers') Object.assign(customer, patch);
    return [];
  } }) }),
  insert: () => ({ values: async () => [] }),
}, pool: {} }));
jest.unstable_mockModule('../services/invoiceCustomerProjection', () => ({ canonicalInvoiceCustomerId: sql`null`, getCanonicalInvoiceCustomerContext: async () => ({ storedCustomerId: customer.id, resolvedCustomerId: customer.id, customer }) }));
jest.unstable_mockModule('../services/billingOwnershipReview.service', () => ({
  withBillingOwnershipSyncGuard: async (_org: string, _invoice: string, work: () => Promise<unknown>) => work(), assertBillingOwnershipReconciled: async () => {},
  BillingOwnershipReviewError: class extends Error {}, requireBillingOwnershipReviewer: () => {}, getBillingOwnershipReview: async () => null,
}));
let service: typeof import('../quickbooksService');
let credentials: typeof import('../services/quickbooksCredentialManager');
beforeAll(async () => {
  credentials = await import('../services/quickbooksCredentialManager');
  service = await import('../quickbooksService');
});
const originalFetch = global.fetch;
const envKeys = ['QUICKBOOKS_CLIENT_ID', 'QUICKBOOKS_CLIENT_SECRET', 'QUICKBOOKS_REDIRECT_URI', 'QUICKBOOKS_ENVIRONMENT'] as const;
const savedEnv = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));

beforeEach(() => {
  writes.length = 0; requests.length = 0; qbCustomer = null; qbInvoice = null; matchedCustomers = []; customerApiError = false;
  customer = { id: 'customer-1', organizationId: 'org-1', companyName: 'Lloyd Waters', customerType: 'business', website: 'www.lloydwaters.com', email: 'synthetic@example.test', externalAccountingId: null, syncStatus: 'pending' };
  invoice = { id: 'invoice-20727', organizationId: 'org-1', customerId: customer.id, contactId: null, status: 'billed', invoiceVersion: 1, accountingApprovedVersion: 1, accountingApprovedAt: new Date(), accountingApprovalRevokedAt: null, displayNumber: '20727', invoiceNumber: '20727', issuedAt: new Date('2026-10-29T12:00:00Z'), subtotalCents: 10000, shippingCents: 0, taxCents: 700, totalCents: 10700, qbInvoiceId: null };
  lineItems = [{ id: 'line-1', invoiceId: invoice.id, description: 'Synthetic print work', quantity: 2, unitPriceCents: 5000, lineTotalCents: 10000 }];
  process.env.QUICKBOOKS_CLIENT_ID = 'synthetic-client'; process.env.QUICKBOOKS_CLIENT_SECRET = 'synthetic-secret';
  process.env.QUICKBOOKS_REDIRECT_URI = 'https://example.test/callback'; process.env.QUICKBOOKS_ENVIRONMENT = 'sandbox';
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'info').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(credentials.quickBooksCredentialManager, 'getValidAccessToken').mockResolvedValue('synthetic-access-token');
  jest.spyOn(credentials.quickBooksCredentialManager, 'loadCredentials').mockResolvedValue(connection as any);
  jest.spyOn(credentials.quickBooksCredentialManager, 'recordSuccessfulRequest').mockResolvedValue(undefined);
  global.fetch = jest.fn(async (input: any, init: any) => {
    const url = new URL(String(input));
    expect(url.origin).toBe('https://sandbox-quickbooks.api.intuit.com');
    const path = url.pathname.replace('/v3/company/synthetic-realm', '');
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(init.body) : undefined;
    requests.push({ method, path, body });
    const response = (value: any, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
    if (path === '/query') {
      const qbQuery = url.searchParams.get('query') ?? '';
      if (qbQuery.includes('FROM Customer')) return response({ QueryResponse: { Customer: qbCustomer ? [qbCustomer] : matchedCustomers } });
      if (qbQuery.includes('FROM Invoice')) return response({ QueryResponse: { Invoice: qbInvoice ? [qbInvoice] : [] } });
    }
    if (path.startsWith('/customer/') && method === 'GET') return response({ Customer: { Id: customer.externalAccountingId, SyncToken: 'existing-token' } });
    if (path === '/customer' && method === 'POST') {
      if (customerApiError) return response({ Fault: { Error: [{ code: '6000', Message: 'Unrelated customer validation error', Detail: 'Synthetic unrelated failure' }] } }, 400);
      qbCustomer = { ...body, Id: body.Id ?? 'qb-customer-new', SyncToken: 'customer-token' };
      return response({ Customer: qbCustomer });
    }
    if (path.startsWith('/invoice/') && method === 'GET') return response({ Invoice: qbInvoice });
    if (path === '/invoice' && method === 'POST') {
      qbInvoice = { ...body, Id: body.Id ?? 'qb-invoice-new', SyncToken: 'invoice-token', TotalAmt: body.Line.reduce((sum: number, line: any) => sum + line.Amount, 0) + (body.TxnTaxDetail?.TotalTax ?? 0) };
      return response({ Invoice: qbInvoice });
    }
    throw new Error(`Unexpected mocked QuickBooks request: ${method} ${path}`);
  }) as typeof fetch;
});
afterEach(() => {
  global.fetch = originalFetch;
  jest.restoreAllMocks();
  for (const key of envKeys) { if (savedEnv[key] === undefined) delete process.env[key]; else process.env[key] = savedEnv[key]; }
});
const customerPosts = () => requests.filter(request => request.method === 'POST' && request.path === '/customer');
const invoicePosts = () => requests.filter(request => request.method === 'POST' && request.path === '/invoice');
const syncInvoice = () => service.syncSingleInvoiceToQuickBooksForOrganization('org-1', invoice.id);
function assertNoWebsiteWrite() {
  expect(writes.filter(write => write.table === 'customers').every(write => !Object.prototype.hasOwnProperty.call(write.patch, 'website'))).toBe(true);
}

describe('Canonical QuickBooks customer website sync paths (all provider requests mocked)', () => {
  test('new customer creation during invoice sync normalizes Lloyd Waters without altering invoice economics', async () => {
    const originalInvoice = structuredClone(invoice); const originalLines = structuredClone(lineItems);
    expect(await syncInvoice()).toEqual({ qbInvoiceId: 'qb-invoice-new', invoiceVersion: 1 });
    expect(customerPosts()).toHaveLength(1);
    expect(customerPosts()[0].body).toMatchObject({ DisplayName: 'Lloyd Waters', WebAddr: { URI: 'https://www.lloydwaters.com/' } });
    expect(invoicePosts()[0].body).toMatchObject({ DocNumber: '20727', CustomerRef: { value: 'qb-customer-new' }, TxnTaxDetail: { TotalTax: 7 }, Line: [{ Amount: 100, SalesItemLineDetail: { Qty: 2, UnitPrice: 50 } }] });
    expect(invoice).toEqual(originalInvoice); expect(lineItems).toEqual(originalLines);
    expect(customer.website).toBe('www.lloydwaters.com'); assertNoWebsiteWrite();
  });

  test('linked QuickBooks customer keeps its ID and bypasses customer creation', async () => {
    customer.externalAccountingId = 'qb-customer-linked';
    await syncInvoice();
    expect(customerPosts()).toHaveLength(0);
    expect(invoicePosts()[0].body.CustomerRef.value).toBe('qb-customer-linked');
    expect(customer.externalAccountingId).toBe('qb-customer-linked'); assertNoWebsiteWrite();
  });

  test.each([false, true])('customer push sync reuses normalization (linked=%s)', async linked => {
    if (linked) customer.externalAccountingId = 'qb-customer-linked';
    await service.processPushCustomers('job-1', 'org-1');
    expect(customerPosts()).toHaveLength(1);
    expect(customerPosts()[0].body.WebAddr).toEqual({ URI: 'https://www.lloydwaters.com/' });
    if (linked) expect(customerPosts()[0].body).toMatchObject({ Id: 'qb-customer-linked', SyncToken: 'existing-token' });
    expect(customer.externalAccountingId).toBe(linked ? 'qb-customer-linked' : 'qb-customer-new');
    expect(customer.website).toBe('www.lloydwaters.com'); assertNoWebsiteWrite();
  });

  test('invalid optional website cannot block otherwise valid invoice sync', async () => {
    customer.website = 'https://user:secret@example.com';
    await syncInvoice();
    expect(customerPosts()[0].body).not.toHaveProperty('WebAddr');
    expect(invoicePosts()).toHaveLength(1);
    expect(console.warn).toHaveBeenCalledWith('[QuickBooks] Optional customer website omitted', expect.objectContaining({ code: 'QB_CUSTOMER_WEBSITE_OMITTED', customerId: 'customer-1' }));
    expect(JSON.stringify((console.warn as jest.Mock).mock.calls)).not.toContain('secret');
    expect(customer.website).toBe('https://user:secret@example.com'); assertNoWebsiteWrite();
  });

  test('unrelated QuickBooks errors are preserved after optional website omission', async () => {
    customer.website = 'not a website'; customerApiError = true;
    await expect(syncInvoice()).rejects.toThrow('Unrelated customer validation error');
    expect(invoicePosts()).toHaveLength(0);
    expect(customer.externalAccountingId).toBeNull();
  });

  test('repeated invoice sync reuses customer association and remote invoice identity', async () => {
    const first = await syncInvoice(); const second = await syncInvoice();
    expect(first).toEqual(second);
    expect(customerPosts().filter(request => !request.body.Id)).toHaveLength(1);
    expect(invoicePosts().filter(request => !request.body.Id)).toHaveLength(1);
    expect(invoicePosts()[1].body.Id).toBe('qb-invoice-new');
    expect(customer.externalAccountingId).toBe('qb-customer-new');
    expect(customer.website).toBe('www.lloydwaters.com'); assertNoWebsiteWrite();
  });

  test('individual customer identity ambiguity still requires review before creating anything', async () => {
    customer.customerType = 'individual';
    matchedCustomers = [{ Id: 'qb-other-person', DisplayName: 'Lloyd Waters', PrimaryEmailAddr: { Address: 'different@example.test' } }];
    await expect(syncInvoice()).rejects.toThrow('QUICKBOOKS_CUSTOMER_REVIEW_REQUIRED');
    expect(customerPosts()).toHaveLength(0); expect(invoicePosts()).toHaveLength(0);
    expect(customer.externalAccountingId).toBeNull();
  });
});
