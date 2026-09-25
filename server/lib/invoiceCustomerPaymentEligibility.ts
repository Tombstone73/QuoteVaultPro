import { getInvoiceFinancialPaymentEligibility } from '../../shared/paymentOrchestration';
import { isInvoiceApprovedForAccounting } from './invoiceAccountingApproval';

export type CustomerPaymentInvoice = {
  status: string | null;
  invoiceVersion?: number | null;
  accountingApprovedVersion?: number | null;
  accountingApprovedAt?: Date | string | null;
  accountingApprovalRevokedAt?: Date | string | null;
  qbSyncStatus?: string | null;
  qbInvoiceId?: string | null;
  externalAccountingId?: string | null;
  lastQbSyncedVersion?: number | null;
  importSource?: string | null;
  isHistorical?: boolean | null;
};

/** Customer checkout adds approval to the existing financial rules. Staff
 * collection deliberately continues to use the financial rules alone. */
export function getInvoiceCustomerPaymentEligibility(invoice: CustomerPaymentInvoice, remainingCents: number) {
  const financial = getInvoiceFinancialPaymentEligibility({ invoiceStatus: invoice.status, remainingCents });
  if (!financial.payable) return financial;
  if (invoice.isHistorical || invoice.importSource?.trim().toLowerCase() === 'quickbooks') {
    return { payable: false, blockedReason: 'Payment is not available online for this invoice.' };
  }
  if (!isInvoiceApprovedForAccounting(invoice)) return { payable: false, blockedReason: 'Awaiting approval' };
  return financial;
}
