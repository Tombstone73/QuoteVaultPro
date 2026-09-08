import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@jest/globals';

const table = fs.readFileSync(path.join(process.cwd(), 'client/src/components/customers/tables/CustomerOrdersTable.tsx'), 'utf8');
const overrideDialog = fs.readFileSync(path.join(process.cwd(), 'client/src/components/orders/CloseJobOverrideDialog.tsx'), 'utf8');

test('Customer Detail Orders keeps status visible and exposes Close Job Override directly', () => {
  expect(table).toContain('case "status"');
  expect(table).toContain('View Order');
  expect(table).toContain('Close Job Override');
  expect(table).toContain('canCloseJobOverride');
  expect(table).toContain('CloseJobOverrideDialog');
  expect(table).not.toContain('DropdownMenu');
});

test('all surfaces share one authoritative Close Job Override client operation', () => {
  expect(overrideDialog).toContain('complete-production');
  expect(overrideDialog).toContain('reconcile-historical-fulfillment');
  expect(overrideDialog).toContain('sourceInvoiceId: target.invoiceId || undefined');
  expect(overrideDialog).toContain('Remaining production');
  expect(overrideDialog).toContain('Remaining fulfillment');
  expect(overrideDialog).toContain('invoice and payment status will not be changed');
  expect(overrideDialog).toContain('canCloseJobOverride');
});
