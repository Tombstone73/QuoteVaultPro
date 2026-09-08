import { expect, test } from '@jest/globals';
import { readFileSync } from 'node:fs';

const read = (file: string) => readFileSync(file, 'utf8');

test('canonical invoice sending requires approval unless an explicit override is carried through direct and bulk delivery', () => {
  const route = read('server/routes/mvpInvoicing.routes.ts');
  const queue = read('server/services/invoiceBulkEmailQueue.service.ts');
  const lifecycle = read('server/services/invoiceSendLifecycleAutomation.ts');

  expect(route).toContain('isInvoiceApprovedForAccounting(inv)');
  expect(route).toContain('code: "INVOICE_APPROVAL_REQUIRED"');
  expect(route).toContain('allowUnapproved: allowUnapproved === true');
  expect(route).toContain('unapprovedCount');
  expect(route).toContain('requiresUnapprovedOverride');
  expect(queue).toContain('allowUnapproved: Boolean(candidate.allowUnapproved)');
  expect(queue).toContain('allowUnapproved: job.metadata?.allowUnapproved === true');
  expect(lifecycle).toContain('!input.suppressAutomaticAccountingApproval');
});

test('all direct invoice send entry points share the confirmation-capable dialog', () => {
  const dialog = read('client/src/components/invoices/InvoiceEmailSendDialog.tsx');
  const invoiceList = read('client/src/pages/invoices.tsx');
  const invoiceDetail = read('client/src/pages/invoice-detail.tsx');
  const customerDetail = read('client/src/features/customers/EnhancedCustomerView.tsx');

  expect(dialog).toContain('Send Unapproved Invoice?');
  expect(dialog).toContain('Send Anyway');
  expect(dialog).toContain('INVOICE_APPROVAL_REQUIRED');
  expect(invoiceList).toContain('InvoiceEmailSendDialog');
  expect(invoiceDetail).toContain('InvoiceEmailSendDialog');
  expect(customerDetail).toContain('InvoiceSendQuickAction');
});
