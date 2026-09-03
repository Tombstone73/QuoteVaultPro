import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@jest/globals';

const read = (relativePath: string) => fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');

test('QuickBooks payment export uses a semantic reference and preserves linked-invoice mapping', () => {
  const service = read('server/quickbooksService.ts');
  const schema = read('shared/schema.ts');
  const migration = read('server/db/migrations_v2/0194_quickbooks_payment_references.sql');

  expect(service).toContain('resolveQuickBooksPaymentReference({');
  expect(service).toContain("formatQuickBooksPaymentReference(referenceNumber)");
  expect(service).toContain("PaymentRefNum: paymentRefNum");
  expect(service).toContain("PrivateNote: privateNote");
  expect(service).toContain("LinkedTxn: [{ TxnId: qbInvoiceId, TxnType: 'Invoice' }]");
  expect(service).not.toContain('`QVP-${localPaymentId}`');
  expect(service).not.toContain('QVP payment ${localPaymentId}');
  expect(schema).toContain('quickbooksPaymentReference: varchar("quickbooks_payment_reference", { length: 21 })');
  expect(migration).toContain('quickbooks_payment_reference varchar(21)');
  expect(migration).toContain('payments_org_quickbooks_payment_reference_uidx');
});

test('invoice DocNumber remains canonical and is validated without renumbering imports', () => {
  const service = read('server/quickbooksService.ts');

  expect(service).toContain("String((invoice as any).displayNumber || invoice.invoiceNumber || '').trim()");
  expect(service).toContain("DocNumber: invoiceDisplayNumber");
  expect(service).toContain('assertQuickBooksDocumentNumber(\n    String((invoice as any).displayNumber || invoice.invoiceNumber || \'\').trim(),\n    \'QuickBooks invoice document number\'');
  expect(service).toContain('resolveHistoricalQuickBooksInvoiceNumber');
});
