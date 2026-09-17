import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@jest/globals';

const read = (relativePath: string) => fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');

test('terms and due date use the existing version/reapproval path beyond draft', () => {
  const route = read('server/routes/mvpInvoicing.routes.ts');
  expect(route).toContain('receivableEditableStatuses');
  expect(route).toContain('"draft", "billed", "finalized", "sent", "partially_paid"');
  expect(route).toContain('INVOICE_RECEIVABLE_FIELDS_LOCKED');
  expect(route).toContain('hasTermsChange ||');
  expect(route).toContain('accountingApprovalRevocationPatch(existing)');
  expect(route).toContain("financialUpdates.qbSyncStatus = \"needs_resync\"");
});

test('terms recompute from the durable first-approval start without changing that start', () => {
  const route = read('server/routes/mvpInvoicing.routes.ts');
  const approval = read('server/services/invoiceAccountingApproval.service.ts');
  expect(route).toContain('termsStartedAt: new Date(existing.termsStartedAt)');
  expect(route).toContain('calculateInvoiceDueDateFromTerms');
  expect(approval).toContain('termsStartedAt: now');
  expect(approval).toContain('startsTermsOnThisApproval');
});
