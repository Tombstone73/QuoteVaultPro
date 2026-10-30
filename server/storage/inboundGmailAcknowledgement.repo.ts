import { randomUUID } from 'node:crypto';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { db } from '../db';
import { inboundGmailAcknowledgements as jobs, inboundEmailMailboxes as mailboxes, inboundOrderEvents, type InboundOrderRecord } from '@shared/schema';
import { GMAIL_ACK_LEASE_MS, GMAIL_ACK_MAX_ATTEMPTS, hasGmailModifyScope, type GmailAcknowledgementStatus, type GmailAcknowledgementView } from '@shared/inboundGmailAcknowledgement';
import { inboundEmailMessageManifest, type InboundMessageManifest } from '@shared/inboundEmailMessageManifest';
import { inboundEmailRetryDelayMs } from '@shared/inboundEmailProcessing';
import { isWorkerEnabled } from '../workers/workerGates';
import { InboundEvidenceConflictError } from '../services/inboundOrders/inboundEmailEvidenceFingerprint';

export type GmailAcknowledgementJob = typeof jobs.$inferSelect;
export const acknowledgementOrganizations = () => [...new Set((process.env.INBOUND_GMAIL_ACK_ORGANIZATION_IDS ?? '').split(',').map(s => s.trim()).filter(s => s && s !== '*'))];
export const isGmailAcknowledgementEnabled = (org?: string) => isWorkerEnabled('INBOUND_GMAIL_ACK', false)
  && acknowledgementOrganizations().length > 0 && (!org || acknowledgementOrganizations().includes(org));

export function acknowledgementSourceSnapshot(record: InboundOrderRecord): {manifests:InboundMessageManifest[];legacyCombined:boolean} {
  const combined=(record.normalizedPayloadJson as any)?.combinedSources;
  return {manifests:[inboundEmailMessageManifest(record),...(Array.isArray(combined)?combined.map(s=>s.messageManifest):[])].filter(Boolean),
    legacyCombined:Array.isArray(combined)&&combined.some(s=>s.sourceType==='email'&&s.recordId!==record.id&&!s.messageManifest)};
}

/** Caller holds the evidence lock and commits this outbox with actual Order linkage.
 * No historical backfill or scheduling from worker retries exists. */
export async function scheduleGmailAcknowledgement(tx: any, record: InboundOrderRecord, orderId: string, fingerprint: string, source=acknowledgementSourceSnapshot(record)) {
  if (record.sourceType !== 'email') return;
  const {manifests,legacyCombined}=source;
  const grouped = new Map<string, InboundMessageManifest>();
  const ambiguousAccounts = new Set<string>();
  for (const manifest of manifests) {
    const group = grouped.get(manifest.mailboxId);
    if (group && group.providerAccount !== manifest.providerAccount) { ambiguousAccounts.add(manifest.mailboxId); continue; }
    grouped.set(manifest.mailboxId, { ...manifest, messageIds: [...new Set([...(group?.messageIds ?? []), ...manifest.messageIds])].sort() });
  }
  for (const manifest of grouped.values()) {
    const [mailbox] = await tx.select().from(mailboxes).where(and(eq(mailboxes.organizationId,record.organizationId),eq(mailboxes.id,manifest.mailboxId),eq(mailboxes.provider,'gmail'))).limit(1);
    // Explicit opt-in applies to FUTURE resolutions only, even while the worker is paused.
    if ((mailbox?.settingsJson as any)?.gmailAcknowledgementEnabled !== true) continue;
    const accountMatches = mailbox.emailAddress.trim().toLowerCase() === manifest.providerAccount;
    const modify = hasGmailModifyScope((mailbox.authJson as any)?.scope);
    const ambiguous=ambiguousAccounts.has(mailbox.id);
    await tx.insert(jobs).values({ organizationId:record.organizationId,inboundRecordId:record.id,orderId,
      mailboxId:mailbox.id,providerAccount:manifest.providerAccount,evidenceFingerprint:fingerprint,messageIds:manifest.messageIds,
      status: ambiguous || legacyCombined || !accountMatches ? 'needs_attention' : modify ? 'waiting' : 'reconnect_required',
      errorCode: ambiguous ? 'AMBIGUOUS_SOURCE_ACCOUNT' : legacyCombined ? 'LEGACY_SOURCE_MANIFEST_UNTRACKED' : !accountMatches ? 'MAILBOX_ACCOUNT_CHANGED' : modify ? null : 'MODIFY_PERMISSION_REQUIRED',
      message: ambiguous ? 'Order entered. Combined evidence refers to different accounts for one mailbox identity. Reconcile the sources before any Gmail write.' : legacyCombined ? 'Order entered. Legacy combined evidence has no frozen source-message manifest; deliberate reconciliation is required. No Gmail writes were scheduled for execution.' : !accountMatches ? 'Mailbox account differs from the reviewed evidence. No Gmail writes are allowed.' : modify ? null : 'Order entered. Reconnect this Gmail account with modify permission, then retry the Gmail update.',
    }).onConflictDoNothing();
  }
}

export class InboundGmailAcknowledgementRepository {
  constructor(private readonly database = db) {}
  async claim(): Promise<GmailAcknowledgementJob | null> {
    if (!isGmailAcknowledgementEnabled()) return null;
    return this.database.transaction(async tx => {
      const scopes = acknowledgementOrganizations();
      const candidates = await tx.select().from(mailboxes).where(and(inArray(mailboxes.organizationId,scopes),eq(mailboxes.provider,'gmail'),eq(mailboxes.enabled,true),
        sql`${mailboxes.settingsJson}->'gmailAcknowledgementEnabled' = 'true'::jsonb`,
        sql`exists(select 1 from inbound_gmail_acknowledgements j where j.mailbox_id=${mailboxes.id} and j.organization_id=${mailboxes.organizationId} and
          (j.status in ('waiting','retrying') and j.next_attempt_at<=now() or j.status='processing' and j.claim_expires_at<=now()))`,
        sql`not exists(select 1 from inbound_gmail_acknowledgements j where j.mailbox_id=${mailboxes.id} and j.organization_id=${mailboxes.organizationId} and j.status='processing' and j.claim_expires_at>now())`,
      )).orderBy(asc(mailboxes.id)).for('update',{skipLocked:true}).limit(20);
      for (const mailbox of candidates) {
        const scope = and(eq(jobs.organizationId,mailbox.organizationId),eq(jobs.mailboxId,mailbox.id));
        await tx.update(jobs).set({status:'failed',claimToken:null,claimExpiresAt:null,errorCode:'ABANDONED_LIMIT',message:'Order entered. Gmail worker stopped repeatedly; review and retry.',updatedAt:new Date()})
          .where(and(scope,eq(jobs.status,'processing'),sql`${jobs.claimExpiresAt}<=now()`,sql`${jobs.attempts}>=${GMAIL_ACK_MAX_ATTEMPTS}`));
        const [job] = await tx.select().from(jobs).where(and(scope,sql`${jobs.attempts}<${GMAIL_ACK_MAX_ATTEMPTS}`,
          sql`(${jobs.status} in ('waiting','retrying') and ${jobs.nextAttemptAt}<=now() or ${jobs.status}='processing' and ${jobs.claimExpiresAt}<=now())`))
          .orderBy(asc(jobs.createdAt),asc(jobs.id)).for('update',{skipLocked:true}).limit(1);
        if (!job) continue;
        const [claimed] = await tx.update(jobs).set({status:'processing',attempts:job.attempts+1,claimToken:randomUUID(),
          claimExpiresAt:sql`now()+${GMAIL_ACK_LEASE_MS}*interval '1 millisecond'`,updatedAt:new Date()}).where(eq(jobs.id,job.id)).returning();
        return claimed;
      }
      return null;
    });
  }
  private owned(job: GmailAcknowledgementJob) { return and(eq(jobs.id,job.id),eq(jobs.organizationId,job.organizationId),eq(jobs.mailboxId,job.mailboxId),eq(jobs.status,'processing'),eq(jobs.claimToken,job.claimToken!),sql`${jobs.claimExpiresAt}>now()`); }
  async guard(job: GmailAcknowledgementJob) {
    if (!isGmailAcknowledgementEnabled(job.organizationId)) throw new InboundEvidenceConflictError('Gmail writes are paused.');
    return this.database.transaction(async tx => {
      const [owned] = await tx.select().from(jobs).where(this.owned(job)).for('update').limit(1);
      if (!owned) throw new InboundEvidenceConflictError('Gmail acknowledgement claim was replaced or expired.');
      const [mailbox] = await tx.select().from(mailboxes).where(and(eq(mailboxes.organizationId,job.organizationId),eq(mailboxes.id,job.mailboxId),eq(mailboxes.provider,'gmail'),eq(mailboxes.enabled,true))).limit(1);
      if (!mailbox || (mailbox.settingsJson as any)?.gmailAcknowledgementEnabled !== true) throw new InboundEvidenceConflictError('Mailbox writes are disabled.');
      if (mailbox.emailAddress.trim().toLowerCase() !== job.providerAccount) throw Object.assign(new Error('Mailbox identity changed'),{ackCode:'MAILBOX_ACCOUNT_CHANGED',ackStatus:'needs_attention'});
      return mailbox;
    });
  }
  async heartbeat(job: GmailAcknowledgementJob) {
    if (!isGmailAcknowledgementEnabled(job.organizationId)) return false;
    return (await this.database.update(jobs).set({claimExpiresAt:sql`now()+${GMAIL_ACK_LEASE_MS}*interval '1 millisecond'`}).where(this.owned(job)).returning({id:jobs.id})).length>0;
  }
  async finish(job: GmailAcknowledgementJob) {
    return this.database.transaction(async tx => {
      const [changed] = await tx.update(jobs).set({status:'succeeded',claimToken:null,claimExpiresAt:null,errorCode:null,message:'Covered messages marked read and labeled Entered. New evidence remains independent.',updatedAt:new Date()}).where(this.owned(job)).returning();
      if (changed) await tx.insert(inboundOrderEvents).values({organizationId:job.organizationId,inboundRecordId:job.inboundRecordId,actorType:'system',eventType:'email.acknowledged',
        message:'Gmail acknowledgement completed for previously Order-covered evidence.',metadataJson:{acknowledgementId:job.id,orderId:job.orderId,evidenceFingerprint:job.evidenceFingerprint,messageCount:job.messageIds.length}});
      return Boolean(changed);
    });
  }
  async fail(job: GmailAcknowledgementJob, code='PROVIDER_TRANSIENT', terminal?: 'reconnect_required'|'needs_attention') {
    const status: GmailAcknowledgementStatus = terminal ?? (job.attempts>=GMAIL_ACK_MAX_ATTEMPTS?'failed':'retrying');
    return this.database.update(jobs).set({status,claimToken:null,claimExpiresAt:null,errorCode:code,
      nextAttemptAt:sql`now()+${inboundEmailRetryDelayMs(job.attempts)}*interval '1 millisecond'`,updatedAt:new Date(),
      message: status==='reconnect_required'?'Order entered. Reconnect Gmail with modify permission, then retry.':status==='needs_attention'?'Order entered. Gmail source/account requires review before retry.':'Order entered. Gmail update did not complete; bounded retry is safe and will not recreate the Order.',
    }).where(this.owned(job)).returning();
  }
  async list(organizationId: string): Promise<GmailAcknowledgementView[]> {
    const rows = await this.database.select().from(jobs).where(and(eq(jobs.organizationId,organizationId),sql`${jobs.status}<>'succeeded'`)).orderBy(asc(jobs.createdAt)).limit(100);
    return rows.map(j=>({id:j.id,inboundRecordId:j.inboundRecordId,orderId:j.orderId,mailboxId:j.mailboxId,status:j.status,attempts:j.attempts,message:j.message,canRetry:!['LEGACY_SOURCE_MANIFEST_UNTRACKED','AMBIGUOUS_SOURCE_ACCOUNT'].includes(j.errorCode??'')&&['failed','reconnect_required','needs_attention'].includes(j.status)}));
  }
  async retry(organizationId: string, id: string, actorUserId: string) {
    return this.database.transaction(async tx => {
      const [job] = await tx.update(jobs).set({status:'waiting',attempts:0,nextAttemptAt:new Date(),errorCode:null,message:null,updatedAt:new Date()})
        .where(and(eq(jobs.organizationId,organizationId),eq(jobs.id,id),sql`coalesce(${jobs.errorCode},'') not in ('LEGACY_SOURCE_MANIFEST_UNTRACKED','AMBIGUOUS_SOURCE_ACCOUNT')`,inArray(jobs.status,['failed','reconnect_required','needs_attention']))).returning();
      if (!job) throw new InboundEvidenceConflictError('Only failed or attention-required Gmail updates can be retried.');
      await tx.insert(inboundOrderEvents).values({organizationId,inboundRecordId:job.inboundRecordId,actorType:'user',actorUserId,eventType:'email.acknowledgement_retry',message:'Staff queued Gmail update only. Order and evidence resolution are unchanged.',metadataJson:{acknowledgementId:id}});
    });
  }
}
export const inboundGmailAcknowledgementRepository = new InboundGmailAcknowledgementRepository();
