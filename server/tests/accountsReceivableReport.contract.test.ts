import { readFileSync } from 'node:fs';

const source = (file: string) => readFileSync(file, 'utf8');

describe('Accounts Receivable report contract', () => {
  test('uses canonical approval, canonical payment display, and tenant-scoped customer projection', () => {
    const service = source('server/services/accountsReceivableReport.ts');
    expect(service).toContain('getInvoiceAccountingApprovalState(invoice as any)');
    expect(service).toContain('qualifiesForAccountsReceivable');
    expect(service).toContain('normalizeInvoiceAccountingDisplay');
    expect(source('shared/accountsReceivableReport.ts')).toContain("input.accountingApproval !== 'approved'");
    expect(source('shared/accountsReceivableReport.ts')).toContain("input.displayStatus !== 'Paid Historical'");
    expect(service).toContain('canonicalInvoiceCustomerId');
    expect(service).toContain('eq(invoices.organizationId, input.organizationId)');
  });

  test('keeps send state informational while exports share the full filtered report result', () => {
    const route = source('server/routes/accountsReceivableReport.routes.ts');
    expect(route).toContain('getAccountsReceivableReport');
    expect(route).toContain('report.rows.map(reportRow)');
    expect(route).toContain('buildSimpleXlsx');
    expect(route).toContain('sendStatus');
  });

  test('adds a standard Reports shortcut and the direct report route', () => {
    expect(source('client/src/pages/reports.tsx')).toContain('Open Accounts Receivable');
    expect(source('client/src/App.tsx')).toContain('ROUTES.accountsReceivableReport');
  });
});
