/** Source IDs only: never fetch or expand a live Gmail thread at acknowledgement time. */
export type InboundMessageManifest = { mailboxId: string; providerAccount: string; messageIds: string[] };
export function inboundEmailMessageManifest(record: { sourceType?: string; sourceMessageId?: string | null; rawPayloadJson?: unknown }): InboundMessageManifest | null {
  const raw = record.rawPayloadJson as any;
  if (record.sourceType !== 'email' || raw?.provider !== 'gmail' || typeof raw?.mailbox?.id !== 'string'
    || typeof raw.mailbox.emailAddress !== 'string') return null;
  const messages = raw.thread?.messages;
  const ids = [record.sourceMessageId, raw.messageId, ...(Array.isArray(messages) ? messages.map(m => m?.messageId ?? m?.id) : [])];
  const messageIds = [...new Set(ids.filter((id): id is string => typeof id === 'string' && id.trim().length > 0))].sort();
  if (!messageIds.length) return null;
  return { mailboxId: raw.mailbox.id, providerAccount: raw.mailbox.emailAddress.trim().toLowerCase(), messageIds };
}
