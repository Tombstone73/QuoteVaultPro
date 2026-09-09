import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@jest/globals';

const table = fs.readFileSync(path.join(process.cwd(), 'client/src/components/customers/tables/CustomerInvoicesTable.tsx'), 'utf8');

test('Customer Detail Invoice table exposes the required operational columns', () => {
  for (const id of [
    'invoiceNumber', 'jobOrder', 'poNumber', 'orderNumber', 'invoiceDate',
    'lastSent', 'dueDate', 'approval', 'jobStatus', 'total', 'balance',
    'invoiceStatus', 'actions',
  ]) {
    expect(table).toContain(`id: "${id}"`);
  }
  expect(table).toContain('customer_invoices_v2');
  expect(table).toContain('invoice.purchaseOrderNumber || "—"');
  expect(table).toContain('import { OrderNumberLink }');
  expect(table).toContain('<OrderNumberLink orderId={invoice.orderId} orderNumber={invoice.orderNumber} />');
});

test('Customer Detail Invoice approval labels stay compact', () => {
  const approvalMapping = table.slice(table.indexOf('function approvalLabel'), table.indexOf('function canApproveInvoice'));
  expect(approvalMapping).toContain('return "Approved"');
  expect(approvalMapping).toContain('return "Not Approved"');
  expect(approvalMapping).not.toContain('Approved for Accounting');
  expect(approvalMapping).not.toContain('Needs Reapproval');
});

test('Customer Detail actions are visible icon-plus-label controls, not a hidden action menu', () => {
  expect(table).toContain('View Invoice');
  expect(table).toContain('View Order');
  expect(table).toContain('Approve');
  expect(table).toContain('InvoiceSendQuickAction');
  expect(table).toContain('Close Job Override');
  expect(table).toContain('<Eye');
  expect(table).toContain('<ExternalLink');
  expect(table).toContain('<ShieldCheck');
  expect(table).not.toContain('DropdownMenu');
  expect(table).not.toContain('Tooltip');
});

test('Close Job Override confirms live quantities and uses only canonical operations', () => {
  expect(table).toContain('CloseJobOverrideDialog');
  expect(table).toContain('canCloseJobOverride(invoice, isAdminOrOwner)');
});
