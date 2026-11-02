import { hasGmailModifyScope, GMAIL_ACK_LEASE_MS } from '@shared/inboundGmailAcknowledgement';
import type { InboundEmailMailbox } from '@shared/schema';
import { inboundGmailAcknowledgementRepository, isGmailAcknowledgementEnabled, type GmailAcknowledgementJob } from '../../storage/inboundGmailAcknowledgement.repo';
import { InboundEvidenceConflictError } from './inboundEmailEvidenceFingerprint';
import { inboundGmailClient } from './inboundGmailClient';

export interface GmailAcknowledgementProvider {
  acknowledge(mailbox: InboundEmailMailbox, messageIds: readonly string[], beforeWrite: () => Promise<void>): Promise<void>;
}
function ackError(code: string, status: 'reconnect_required'|'needs_attention') {
  return Object.assign(new Error(code), {ackCode:code,ackStatus:status});
}
export class GmailAcknowledgementAdapter implements GmailAcknowledgementProvider {
  constructor(private readonly client = inboundGmailClient) {}
  async acknowledge(mailbox: InboundEmailMailbox, messageIds: readonly string[], beforeWrite: () => Promise<void>) {
    if (!hasGmailModifyScope((mailbox.authJson as any)?.scope)) throw ackError('MODIFY_PERMISSION_REQUIRED','reconnect_required');
    const {auth,gmail} = this.client(mailbox);
    // Verify the credential actually used for background access, including when
    // Google legitimately returned no replacement refresh token during reconnect.
    const access = await auth.getAccessToken();
    if (!access.token) throw ackError('REFRESH_CREDENTIAL_UNAVAILABLE','reconnect_required');
    const info = await auth.getTokenInfo(access.token);
    if (!hasGmailModifyScope(info.scopes)) throw ackError('MODIFY_PERMISSION_REQUIRED','reconnect_required');
    const profile = await gmail.users.getProfile({userId:'me'});
    if (profile.data.emailAddress?.trim().toLowerCase() !== mailbox.emailAddress.trim().toLowerCase()) throw ackError('PROVIDER_ACCOUNT_MISMATCH','needs_attention');
    const findLabel = async () => (await gmail.users.labels.list({userId:'me'})).data.labels?.find(label => label.type === 'user' && label.name === 'Entered')?.id;
    let labelId = await findLabel();
    if (!labelId) {
      await beforeWrite();
      try { labelId = (await gmail.users.labels.create({userId:'me',requestBody:{name:'Entered',labelListVisibility:'labelShow',messageListVisibility:'show'}})).data.id; }
      catch (error) {
        // A create response can be lost after Google commits. Re-list by name;
        // never create a differently named duplicate to work around a conflict.
        labelId = await findLabel(); if (!labelId) throw error;
      }
    }
    if (!labelId) throw ackError('ENTERED_LABEL_UNAVAILABLE','needs_attention');
    for (let offset=0;offset<messageIds.length;offset+=500) {
      await beforeWrite();
      await gmail.users.messages.batchModify({userId:'me',requestBody:{ids:messageIds.slice(offset,offset+500),addLabelIds:[labelId],removeLabelIds:['UNREAD']}});
    }
  }
}

export class InboundGmailAcknowledgementWorker {
  private running = false;
  constructor(private readonly queue = inboundGmailAcknowledgementRepository, private readonly provider: GmailAcknowledgementProvider = new GmailAcknowledgementAdapter()) {}
  async runOnce(limit=3) {
    if (this.running || !isGmailAcknowledgementEnabled()) return {processed:0};
    this.running=true; let processed=0;
    try {
      for (;processed<Math.max(1,Math.min(10,limit));processed++) {
        if (!isGmailAcknowledgementEnabled()) break;
        const job=await this.queue.claim();if(!job)break;
        await this.process(job);
      }
      return {processed};
    } finally {this.running=false;}
  }
  private async process(job: GmailAcknowledgementJob) {
    let lost=false;
    const timer=setInterval(()=>{void this.queue.heartbeat(job).then(ok=>{if(!ok)lost=true;}).catch(()=>{lost=true;});},GMAIL_ACK_LEASE_MS/3);
    timer.unref?.();
    const guard=async()=>{if(lost)throw new InboundEvidenceConflictError('Gmail claim lost');await this.queue.guard(job);};
    try {
      const mailbox=await this.queue.guard(job);
      if (!hasGmailModifyScope((mailbox.authJson as any)?.scope)) throw ackError('MODIFY_PERMISSION_REQUIRED','reconnect_required');
      await this.provider.acknowledge(mailbox,[...job.messageIds],guard);
      await guard(); await this.queue.finish(job);
    } catch (error: any) {
      if (error instanceof InboundEvidenceConflictError) return; // lease recovers; never complete a replaced claim
      const code = Number(error?.response?.status ?? error?.status ?? error?.code);
      const grant = error?.response?.data?.error === 'invalid_grant';
      const reason = error?.response?.data?.error?.errors?.[0]?.reason;
      const rateLimited = code===429 || ['rateLimitExceeded','userRateLimitExceeded','quotaExceeded'].includes(reason);
      const status = error?.ackStatus ?? (code===401 || grant || code===403&&!rateLimited ? 'reconnect_required' : code===400||code===404 ? 'needs_attention' : undefined);
      await this.queue.fail(job,error?.ackCode ?? (status==='reconnect_required'?'GMAIL_RECONNECT_REQUIRED':status==='needs_attention'?'GMAIL_SOURCE_UNAVAILABLE':'PROVIDER_TRANSIENT'),status);
      console.warn('[InboundGmailAcknowledgement] Update incomplete',{organizationId:job.organizationId,jobId:job.id,category:status??'retryable'});
    } finally {clearInterval(timer);}
  }
}
export const inboundGmailAcknowledgementWorker = new InboundGmailAcknowledgementWorker();
