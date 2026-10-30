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
  status: GmailAcknowledgementStatus; attempts: number; message: string | null; canRetry: boolean;
};
