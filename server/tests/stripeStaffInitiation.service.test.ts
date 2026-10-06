import { beforeEach, expect, jest, test } from '@jest/globals';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { and, desc, eq, getTableName, ne } from 'drizzle-orm';
import { auditLogs, payments } from '../../shared/schema';

// Execute the actual route callback with isolated boundary dependencies. This
// avoids starting unrelated email workers or importing the full HTTP server.
const source = ts.createSourceFile('routes.ts', readFileSync('server/routes/mvpInvoicing.routes.ts', 'utf8'), ts.ScriptTarget.Latest, true);
let callback = '';
function visit(n: ts.Node) {
  if (ts.isCallExpression(n) && n.arguments.length && ts.isStringLiteral(n.arguments[0]) && n.arguments[0].text === '/api/invoices/:id/payments/stripe/create-intent') callback = n.arguments[n.arguments.length - 1].getText(source);
  ts.forEachChild(n, visit);
}
visit(source);
if (!callback) throw new Error('Staff create-intent route callback not found');
let attempts: any[] = [], writes: string[] = [];
const db: any = {
  select: () => { let rows: any[] = []; const q: any = { from: (table: any) => { rows = getTableName(table) === 'stripe_payment_attempts' ? attempts : []; return q; }, where: () => q,
    orderBy: () => q, limit: async () => rows, then: (ok: any) => Promise.resolve(rows).then(ok) }; return q; },
  insert: (table: any) => ({ values: (v: any) => { const name = getTableName(table); writes.push(name); if (name === 'stripe_payment_attempts') attempts.push(v);
    const q: any = { returning: async () => [v], onConflictDoNothing: () => q, then: (ok: any) => Promise.resolve([v]).then(ok) }; return q; } }),
  update: () => ({ set: (v: any) => ({ where: async () => attempts.forEach(a => Object.assign(a, v)) }) }),
};
jest.unstable_mockModule('../db', () => ({ db }));
const attemptService = await import('../services/stripePaymentAttempt.service');
const create = jest.fn<any>(), retrieve = jest.fn<any>(), reconcile = jest.fn<any>();
const invoice = { id: 'invoice', organizationId: 'org', status: 'billed', totalCents: 25000, invoiceNumber: 123, currency: 'USD' };
const deps = { db, payments, auditLogs, and, desc, eq, ne, ...attemptService,
  getRequestOrganizationId: () => 'org', withInvoicePaymentContext: async (_o: any, _i: any, fn: any) => fn(),
  resolveStripeRuntimeConfig: async () => ({ ok: true, data: { connectedAccountId: 'acct' } }), getUserId: () => 'user',
  getInvoiceWithRelations: async () => ({ invoice }), getImportedQuickBooksPaymentBlockReason: () => null,
  withNormalizedInvoiceDisplay: () => ({ displayRemainingCents: 25000 }), getInvoiceFinancialPaymentEligibility: () => ({ payable: true }),
  getStripeClient: () => ({ paymentIntents: { create, retrieve } }), isImportedQuickBooksInvoice: () => false,
  captureAndApplyStripeObservation: reconcile, logStripeCreateIntentDebug: () => {},
};
const js = ts.transpile(`const handler = ${callback};`, { target: ts.ScriptTarget.ES2022 });
const handler = new Function(...Object.keys(deps), `${js}\nreturn handler;`)(...Object.values(deps));
beforeEach(() => {
  attempts = []; writes = [];
  create.mockReset().mockImplementation(async (input: any) => ({ ...input, id: 'pi', client_secret: 'fixture', status: 'requires_payment_method', amount_received: 0 }));
  retrieve.mockReset(); reconcile.mockReset();
});
test('opening staff checkout inserts only a durable attempt, and reopening retrieves the same intent', async () => {
  const res: any = { status: jest.fn().mockReturnThis(), json: jest.fn() };
  await handler({ params: { id: 'invoice' }, user: {} }, res);
  expect(res.json).toHaveBeenCalledWith({ success: true, data: { clientSecret: 'fixture', stripeAccountId: 'acct', paymentId: null, paymentAttemptId: attempts[0].id } });
  expect(writes).not.toContain('payments'); expect(reconcile).not.toHaveBeenCalled();
  retrieve.mockResolvedValue(await create.mock.results[0].value);
  await handler({ params: { id: 'invoice' }, user: {} }, res);
  expect(create).toHaveBeenCalledTimes(1); expect(retrieve).toHaveBeenCalledWith('pi', { stripeAccount: 'acct' }); expect(attempts).toHaveLength(1);
  expect(writes).not.toContain('payments');
});
test('a declined attempt is reused instead of issuing another collectible intent', async () => {
  const res: any = { status: jest.fn().mockReturnThis(), json: jest.fn() };
  await handler({ params: { id: 'invoice' }, user: {} }, res);
  attempts[0].status = 'failed'; retrieve.mockResolvedValue(await create.mock.results[0].value);
  await handler({ params: { id: 'invoice' }, user: {} }, res);
  expect(create).toHaveBeenCalledTimes(1); expect(writes).not.toContain('payments');
});
test('a lost response older than the idempotency window fails closed', async () => {
  attempts.push({ id: 'old', organizationId: 'org', invoiceId: 'invoice', status: 'reserved', createdAt: new Date(Date.now() - 25 * 3600000), stripePaymentIntentId: null });
  await expect(attemptService.reserveStripePaymentAttempt({ organizationId: 'org', invoiceId: 'invoice', channel: 'staff', amountCents: 25000, currency: 'USD', stripeAccountId: 'acct' }))
    .rejects.toMatchObject({ code: 'STRIPE_RESERVATION_REVIEW_REQUIRED' });
  expect(create).not.toHaveBeenCalled(); expect(writes).toEqual([]);
});

test('multiple unresolved attempts fail closed instead of picking one collectible intent', async () => {
  attempts.push({ id: 'a' }, { id: 'b' });
  await expect(attemptService.reserveStripePaymentAttempt({ organizationId: 'org', invoiceId: 'invoice', channel: 'staff', amountCents: 25000, currency: 'USD', stripeAccountId: 'acct' }))
    .rejects.toMatchObject({ code: 'STRIPE_ATTEMPT_REVIEW_REQUIRED' });
  expect(create).not.toHaveBeenCalled(); expect(writes).toEqual([]);
});
