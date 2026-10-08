import { formatInvoiceDocumentDate, formatInvoiceDueDate, invoiceDueDateInputValue } from './invoiceDocumentDate';
import { hasEstablishedInvoiceDate } from '@shared/invoicePaymentTerms';

const legacy = (value: Date | string | null) => value ? new Date(value).toISOString().slice(0, 10) : '—';

test('native draft date remains provisional until first approval', () => {
  const draft = { issueDate: '2026-10-05T15:00:00.000Z', issuedAt: '2026-10-05T15:00:00.000Z', accountingApprovedAt: null };
  expect(hasEstablishedInvoiceDate(draft)).toBe(false);
  expect(formatInvoiceDocumentDate(draft, legacy)).toBe('Pending approval');
});

test('first approval shows the organization business date and Net 30 due date', () => {
  const approved = {
    issueDate: '2026-10-08T12:00:00.000Z', issuedAt: '2026-10-08T12:00:00.000Z',
    dueDate: '2026-11-07T12:00:00.000Z', accountingApprovedAt: '2026-10-09T03:30:00.000Z',
    termsStartedAt: '2026-10-09T03:30:00.000Z',
  };
  expect(formatInvoiceDocumentDate(approved, legacy)).toBe('Oct 8, 2026');
  expect(formatInvoiceDueDate(approved, legacy)).toBe('Nov 7, 2026');
  expect(invoiceDueDateInputValue(approved)).toBe('2026-11-07');
});

test('revocation retains the first Invoice Date; historical source dates retain legacy formatting', () => {
  const revoked = {
    issueDate: '2026-10-08T12:00:00.000Z', issuedAt: '2026-10-08T12:00:00.000Z',
    accountingApprovedAt: null, accountingApprovalRevokedAt: '2026-10-10T15:00:00.000Z',
  };
  expect(formatInvoiceDocumentDate(revoked, legacy)).toBe('Oct 8, 2026');
  const imported = { issueDate: '2020-01-04T01:00:00.000Z', importSource: 'quickbooks' };
  expect(formatInvoiceDocumentDate(imported, legacy)).toBe('2020-01-04');
});
