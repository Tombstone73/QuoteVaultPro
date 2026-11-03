export const GMAIL_MODIFY_SCOPE = 'https://www.googleapis.com/auth/gmail.modify';
export function hasGmailModifyScope(value: unknown): boolean {
  const scopes = Array.isArray(value) ? value : typeof value === 'string' ? value.split(/\s+/) : [];
  return scopes.includes(GMAIL_MODIFY_SCOPE) || scopes.includes('https://mail.google.com/');
}
export const GMAIL_ACK_LEASE_MS = 5 * 60_000;
export const GMAIL_ACK_MAX_ATTEMPTS = 3;
export const gmailAcknowledgementLabels = {
  waiting: 'Order entered; Gmail update pending', processing: 'Updating Gmail for entered Order',
  retrying: 'Order entered; Gmail retry scheduled', reconnect_required: 'Reconnect required',
  failed: 'Order entered; Gmail update failed', needs_attention: 'Gmail update needs staff attention',
  succeeded: 'Order entered; Gmail updated',
};
export type GmailAcknowledgementStatus = keyof typeof gmailAcknowledgementLabels;
export type GmailAcknowledgementView = {
  id: string; inboundRecordId: string; orderId: string; mailboxId: string;
  orderNumber?: string | null;
  status: GmailAcknowledgementStatus; attempts: number; message: string | null; canRetry: boolean;
};
export type GmailAcknowledgementRollout = {
  enabled: boolean; organizationId: string; reason: 'global_pause' | 'worker_pause' | 'tenant_not_enrolled' | null; message: string;
};
export type GmailAcknowledgementMailboxSummary = {
  mailboxId: string; pendingCount: number; failedCount: number; lastSucceededAt: string | null;
  lastError: string | null;
};
export type GmailAcknowledgementOverview = { rollout: GmailAcknowledgementRollout; mailboxes: GmailAcknowledgementMailboxSummary[] };

export function gmailAcknowledgementErrorMessage(code: string | null): string | null {
  if (!code) return null;
  if (['MODIFY_PERMISSION_REQUIRED', 'GMAIL_RECONNECT_REQUIRED', 'REFRESH_CREDENTIAL_UNAVAILABLE'].includes(code)) return 'Reconnect this same Gmail account with modify permission, then retry its retained Gmail update.';
  if (['AMBIGUOUS_SOURCE_ACCOUNT', 'LEGACY_SOURCE_MANIFEST_UNTRACKED'].includes(code)) return 'Source message coverage or mailbox ownership is ambiguous. Staff must reconcile it before Gmail writes; automatic retry is blocked.';
  if (['MAILBOX_ACCOUNT_CHANGED', 'PROVIDER_ACCOUNT_MISMATCH'].includes(code)) return 'The connected Gmail account differs from the reviewed source. Restore the correct account before retrying.';
  if (code === 'ORDER_LINKAGE_UNCONFIRMED') return 'The original tenant-scoped Order linkage could not be confirmed. Review that linkage before retrying; Gmail messages were not changed.';
  if (code === 'ENTERED_LABEL_UNAVAILABLE') return 'The Entered label could not be resolved. Check Gmail label access, then retry.';
  return 'The Gmail update did not finish. Check the mailbox connection and retry the retained update. The existing Order is unchanged.';
}
