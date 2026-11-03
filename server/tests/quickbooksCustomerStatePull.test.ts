import { afterEach, beforeAll, beforeEach, expect, jest, test } from '@jest/globals';
import { getTableName } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';

// In-memory DB contract test: exercises the actual pull service, not PostgreSQL locks.
const dialect = new PgDialect();
let rows: any[] = []; let qbRows: any[] = []; let locked = false; let rowLocks = 0; let advisoryLocks = 0;
const writes: Array<{ table: string; patch: any }> = [];
const connection = { id: 'connection', organizationId: 'org-1', provider: 'quickbooks', companyId: 'test-realm', isActive: true, metadata: {} };
function select() {
  let table = ''; let params: unknown[] = [];
  const query: any = {
    from: (value: any) => { table = getTableName(value); return query; },
    where: (condition: any) => { params = dialect.sqlToQuery(condition).params; return query; },
    limit: () => query, orderBy: () => query,
    for: (mode: string) => { expect(locked).toBe(true); expect(mode).toBe('update'); rowLocks++; return query; },
    then: (resolve: any, reject: any) => {
      const found = table === 'oauth_connections' ? [connection] : table === 'customers'
        ? rows.filter(row => row.organizationId === params[0] && (row.externalAccountingId === params[1] || (params.length > 2 && row.email && row.email === params[3]))) : [];
      return Promise.resolve(found).then(resolve, reject);
    },
  };
  return query;
}
const database: any = {
  select,
  execute: async (statement: any) => { expect(locked).toBe(true); expect(dialect.sqlToQuery(statement).sql).toContain('pg_advisory_xact_lock'); advisoryLocks++; },
  update: (table: any) => ({ set: (patch: any) => ({ where: async (condition: any) => {
    const name = getTableName(table); writes.push({ table: name, patch: structuredClone(patch) });
    if (name === 'customers') {
      expect(locked).toBe(true);
      const params = dialect.sqlToQuery(condition).params;
      expect(params).toHaveLength(2); expect(params[1]).toBe('org-1');
      Object.assign(rows.find(row => row.id === params[0] && row.organizationId === params[1]), patch);
    }
  } }) }),
  insert: (table: any) => ({ values: (patch: any) => ({ returning: async () => {
    expect(getTableName(table)).toBe('customers'); expect(locked).toBe(true);
    const row = { ...structuredClone(patch), id: `customer-${rows.length + 1}` }; rows.push(row);
    return [{ id: row.id }];
  } }) }),
  transaction: async (work: any) => { const saved = structuredClone(rows); locked = true; try { return await work(database); } catch (error) { rows = saved; throw error; } finally { locked = false; } },
};
jest.unstable_mockModule('../db', () => ({ db: database, pool: {} }));
let service: typeof import('../quickbooksService'); let credentials: typeof import('../services/quickbooksCredentialManager');
beforeAll(async () => { credentials = await import('../services/quickbooksCredentialManager'); service = await import('../quickbooksService'); });
const originalFetch = global.fetch;
const envKeys = ['QUICKBOOKS_CLIENT_ID', 'QUICKBOOKS_CLIENT_SECRET', 'QUICKBOOKS_REDIRECT_URI', 'QUICKBOOKS_ENVIRONMENT'] as const;
const savedEnv = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));
beforeEach(() => {
  rows = []; writes.length = 0; rowLocks = 0; advisoryLocks = 0;
  qbRows = [{ Id: 'qb-1', DisplayName: 'Synthetic Customer', BillAddr: { Line1: '1 Test Street', City: 'Toronto', CountrySubDivisionCode: 'ON', PostalCode: 'M5V 1A1', Country: 'CA' }, ShipAddr: { Line1: '2 QA Street', City: 'Test City', CountrySubDivisionCode: 'IN', PostalCode: '46201', Country: 'US' } }];
  process.env.QUICKBOOKS_CLIENT_ID = 'synthetic'; process.env.QUICKBOOKS_CLIENT_SECRET = 'synthetic';
  process.env.QUICKBOOKS_REDIRECT_URI = 'https://example.test/callback'; process.env.QUICKBOOKS_ENVIRONMENT = 'sandbox';
  jest.spyOn(console, 'log').mockImplementation(() => {}); jest.spyOn(console, 'info').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {}); jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(credentials.quickBooksCredentialManager, 'getValidAccessToken').mockResolvedValue('synthetic-token');
  jest.spyOn(credentials.quickBooksCredentialManager, 'loadCredentials').mockResolvedValue(connection as any);
  jest.spyOn(credentials.quickBooksCredentialManager, 'recordSuccessfulRequest').mockResolvedValue(undefined);
  global.fetch = jest.fn(async (_input: any, init: any) => {
    expect(locked).toBe(false); expect(init.method).toBe('GET');
    return new Response(JSON.stringify({ QueryResponse: { Customer: qbRows } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
});
afterEach(() => {
  global.fetch = originalFetch; jest.restoreAllMocks();
  for (const key of envKeys) { if (savedEnv[key] === undefined) delete process.env[key]; else process.env[key] = savedEnv[key]; }
});
async function pull() {
  await service.processPullCustomers('job-1', 'org-1');
  expect(writes.filter(write => write.table === 'accounting_sync_jobs').at(-1)?.patch.payloadJson.errorCount).toBe(0);
}
test('actual pull persists both states and repeat imports update the same customer without new rows', async () => {
  await pull(); await pull();
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ organizationId: 'org-1', externalAccountingId: 'qb-1', billingState: 'ON', shippingState: 'IN', billingStreet1: '1 Test Street', shippingStreet1: '2 QA Street' });
  expect(rowLocks).toBe(2); expect(advisoryLocks).toBe(2);
});
test('actual pull preserves local state when the next provider payload omits addresses', async () => {
  await pull(); qbRows = [{ Id: 'qb-1', DisplayName: 'Synthetic Customer' }]; await pull();
  expect(rows[0]).toMatchObject({ billingState: 'ON', shippingState: 'IN', billingCity: 'Toronto' });
});
test('actual pull preserves staff corrections and explicit overrides', async () => {
  await pull(); rows[0].billingState = 'QC'; rows[0].shippingState = null; rows[0].qbFieldOverrides = { shippingAddress: true };
  await pull(); expect(rows[0]).toMatchObject({ billingState: 'QC', shippingState: null });
});
test('same linked ID in another tenant cannot be updated by this tenant pull', async () => {
  const foreign = { id: 'foreign', organizationId: 'org-2', externalAccountingId: 'qb-1', billingState: 'BC' };
  rows.push(foreign); await pull();
  expect(rows).toHaveLength(2); expect(rows[0]).toEqual(foreign);
  expect(rows[1]).toMatchObject({ organizationId: 'org-1', billingState: 'ON' });
});
