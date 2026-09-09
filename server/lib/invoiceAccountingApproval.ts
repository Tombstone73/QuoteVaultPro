export type AccountingApprovalState = 'approved' | 'needs_reapproval' | 'not_approved' | 'legacy_synced';
export type InvoiceQuickBooksApprovalEligibility = {
  eligible: boolean;
  code?: 'INVOICE_NOT_APPROVED';
  reason?: string;
};

export function getInvoiceAccountingApprovalState(invoice: Record<string, any>): AccountingApprovalState {
  const version = Number(invoice.invoiceVersion || 1);
  const approvedVersion = Number(invoice.accountingApprovedVersion || 0);
  if (invoice.accountingApprovedAt && !invoice.accountingApprovalRevokedAt && approvedVersion === version) return 'approved';
  if (invoice.accountingApprovalRevokedAt || (invoice.accountingApprovedAt && approvedVersion !== version)) return 'needs_reapproval';
  if (!invoice.accountingApprovedAt
    && String(invoice.qbSyncStatus || '').toLowerCase() === 'synced'
    && String(invoice.qbInvoiceId || invoice.externalAccountingId || '').trim()
    && Number(invoice.lastQbSyncedVersion || 0) === version) return 'legacy_synced';
  return 'not_approved';
}

export function isInvoiceApprovedForAccounting(invoice: Record<string, any>): boolean {
  const state = getInvoiceAccountingApprovalState(invoice);
  return state === 'approved' || state === 'legacy_synced';
}

/**
 * The shared human approval gate for all initial QuickBooks work. Existing
 * provider/customer/amount validation remains in the canonical sync path;
 * this adds the required accounting-review decision without treating send
 * state as approval.
 */
export function getInvoiceQuickBooksApprovalEligibility(invoice: Record<string, any>): InvoiceQuickBooksApprovalEligibility {
  if (isInvoiceApprovedForAccounting(invoice)) return { eligible: true };
  return {
    eligible: false,
    code: 'INVOICE_NOT_APPROVED',
    reason: 'Approve invoice for accounting before syncing.',
  };
}

export function accountingApprovalRevocationPatch(invoice: Record<string, any>, now = new Date()) {
  if (getInvoiceAccountingApprovalState(invoice) !== 'approved') return {};
  return {
    accountingApprovedAt: null,
    accountingApprovedByUserId: null,
    accountingApprovalRevokedAt: now,
    // A material change cancels only local, unprocessed initial work. It
    // never alters a provider mapping or historical synced invoice.
    ...(String(invoice.qbSyncStatus || '').toLowerCase() === 'pending'
      ? { qbSyncStatus: 'not_synced', qbLastError: null, syncStatus: 'pending', syncError: null }
      : {}),
  };
}
