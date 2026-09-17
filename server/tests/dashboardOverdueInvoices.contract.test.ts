import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from '@jest/globals';

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), 'utf8');

describe('dashboard overdue invoice financial convergence', () => {
  test('derives dashboard count and amount from one Accounts Receivable projection', () => {
    const dashboard = read('server/services/dashboardSummaryService.ts');
    expect(dashboard).toContain('getAccountsReceivableReport({ organizationId, now })');
    expect(dashboard).toContain('summary.overdueInvoiceCount');
    expect(dashboard).toContain('summary.overdueOutstandingCents');
    expect(dashboard).not.toContain('not(inArray(invoices.status, ["paid", "void"]))');
  });

  test('supports a canonical overdue-only A/R detail filter instead of a workflow-status approximation', () => {
    const report = read('server/services/accountsReceivableReport.ts');
    const route = read('server/routes/accountsReceivableReport.routes.ts');
    expect(report).toContain('overdueOnly?: boolean');
    expect(report).toContain('isAccountsReceivableRowOverdue(row)');
    expect(route).toContain("overdueOnly: String(req.query.overdue || '').toLowerCase() === 'true'");
  });
});
