import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { db } from '../db';
import { inboundEmailImportJobs as jobs, inboundEmailMailboxes as mailboxes, inboundOrderEvents, organizations, userOrganizations, users, type InboundEmailMailbox } from '@shared/schema';
import { INBOUND_IMPORT_LEASE_MS, INBOUND_IMPORT_MAX_ATTEMPTS, type InboundEmailImportView } from '@shared/inboundEmailImport';
import { resolveInboundEmailIntakeSettingsFromPreferences } from '@shared/inboundEmailIntakeSettings';
import { inboundEmailRetryDelayMs } from '@shared/inboundEmailProcessing';
import { isWorkerEnabled } from '../workers/workerGates';
import { InboundEvidenceConflictError } from '../services/inboundOrders/inboundEmailEvidenceFingerprint';

export type InboundImportJob = typeof jobs.$inferSelect;
export const importOrganizations = () => [...new Set((process.env.INBOUND_EMAIL_IMPORT_ORGANIZATION_IDS ?? '').split(',').map(value => value.trim()).filter(value => value && value !== '*'))];
export const isInboundImportRecoveryEnabled = (organizationId?: string) => isWorkerEnabled('INBOUND_EMAIL_IMPORTS', false) && importOrganizations().length > 0
  && (!organizationId || importOrganizations().includes(organizationId));
export const discoveryMailboxes = () => [...new Set((process.env.INBOUND_EMAIL_DISCOVERY_MAILBOX_IDS ?? '').split(',').map(value => value.trim()).filter(value => value && value !== '*'))];
export const isInboundDiscoveryEnabled = () => isWorkerEnabled('INBOUND_EMAIL_DISCOVERY', false)
  && isInboundImportRecoveryEnabled() && discoveryMailboxes().length > 0;
export class InboundEmailImportRepository {
  constructor(private readonly database = db) {}
  /** Railway's timer only schedules durable work. Mailbox row locks and the
   * existing unfinished-discovery index serialize replicas/restarts. No provider
   * call is made here. Failed windows require the existing staff retry action. */
  async scheduleDiscoveries(optionsFor: (mailbox: InboundEmailMailbox, now: Date) => NonNullable<InboundImportJob['discoveryJson']>) {
    if (!isInboundDiscoveryEnabled()) return 0;
    return this.database.transaction(async tx => {
      const candidates = await tx.select({ mailbox: mailboxes, settings: organizations.settings }).from(mailboxes)
        .innerJoin(organizations, eq(organizations.id, mailboxes.organizationId))
        .innerJoin(userOrganizations, and(eq(userOrganizations.organizationId, mailboxes.organizationId),
          eq(userOrganizations.userId, mailboxes.createdByUserId), inArray(userOrganizations.role, ['owner', 'admin'])))
        .innerJoin(users, and(eq(users.id, userOrganizations.userId), eq(users.accountType, 'INTERNAL_USER')))
        .where(and(inArray(mailboxes.id, discoveryMailboxes()), inArray(mailboxes.organizationId, importOrganizations()),
          eq(mailboxes.provider, 'gmail'), eq(mailboxes.enabled, true), eq(organizations.status, 'active'),
          eq(organizations.isArchived, false), eq(organizations.deleteState, 'active')))
        .orderBy(asc(mailboxes.id)).for('update', { of: mailboxes, skipLocked: true }).limit(20);
      let scheduled = 0;
      for (const { mailbox, settings: preferences } of candidates) {
        if (!isInboundDiscoveryEnabled()) break;
        const settings = resolveInboundEmailIntakeSettingsFromPreferences((preferences as any)?.preferences);
        if (!settings.inboundEmailIntakeEnabled || settings.inboundEmailPullPaused) continue;
        const [open] = await tx.select({ id: jobs.id }).from(jobs).where(and(eq(jobs.organizationId, mailbox.organizationId),
          eq(jobs.mailboxId, mailbox.id), eq(jobs.workKind, 'discovery'), sql`${jobs.status} not in ('complete','skipped')`)).limit(1);
        if (open) continue;
        const [latest] = await tx.select().from(jobs).where(and(eq(jobs.organizationId, mailbox.organizationId),
          eq(jobs.mailboxId, mailbox.id), eq(jobs.workKind, 'discovery'),
          sql`${jobs.discoveryJson}->>'scheduledThrough' is not null`)).orderBy(desc(jobs.createdAt)).limit(1);
        const now = new Date();
        if (latest && now.getTime() - latest.createdAt.getTime() < 300_000) continue;
        const options = optionsFor(mailbox, now);
        // Repeat the bounded lookback, including read mail. Provider indexing
        // delays must not turn the prior scan's end into an exclusion cutoff.
        // Message identity uniqueness makes this overlap safe.
        const [inserted] = await tx.insert(jobs).values({ organizationId: mailbox.organizationId, mailboxId: mailbox.id, provider: 'gmail',
          providerAccount: mailbox.emailAddress.trim().toLowerCase(), workKind: 'discovery', providerMessageId: `discovery:${randomUUID()}`,
          actorUserId: mailbox.createdByUserId, discoveryJson: { ...options, drainWindow: true, scheduledThrough: Math.floor(now.getTime() / 1000) } })
          .onConflictDoNothing().returning({ id: jobs.id });
        if (inserted) scheduled++;
      }
      return scheduled;
    });
  }
  async beginDiscovery(mailbox: InboundEmailMailbox, actorUserId: string, options: NonNullable<InboundImportJob['discoveryJson']>) {
    await this.database.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`inbound-evidence:${mailbox.organizationId}`}))`);
    const [eligible] = await tx.select({ id: mailboxes.id }).from(mailboxes).where(and(eq(mailboxes.id,mailbox.id),
      eq(mailboxes.organizationId,mailbox.organizationId),eq(mailboxes.provider,mailbox.provider),eq(mailboxes.enabled,true),
      sql`lower(${mailboxes.emailAddress}) = ${mailbox.emailAddress.trim().toLowerCase()}`)).limit(1);
    if (!eligible) throw new InboundEvidenceConflictError('Discovery mailbox account is not eligible for this organization.');
    await tx.insert(jobs).values({ organizationId: mailbox.organizationId, mailboxId: mailbox.id, provider: mailbox.provider,
      providerAccount: mailbox.emailAddress.trim().toLowerCase(), workKind: 'discovery', providerMessageId: `discovery:${randomUUID()}`,
      actorUserId, discoveryJson: options }).onConflictDoNothing();
    });
  }
  async discoveryPage(job: InboundImportJob, mailbox: InboundEmailMailbox, identities: Array<{messageId: string; threadId: string | null}>,
    nextPageToken?: string) {
    if (mailbox.id !== job.mailboxId || mailbox.organizationId !== job.organizationId || mailbox.provider !== job.provider
      || mailbox.emailAddress.trim().toLowerCase() !== job.providerAccount) throw new InboundEvidenceConflictError('Discovery provider scope changed.');
    await this.database.transaction(async tx => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`inbound-evidence:${job.organizationId}`}))`);
      const [current] = await tx.select().from(jobs).where(this.owned(job)).for('update').limit(1);
      if (!current?.discoveryJson) throw new InboundEvidenceConflictError('Discovery claim expired or was replaced.');
      // Same transaction commits provider identities and the next cursor. A
      // crash before commit repeats this page using the saved absolute query.
      await new InboundEmailImportRepository(tx as any).discover(mailbox, job.actorUserId!, identities);
      const processed = current.discoveryJson.processed + identities.length;
      const continueWindow = Boolean(nextPageToken && current.discoveryJson.drainWindow && processed >= current.discoveryJson.limit);
      const complete = !nextPageToken || (!current.discoveryJson.drainWindow && processed >= current.discoveryJson.limit);
      await tx.update(jobs).set({ discoveryJson: {...current.discoveryJson, processed: continueWindow ? 0 : processed, pageToken: nextPageToken},
        ...(continueWindow ? {status:'waiting' as const, attempts:0, claimToken:null,claimExpiresAt:null} : {}),
        ...(complete ? {status:'complete' as const, claimToken:null,claimExpiresAt:null} : {}), updatedAt:new Date() }).where(eq(jobs.id,job.id));
    });
  }
  async discover(mailbox: InboundEmailMailbox, actorUserId: string, identities: Array<{ messageId: string; threadId: string | null }>) {
    if (!identities.length) return;
    await this.database.transaction(async tx => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`inbound-evidence:${mailbox.organizationId}`}))`);
      const [eligible] = await tx.select().from(mailboxes).where(and(eq(mailboxes.id, mailbox.id), eq(mailboxes.organizationId, mailbox.organizationId),
        eq(mailboxes.provider, mailbox.provider), eq(mailboxes.enabled, true))).limit(1);
      if (!eligible) throw new InboundEvidenceConflictError('Inbound mailbox is not eligible for discovery.');
      for (const identity of identities) {
        if (!identity.messageId) throw new Error('Missing provider message identity');
        await tx.insert(jobs).values({ organizationId: mailbox.organizationId, mailboxId: mailbox.id, provider: mailbox.provider,
          providerAccount: mailbox.emailAddress.trim().toLowerCase(),
          providerMessageId: identity.messageId, providerThreadId: identity.threadId, actorUserId }).onConflictDoNothing({
          target: [jobs.organizationId, jobs.mailboxId, jobs.provider, jobs.providerMessageId],
        });
      }
    });
  }
  /** One active import per mailbox. Row locking serializes different seeds in
   * the same thread without holding locks across Gmail or storage calls. */
  async claim(scope: { organizationId?: string; mailboxId?: string; messageId?: string; workKind?: 'message' | 'discovery'; automatic?: boolean } = {}): Promise<InboundImportJob | null> {
    const permitted = scope.automatic ? importOrganizations() : scope.organizationId ? [scope.organizationId] : [];
    if (!permitted.length || (scope.automatic && !isInboundImportRecoveryEnabled())) return null;
    return this.database.transaction(async tx => {
      const candidates = await tx.select({ mailbox: mailboxes, settings: organizations.settings }).from(mailboxes)
        .innerJoin(organizations, eq(organizations.id, mailboxes.organizationId)).where(and(
          inArray(mailboxes.organizationId, permitted), eq(mailboxes.enabled, true), eq(mailboxes.provider, 'gmail'),
          ...(scope.mailboxId ? [eq(mailboxes.id, scope.mailboxId)] : []),
          sql`exists (select 1 from inbound_email_import_jobs j where j.mailbox_id = ${mailboxes.id} and j.organization_id = ${mailboxes.organizationId}
            and (j.status in ('waiting','retrying') and j.next_attempt_at <= now() or j.status = 'importing' and j.claim_expires_at <= now()))`,
          sql`not exists (select 1 from inbound_email_import_jobs j where j.mailbox_id = ${mailboxes.id} and j.organization_id = ${mailboxes.organizationId}
            and j.status = 'importing' and j.claim_expires_at > now())`,
        )).orderBy(asc(mailboxes.id)).for('update', { of: mailboxes, skipLocked: true }).limit(20);
      for (const candidate of candidates) {
        const settings = resolveInboundEmailIntakeSettingsFromPreferences((candidate.settings as any)?.preferences);
        if (!settings.inboundEmailIntakeEnabled || settings.inboundEmailPullPaused) continue;
        const mailbox = candidate.mailbox;
        await tx.update(jobs).set({ status: 'failed', claimToken: null, claimExpiresAt: null, errorCode: 'IMPORT_ABANDONED_LIMIT',
          message: 'Import worker stopped repeatedly. Source identity is retained; review and retry.', updatedAt: new Date() }).where(and(
          eq(jobs.organizationId, mailbox.organizationId), eq(jobs.mailboxId, mailbox.id), eq(jobs.status, 'importing'),
          sql`${jobs.claimExpiresAt} <= now()`, sql`${jobs.attempts} >= ${INBOUND_IMPORT_MAX_ATTEMPTS}`));
        const [job] = await tx.select().from(jobs).where(and(eq(jobs.organizationId, mailbox.organizationId), eq(jobs.mailboxId, mailbox.id),
          ...(scope.messageId ? [eq(jobs.providerMessageId, scope.messageId)] : []),
          ...(scope.workKind ? [eq(jobs.workKind, scope.workKind)] : []),
          sql`${jobs.attempts} < ${INBOUND_IMPORT_MAX_ATTEMPTS}`,
          sql`((${jobs.status} in ('waiting','retrying') and ${jobs.nextAttemptAt} <= now()) or (${jobs.status} = 'importing' and ${jobs.claimExpiresAt} <= now()))`,
        )).orderBy(asc(jobs.createdAt), asc(jobs.id)).for('update', { skipLocked: true }).limit(1);
        if (!job) continue;
        const [claimed] = await tx.update(jobs).set({ status: 'importing', attempts: job.attempts + 1, claimToken: randomUUID(),
          claimExpiresAt: sql`now() + ${INBOUND_IMPORT_LEASE_MS} * interval '1 millisecond'`, updatedAt: new Date() }).where(eq(jobs.id, job.id)).returning();
        return claimed;
      }
      return null;
    });
  }
  private owned(job: InboundImportJob) { return and(eq(jobs.id, job.id), eq(jobs.organizationId, job.organizationId), eq(jobs.mailboxId, job.mailboxId),
    eq(jobs.status, 'importing'), eq(jobs.claimToken, job.claimToken!), sql`${jobs.claimExpiresAt} > now()`); }
  async heartbeat(job: InboundImportJob) {
    return (await this.database.update(jobs).set({ claimExpiresAt: sql`now() + ${INBOUND_IMPORT_LEASE_MS} * interval '1 millisecond'`, updatedAt: new Date() }).where(this.owned(job)).returning({ id: jobs.id })).length > 0;
  }
  async fail(job: InboundImportJob, code: string, permanent = false, resetDiscovery = false) {
    return this.database.update(jobs).set({ status: permanent || job.attempts >= INBOUND_IMPORT_MAX_ATTEMPTS ? 'failed' : 'retrying',
      ...(resetDiscovery && job.discoveryJson ? {discoveryJson:{...job.discoveryJson,pageToken:undefined,processed:0}} : {}),
      claimToken: null, claimExpiresAt: null, errorCode: code,
      message: permanent ? 'Provider access or message is unavailable. Resolve access/source availability, then retry.' : 'Import could not complete. Evidence and provider identity are retained; retry is bounded to three attempts.',
      nextAttemptAt: sql`now() + ${inboundEmailRetryDelayMs(job.attempts)} * interval '1 millisecond'`, updatedAt: new Date() }).where(this.owned(job)).returning();
  }
  async list(organizationId: string): Promise<InboundEmailImportView[]> {
    const rows = await this.database.select().from(jobs).where(and(eq(jobs.organizationId, organizationId),
      sql`${jobs.status} not in ('complete','skipped')`)).orderBy(asc(jobs.createdAt)).limit(100);
    return rows.map(job => ({ id: job.id, workKind:job.workKind, mailboxId: job.mailboxId, inboundRecordId: job.inboundRecordId, status: job.status,
      attempts: job.attempts, nextAttemptAt: job.nextAttemptAt.toISOString(), errorCode: job.errorCode, message: job.message,
      canRetry: ['failed','needs_attention'].includes(job.status) }));
  }
  async retry(organizationId: string, id: string, actorUserId: string) {
    await this.database.transaction(async tx => {
    const changed = await tx.update(jobs).set({ status: 'waiting', attempts: 0, actorUserId, nextAttemptAt: new Date(), errorCode: null, message: null, updatedAt: new Date() })
      .where(and(eq(jobs.organizationId, organizationId), eq(jobs.id, id), inArray(jobs.status, ['failed','needs_attention']))).returning({ id: jobs.id });
    if (!changed.length) throw new InboundEvidenceConflictError('Only failed or attention-required imports can be retried. Active work is already recoverable.');
    const [job] = await tx.select().from(jobs).where(eq(jobs.id,id)).limit(1);
    if (job.inboundRecordId) await tx.insert(inboundOrderEvents).values({organizationId,inboundRecordId:job.inboundRecordId,
      actorType:'user',actorUserId,eventType:'email.import_retry',message:'Staff queued a bounded import retry. Business disposition and staff edits are unchanged.',metadataJson:{importJobId:id}});
    });
  }
}
