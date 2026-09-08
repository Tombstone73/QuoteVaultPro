import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@jest/globals';

const source = fs.readFileSync(path.join(process.cwd(), 'client/src/features/customers/EnhancedCustomerView.tsx'), 'utf8');
const invoiceTable = source.slice(source.indexOf('function InvoicesTable('), source.indexOf('// StatementTab'));
const ordersStart = source.indexOf('function OrdersTable(');
const ordersTable = source.slice(ordersStart, source.indexOf('function QuotesTable(', ordersStart));

test('the actual Customer Detail invoice table renders the operational invoice fields and shared direct actions', () => {
  for (const label of [
    'Invoice #', 'Job / Order', 'PO #', 'Order #', 'Invoice Date', 'Last Sent', 'Due Date',
    'Approval', 'Job Status', 'Total', 'Balance', 'Invoice Status', 'Actions',
  ]) expect(source).toContain(label);
  expect(invoiceTable).toContain('InvoiceSendQuickAction');
  expect(invoiceTable).toContain('CloseJobOverrideDialog');
  expect(invoiceTable).toContain('getOrderJobStatus(inv)');
  expect(invoiceTable).toContain('Close Job Override');
  expect(invoiceTable).not.toContain('DropdownMenu');
});

test('the rendered Customer Detail invoice table owns its persistent layout and server-backed sort state', () => {
  expect(invoiceTable).toContain('useInvoicesPage');
  expect(invoiceTable).toContain('customer_detail_invoices');
  expect(invoiceTable).toContain('customerInvoiceSortApiField');
  expect(invoiceTable).toContain('persistCustomerInvoiceTableSortPreference');
  expect(invoiceTable).toContain('Reset to default');
  expect(invoiceTable).toContain('Configure Invoice Columns');
  expect(invoiceTable).toContain('sticky right-0');
  expect(invoiceTable).toContain('pageSize');
});

test('the actual Customer Detail orders table uses the same visible Close Job Override action', () => {
  expect(ordersTable).toContain('CloseJobOverrideDialog');
  expect(ordersTable).toContain('canCloseJobOverride');
  expect(ordersTable).toContain('View Order');
  expect(ordersTable).toContain('Traveler');
  expect(ordersTable).not.toContain('DropdownMenu');
});
