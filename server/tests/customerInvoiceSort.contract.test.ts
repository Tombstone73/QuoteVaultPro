import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@jest/globals';

const invoiceService = fs.readFileSync(path.join(process.cwd(), 'server/invoicesService.ts'), 'utf8');

test('Customer Detail invoice sort fields remain explicitly allowlisted and server-composed', () => {
  expect(invoiceService).toContain("case 'lastSentAt':");
  expect(invoiceService).toContain("case 'approval':");
  expect(invoiceService).toContain("case 'jobStatus':");
  expect(invoiceService).toContain("case 'balance':");
  expect(invoiceService).toContain("when ${invoices.accountingApprovedAt} is not null");
  expect(invoiceService).toContain("when ${invoices.orderId} is null then 'no linked order'");
  expect(invoiceService).toContain("return 'issueDate';");
});
