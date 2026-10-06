import { isInvoiceApprovedForAccounting } from './invoiceAccountingApproval';
import { resolveHistoricalArState } from '@shared/historicalArAuthority';

type ReleaseInvoice = Record<string, any>;
const visibleStatuses = new Set(['draft', 'finalized', 'billed', 'sent', 'partially_paid', 'credit', 'overdue', 'paid', 'void', 'open']);

/** Release grants customer access, never accounting approval. Historical
 * imports retain their existing read-only visibility without a backfill. */
export function isInvoiceCustomerVisible(invoice: ReleaseInvoice): boolean {
  if (resolveHistoricalArState(invoice) === 'historical_review_required') return false;
  const status = String(invoice.status || '').toLowerCase();
  if (!visibleStatuses.has(status)) return false;
  if (invoice.customerReleasedAt || isInvoiceApprovedForAccounting(invoice)) return true;
  return status !== 'draft' && status !== 'finalized'
    && Boolean(resolveHistoricalArState(invoice));
}

export function getInvoiceCustomerReleaseEligibility(invoice: ReleaseInvoice) {
  if (invoice.customerReleasedAt) return { eligible: false, reason: 'Already released to customer.' };
  if (resolveHistoricalArState(invoice)) {
    return { eligible: false, reason: 'Imported invoices retain their existing customer visibility.' };
  }
  if (!invoice.customerId && !invoice.contactId) return { eligible: false, reason: 'Invoice has no billing owner.' };
  if (!visibleStatuses.has(String(invoice.status || '').toLowerCase()) || String(invoice.status).toLowerCase() === 'void') {
    return { eligible: false, reason: 'This invoice cannot be released to a customer.' };
  }
  return { eligible: true, reason: null };
}

export function getInvoiceCustomerReleaseDisplay(invoice: ReleaseInvoice) {
  return {
    customerVisible: isInvoiceCustomerVisible(invoice),
    customerReleaseEligible: getInvoiceCustomerReleaseEligibility(invoice).eligible,
  };
}
