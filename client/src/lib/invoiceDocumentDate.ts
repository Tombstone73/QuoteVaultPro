import { hasEstablishedInvoiceDate, hasFirstApprovalInvoiceDateAnchor } from '@shared/invoicePaymentTerms';

/** Format the persisted Invoice Date; legacy dates keep each screen's existing
 * formatter, while first-approval business dates are read as UTC calendar days. */
export function formatInvoiceDocumentDate(
  invoice: Record<string, unknown>,
  formatLegacy: (value: Date | string | null) => string,
  style: 'short' | 'numeric' = 'short',
): string {
  if (!hasEstablishedInvoiceDate(invoice)) return 'Pending approval';
  const value = invoice.issueDate as Date | string | null;
  if (!hasFirstApprovalInvoiceDateAnchor(invoice)) return formatLegacy(value);
  const date = value instanceof Date ? value : new Date(String(value));
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC', year: 'numeric', month: style, day: 'numeric',
  }).format(date);
}

export function formatInvoiceDueDate(
  invoice: Record<string, unknown>,
  formatLegacy: (value: Date | string | null) => string,
  style: 'short' | 'numeric' = 'short',
): string {
  const value = invoice.dueDate as Date | string | null;
  if (!value || !hasFirstApprovalInvoiceDateAnchor(invoice)) return formatLegacy(value);
  const date = value instanceof Date ? value : new Date(String(value));
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC', year: 'numeric', month: style, day: 'numeric',
  }).format(date);
}

export function invoiceDueDateInputValue(invoice: Record<string, unknown>): string {
  const value = invoice.dueDate as Date | string | null;
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) return '';
  if (hasFirstApprovalInvoiceDateAnchor(invoice)) return date.toISOString().slice(0, 10);
  const localYear = date.getFullYear();
  const localMonth = String(date.getMonth() + 1).padStart(2, '0');
  const localDay = String(date.getDate()).padStart(2, '0');
  return `${localYear}-${localMonth}-${localDay}`;
}
