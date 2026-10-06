import { expect, jest, test } from '@jest/globals';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { and, eq } from 'drizzle-orm';
import { payments } from '../../shared/schema';

const code = readFileSync('server/quickbooksService.ts', 'utf8');
const ast = ts.createSourceFile('qb.ts', code, ts.ScriptTarget.Latest, true);
const fn = ast.statements.find(s => ts.isFunctionDeclaration(s) && s.name?.text === 'syncSinglePaymentToQuickBooksForOrganization')!;
const body = ts.transpile(fn.getText(ast).replace('export ', ''), { target: ts.ScriptTarget.ES2022 });
test.each(['pending', 'failed', 'canceled', 'requires_payment_method'])('canonical QB transmission rejects %s before any invoice or network work', async status => {
  const db = { select: jest.fn(() => ({ from: () => ({ where: () => ({ limit: async () => [{ id: 'p', status }] }) }) })) };
  const sync = new Function('db', 'payments', 'and', 'eq', `${body}; return syncSinglePaymentToQuickBooksForOrganization;`)(db, payments, and, eq);
  await expect(sync('org', 'p')).rejects.toThrow('Only succeeded or captured payments can be synced to QuickBooks');
  expect(db.select).toHaveBeenCalledTimes(1);
});
test('queued, forced and retry paths retain succeeded/captured guards', () => {
  const worker = readFileSync('server/services/quickbooksSyncQueueWorker.ts', 'utf8');
  expect(worker.match(/lower\(\$\{payments.status\}\) in \('succeeded',\s*'captured'\)/g)!.length).toBeGreaterThanOrEqual(3);
  expect(worker).toContain("['succeeded', 'captured'].includes(String(payment.status).toLowerCase())");
  expect(worker).not.toContain('stripePaymentAttempts');
});
