export type AccountingApprovalState = 'approved' | 'needs_reapproval' | 'not_approved' | 'legacy_synced';

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

export function accountingApprovalRevocationPatch(invoice: Record<string, any>, now = new Date()) {
  if (getInvoiceAccountingApprovalState(invoice) !== 'approved') return {};
  return {
    accountingApprovedAt: null,
    accountingApprovedByUserId: null,
    accountingApprovalRevokedAt: now,
  };
}
