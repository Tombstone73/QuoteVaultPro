import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { db } from '../../db';
import { inboundEmailImportJobs as jobs, inboundOrderRecords as records, inboundOrderFiles as files, inboundOrderEvents as events } from '@shared/schema';
import { inboundLinkedOrderId } from '@shared/inboundAccountability';
import { inboundEmailMessageManifest } from '@shared/inboundEmailMessageManifest';
import { fingerprintInboundEmailEvidence } from './inboundEmailEvidenceFingerprint';

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
export const IMPORT_DISMISSED = 'IMPORT_DISMISSED';
const dismissalEvents = ['review.ignored', 'review.reject', 'review.queue_deleted', 'review.status_updated'];

/** The caller owns the transaction. Use the same evidence lock as dismissal,
 * import publication, combined requests and Order linkage. Never infer dismissal
 * from a missing queue row, status alone, or an obsolete evidence fingerprint. */
export async function reconcileDismissedImportJobs(tx: Transaction, organizationId: string, recordId?: string, jobId?: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`inbound-evidence:${organizationId}`}))`);
  const candidates = await tx.select({ job: jobs, record: records }).from(jobs)
    .innerJoin(records, and(eq(records.id, jobs.inboundRecordId), eq(records.organizationId, organizationId)))
    .where(and(eq(jobs.organizationId, organizationId), eq(jobs.workKind, 'message'),
      ...(recordId ? [eq(records.id, recordId)] : []),
      ...(jobId ? [eq(jobs.id, jobId)] : []),
      sql`(${records.status} in ('ignored','terminal') or ${jobs.errorCode} = ${IMPORT_DISMISSED})`,
      sql`(${jobs.status} not in ('complete','skipped') or (${jobs.errorCode} = ${IMPORT_DISMISSED}
        and (${recordId ? sql`true` : sql`${records.status} not in ('ignored','terminal') or ${records.normalizedPayloadJson}->>'unresolvedEvidenceFingerprint' is not null
          or ${records.normalizedPayloadJson}->>'evidenceFingerprint' is distinct from ${records.normalizedPayloadJson}->'evidenceResolution'->>'fingerprint'`})))`,
    )).orderBy(asc(jobs.createdAt), asc(jobs.id)).for('update', { of: jobs }).limit(100);
  let resolved = 0;
  for (const { job, record } of candidates) {
    const metadata = record.normalizedPayloadJson ?? {};
    const resolution = metadata.evidenceResolution as { kind?: string; fingerprint?: string; actorUserId?: string; orderId?: string } | undefined;
    const evidenceFiles = await tx.select().from(files).where(and(eq(files.organizationId, organizationId), eq(files.inboundRecordId, record.id)));
    const fingerprint = fingerprintInboundEmailEvidence(record, evidenceFiles);
    const manifest = inboundEmailMessageManifest(record);
    let safe = record.sourceType === 'email' && ['ignored', 'terminal'].includes(record.status)
      && ['ignored', 'deleted', 'rejected'].includes(record.reviewOutcome ?? '')
      && !inboundLinkedOrderId(record) && !record.createdQuoteId && !record.matchedOrderId
      && !metadata.combinedParentRecordId && (!metadata.combinedSources || Array.isArray(metadata.combinedSources) && metadata.combinedSources.length === 0)
      && !metadata.unresolvedEvidenceFingerprint && resolution?.kind === 'dismissed' && !resolution.orderId
      && Boolean(resolution.actorUserId) && resolution.fingerprint === fingerprint && metadata.evidenceFingerprint === fingerprint
      && job.provider === 'gmail' && manifest?.mailboxId === job.mailboxId && manifest.providerAccount === job.providerAccount
      && manifest.messageIds.includes(job.providerMessageId);
    if (safe) {
      const [audit] = await tx.select({ id: events.id }).from(events).where(and(eq(events.organizationId, organizationId),
        eq(events.inboundRecordId, record.id), eq(events.actorType, 'user'), eq(events.actorUserId, resolution!.actorUserId!),
        inArray(events.eventType, dismissalEvents), sql`${events.metadataJson}->>'evidenceFingerprint' = ${fingerprint}`,
        sql`${events.metadataJson}->>'resolutionKind' = 'dismissed'`)).limit(1);
      // Related requests or canonical Order/Quote files are never auto-resolved.
      // Deliberately conservative: even historical shared ownership needs review.
      const dependencies = await tx.execute(sql`select 1 where
        exists (select 1 from inbound_order_records r where r.organization_id = ${organizationId} and r.id <> ${record.id} and (
          r.normalized_payload_json->>'combinedParentRecordId' = ${record.id}
          or r.normalized_payload_json->'combinedSources' @> ${JSON.stringify([{ recordId: record.id }])}::jsonb
          or (r.raw_payload_json->'mailbox'->>'id' = ${job.mailboxId} and r.raw_payload_json->>'provider' = ${job.provider} and (
            r.source_message_id = ${job.providerMessageId} or r.raw_payload_json->'thread'->'messages' @> ${JSON.stringify([{ messageId: job.providerMessageId }])}::jsonb
            or (${job.providerThreadId ?? ''} <> '' and r.raw_payload_json->>'threadId' = ${job.providerThreadId ?? ''})))
          or exists (select 1 from inbound_order_files f join inbound_order_files own on own.file_record_id = f.file_record_id
            where f.organization_id = ${organizationId} and own.organization_id = ${organizationId}
              and own.inbound_record_id = ${record.id} and f.inbound_record_id = r.id)))
        or exists (select 1 from inbound_order_files f where f.organization_id = ${organizationId} and f.inbound_record_id = ${record.id} and (
          exists (select 1 from line_item_artwork a where a.organization_id = ${organizationId} and a.file_record_id = f.file_record_id)
          or exists (select 1 from order_attachments a join orders o on o.id = a.order_id
            where o.organization_id = ${organizationId} and a.file_record_id = f.file_record_id)
          or exists (select 1 from line_item_files a where a.organization_id = ${organizationId} and a.file_record_id = f.file_record_id)
          or exists (select 1 from quote_attachments a join quotes q on q.id = a.quote_id
            where q.organization_id = ${organizationId} and a.file_record_id = f.file_record_id)))`);
      safe = Boolean(audit) && dependencies.rows.length === 0;
    }
    if (safe && job.errorCode !== IMPORT_DISMISSED) {
      await tx.update(jobs).set({ status: 'skipped', errorCode: IMPORT_DISMISSED,
        message: 'Intentionally dismissed by staff for this evidence version. Source files and history are retained.',
        claimToken: null, claimExpiresAt: null, updatedAt: new Date() }).where(and(eq(jobs.organizationId, organizationId), eq(jobs.id, job.id)));
      await tx.insert(events).values({ organizationId, inboundRecordId: record.id, actorType: 'system', eventType: 'email.import_dismissal_reconciled',
        message: 'Import attention resolved from the current audited staff dismissal. No Gmail or evidence content changed.',
        metadataJson: { importJobId: job.id, evidenceFingerprint: fingerprint, previousStatus: job.status, previousErrorCode: job.errorCode,
          previousMessage: job.message, attempts: job.attempts, supersededActiveClaim: job.status === 'importing' } });
      resolved++;
    } else if (!safe && job.errorCode === IMPORT_DISMISSED) {
      await tx.update(jobs).set({ status: 'needs_attention', errorCode: 'IMPORT_DISMISSAL_REVIEW_REQUIRED',
        message: 'Evidence or linkage changed after dismissal. Open the inbound request and review before retrying.', updatedAt: new Date() })
        .where(and(eq(jobs.organizationId, organizationId), eq(jobs.id, job.id)));
      await tx.insert(events).values({ organizationId, inboundRecordId: record.id, actorType: 'system', eventType: 'email.import_dismissal_invalidated',
        message: 'Prior import dismissal no longer covers current evidence or linkage; staff review is required.', metadataJson: { importJobId: job.id, evidenceFingerprint: fingerprint } });
    }
  }
  return resolved;
}
