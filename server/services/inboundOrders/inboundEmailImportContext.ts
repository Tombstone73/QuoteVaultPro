import { AsyncLocalStorage } from 'node:async_hooks';
import { and, eq, sql } from 'drizzle-orm';
import { inboundEmailImportJobs as jobs, inboundEmailMailboxes, inboundOrderRecords, inboundOrderFiles, organizations, type InboundOrderRecord, type InboundOrderFile } from '@shared/schema';
import { resolveInboundEmailIntakeSettingsFromPreferences } from '@shared/inboundEmailIntakeSettings';
import { InboundEvidenceConflictError } from './inboundEmailEvidenceFingerprint';

export type ImportClaim = { id: string; organizationId: string; mailboxId: string; claimToken: string | null };
// Propagate ONLY the technical fence through the existing canonical evidence and
// storage-link operations. No provider call runs in a transaction or lock.
export const inboundImportContext = new AsyncLocalStorage<ImportClaim | undefined>();
export async function assertInboundImportClaim(tx: any, organizationId: string) {
  const claim = inboundImportContext.getStore();
  if (!claim) return null;
  if (claim.organizationId !== organizationId) throw new InboundEvidenceConflictError('Import tenant mismatch.');
  const [job] = await tx.select().from(jobs).where(and(eq(jobs.id, claim.id), eq(jobs.organizationId, organizationId),
    eq(jobs.mailboxId, claim.mailboxId), eq(jobs.claimToken, claim.claimToken!), eq(jobs.status, 'importing'), sql`${jobs.claimExpiresAt} > now()`)).for('update').limit(1);
  if (!job) throw new InboundEvidenceConflictError('Import claim expired or was replaced. Durable work is retained.');
  const [mailbox] = await tx.select().from(inboundEmailMailboxes).where(and(eq(inboundEmailMailboxes.id, job.mailboxId),
    eq(inboundEmailMailboxes.organizationId, organizationId), eq(inboundEmailMailboxes.provider, job.provider), eq(inboundEmailMailboxes.enabled, true))).limit(1);
  if (!mailbox) throw new InboundEvidenceConflictError('Import mailbox is no longer eligible.');
  if (mailbox.emailAddress.trim().toLowerCase() !== job.providerAccount) throw new InboundEvidenceConflictError('Import mailbox account changed.');
  const [organization] = await tx.select({ settings: organizations.settings }).from(organizations).where(eq(organizations.id, organizationId)).limit(1);
  const settings = resolveInboundEmailIntakeSettingsFromPreferences((organization?.settings as any)?.preferences);
  if (!organization || !settings.inboundEmailIntakeEnabled || settings.inboundEmailPullPaused) throw new InboundEvidenceConflictError('Import intake is disabled or paused.');
  return job;
}
export async function bindInboundImportRecord(tx: any, record: InboundOrderRecord) {
  const job = await assertInboundImportClaim(tx, record.organizationId);
  if (!job) return record;
  if (job.inboundRecordId && job.inboundRecordId !== record.id) throw new InboundEvidenceConflictError('Import source linkage changed.');
  await tx.update(jobs).set({ inboundRecordId: record.id, updatedAt: new Date() }).where(eq(jobs.id, job.id));
  const metadata = { ...(record.normalizedPayloadJson ?? {}), importIncomplete: true, partialDraftEligible: false };
  await tx.update(inboundOrderRecords).set({ normalizedPayloadJson: metadata }).where(and(eq(inboundOrderRecords.id, record.id), eq(inboundOrderRecords.organizationId, record.organizationId)));
  return { ...record, normalizedPayloadJson: metadata };
}
export function unavailableInboundImportFiles(files: InboundOrderFile[]) {
  return files.filter(file => {
    const classification = (file.metadataJson as any)?.attachmentClassification;
    // Classification never clears a quarantine or an unsafe file state.
    if (file.status === 'quarantined' || file.status === 'rejected') return true;
    if (classification?.classification === 'IGNORE_INLINE' || classification?.source === 'manual_override' && classification.classification === 'OTHER') return false;
    return !file.fileRecordId || file.status !== 'available';
  });
}
export type UnresolvedInboundAttachment = {
  fileId: string;
  filename: string;
  state: string;
  reason: string;
  action: string;
};
export function unresolvedInboundAttachments(files: InboundOrderFile[]): UnresolvedInboundAttachment[] {
  return unavailableInboundImportFiles(files).map(file => {
    const metadata = (file.metadataJson ?? {}) as Record<string, unknown>;
    const state = typeof metadata.attachmentState === 'string' ? metadata.attachmentState : file.status;
    const archive = /(?:zip|x-zip-compressed)/i.test(file.mimeType ?? '') || /\.zip$/i.test(file.sourceFilename ?? '');
    const stored = Boolean(file.fileRecordId);
    return {
      fileId: file.id,
      filename: file.sourceFilename || 'Attachment',
      state,
      reason: archive && file.status === 'quarantined'
        ? 'Stored ZIP is quarantined; its contents were not inspected or parsed.'
        : typeof metadata.attachmentSafetyReason === 'string' ? metadata.attachmentSafetyReason
        : typeof metadata.failureReason === 'string' ? metadata.failureReason
        : stored ? 'Attachment requires safety review before it can be used.' : 'Attachment content is not stored or accessible.',
      action: archive && stored
        ? 'Download for manual review. The original ZIP remains quarantined; supported extracted artwork can be attached through the order artwork workflow when an order exists.'
        : stored ? 'Review the attachment safety state.'
        : file.providerAttachmentId ? 'Fetch the file once or retry its failed download.' : 'Ask the sender for an accessible copy.',
    };
  });
}
export async function assertInboundImportComplete(tx: any, record: InboundOrderRecord, evidenceFiles?: InboundOrderFile[]) {
  if (record.sourceType !== 'email') return;
  // The JSON gate also covers unavailable evidence retained for staff action.
  if (record.normalizedPayloadJson?.importIncomplete) throw new InboundEvidenceConflictError('Email evidence import is incomplete. Resolve the import before approval.');
  const files = evidenceFiles ?? await tx.select().from(inboundOrderFiles).where(and(eq(inboundOrderFiles.organizationId, record.organizationId),eq(inboundOrderFiles.inboundRecordId,record.id)));
  if (unavailableInboundImportFiles(files).length) throw new InboundEvidenceConflictError('Email attachments are unavailable or require staff review. Resolve evidence before approval.');
  const raw = record.rawPayloadJson as any;
  const mailboxId = raw?.mailbox?.id ?? (record.normalizedPayloadJson as any)?.source?.mailboxId;
  const threadId = raw?.threadId ?? (record.normalizedPayloadJson as any)?.source?.threadId;
  const [pending] = await tx.select({ id: jobs.id }).from(jobs).where(and(eq(jobs.organizationId, record.organizationId),
    sql`${jobs.status} not in ('complete','skipped')`,
    sql`(${jobs.inboundRecordId} = ${record.id} or (${jobs.mailboxId} = ${mailboxId ?? ''} and
      (${jobs.providerMessageId} = ${record.sourceMessageId ?? ''} or (${threadId ?? ''} <> '' and ${jobs.providerThreadId} = ${threadId ?? ''}))))`)).limit(1);
  if (pending) throw new InboundEvidenceConflictError('Discovered email evidence is still importing or requires attention.');
}
