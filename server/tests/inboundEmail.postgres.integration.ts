import { afterAll, afterEach, beforeEach, expect, jest, test } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { setImmediate } from 'node:timers/promises';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { and, eq, sql } from 'drizzle-orm';
import * as schema from '@shared/schema';
import { db, pool } from '../db';
import { InboundOrdersRepository } from '../storage/inboundOrders.repo';
import { InboundEmailProcessingRepository } from '../storage/inboundEmailProcessing.repo';
import { InboundOrderParsingService } from '../services/inboundOrders/InboundOrderParsingService';
import { InboundOrderService } from '../services/inboundOrders/InboundOrderService';
import { InboundEmailProcessingWorker } from '../services/inboundOrders/InboundEmailProcessingWorker';
import { inboundOrderParsedDraftSchema } from '@shared/inboundOrdersApi';
import { InboundEvidenceConflictError } from '../services/inboundOrders/inboundEmailEvidenceFingerprint';
import { OrdersRepository } from '../storage/orders.repo';
import { QuotesRepository } from '../storage/quotes.repo';
import express from 'express';
import request from 'supertest';
import { registerInboundOrderRoutes } from '../routes/inboundOrders.routes';
import { storageApplicationService } from '../services/storage/StorageApplicationService';
import { inboundArchiveResolutionService } from '../services/inboundOrders/InboundArchiveResolutionService';
import { archiveEvidenceIdentity, archiveResolution } from '../services/inboundOrders/inboundArchiveResolution';
import { unavailableInboundImportFiles } from '../services/inboundOrders/inboundEmailImportContext';
import { deleteFile } from '../utils/fileStorage';

const secondPool = new Pool({ connectionString: process.env.TEST_DATABASE_URL, application_name: 'inbound-test-competitor' });
const secondDb = drizzle(secondPool, { schema });
const repo = new InboundOrdersRepository(db);
const other = new InboundOrdersRepository(secondDb as any);
const queue = new InboundEmailProcessingRepository(db);
const competing = new InboundEmailProcessingRepository(secondDb as any);
let org: string, user: string, id: string;
const envKeys = ['WORKER_INBOUND_EMAIL_DRAFTS_ENABLED', 'INBOUND_EMAIL_AUTO_DRAFT_ORGANIZATION_IDS', 'WORKERS_ENABLED'];
const originalEnv = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));
beforeEach(async () => {
  org = `inbound-test-${randomUUID()}`; user = randomUUID(); id = randomUUID();
  process.env.WORKER_INBOUND_EMAIL_DRAFTS_ENABLED = 'true';
  process.env.INBOUND_EMAIL_AUTO_DRAFT_ORGANIZATION_IDS = org;
  delete process.env.WORKERS_ENABLED;
  await db.insert(schema.organizations).values({ id: org, name: 'Isolated inbound test', slug: org });
  await db.insert(schema.users).values({ id: user, email: `${user}@example.invalid`, role: 'owner' });
  await db.insert(schema.inboundOrderRecords).values({ id, organizationId: org, sourceType: 'email', status: 'needs_review',
    rawPayloadJson: { subject: 'Synthetic request', bodyText: 'Please review this request' } });
});
afterAll(async () => {
  for (const key of envKeys) if (originalEnv[key] === undefined) delete process.env[key]; else process.env[key] = originalEnv[key];
  // Entire cluster belongs to the runner; it stops/removes it in finally, even
  // after failure. Never perform broad row cleanup in an application database.
  await secondPool.end(); await pool.end();
});
afterEach(async () => {
  const placements = await db.select({ localPathRef: schema.storagePlacements.localPathRef }).from(schema.storagePlacements)
    .innerJoin(schema.fileRecords, eq(schema.storagePlacements.fileRecordId, schema.fileRecords.id))
    .where(eq(schema.fileRecords.organizationId, org));
  for (const placement of placements) if (placement.localPathRef) await deleteFile(placement.localPathRef).catch(() => false);
});
const event = { actorType: 'user' as const, eventType: 'test.review' };
const identity = () => ({ organizationId: org, inboundRecordId: id });
const state = () => repo.getEvidenceState(org, id);
const record = () => repo.getRecord(org, id);
const jobs = () => db.select().from(schema.inboundEmailProcessingJobs).where(eq(schema.inboundEmailProcessingJobs.organizationId, org));
const importEmail = () => repo.completeEmailImport(org, id, user);
const change = (repository = repo, text = 'Revised request') => repository.updateRecordWithEvent({ ...identity(),
  patch: { rawPayloadJson: { subject: 'Synthetic request', bodyText: text } }, event: { actorType: 'system', eventType: 'email.updated' } });
const claimArgs = (job: any) => ({ jobId: job.id, claimToken: job.claimToken, evidenceFingerprint: job.evidenceFingerprint });
const expire = (job: any) => db.update(schema.inboundEmailProcessingJobs).set({ claimExpiresAt: new Date(0) }).where(eq(schema.inboundEmailProcessingJobs.id, job.id));
async function draft(fingerprint?: string | null) {
  const fp = fingerprint === undefined ? (await state()).fingerprint : fingerprint;
  const attempt = await repo.createParseAttempt({ organizationId: org, inboundOrderRecordId: id, status: 'success', rawResponse: { inboundEvidenceFingerprint: fp } });
  return (await repo.createReviewSnapshotWithEvent({ snapshot: { organizationId: org, inboundRecordId: id, snapshotType: 'approval',
    payloadJson: { metadata: { snapshotKind: 'editable_review_draft' }, reviewNotes: 'Staff edited: retain this text' } },
    ...(fp ? { evidenceSourceParseAttemptId: attempt.id } : {}), evidenceSourceSnapshotId: null, event })).snapshot;
}
const approve = (snapshot: any, repository = repo) => repository.createReviewSnapshotWithEvent({ snapshot: {
  organizationId: org, inboundRecordId: id, snapshotType: 'approval', payloadJson: { ...snapshot.payloadJson, status: 'ready_to_convert' } },
  evidenceSourceSnapshotId: snapshot.id, recordPatch: { status: 'ready' }, event });
const dismiss = (fingerprint: string, repository = repo) => repository.updateRecordWithEvent({ ...identity(), expectedEvidenceFingerprint: fingerprint,
  patch: { status: 'ignored', reviewOutcome: 'ignored' }, event: { actorType: 'user', actorUserId: user, eventType: 'review.ignored' } });

function bulkApp(organizationId = org, repository = repo) {
  const app = express();
  app.use(express.json());
  registerInboundOrderRoutes(app, {
    isAuthenticated: (req: any, _res: any, next: any) => { req.user = { id: user, role: 'admin' }; next(); },
    tenantContext: (req: any, _res: any, next: any) => { req.organizationId = organizationId; req.actorOrgRole = 'admin'; next(); },
    assertInternalUser: () => true,
    inboundOrderService: new InboundOrderService(repository),
  });
  return app;
}

async function bulkDelete(app: ReturnType<typeof bulkApp>, recordIds: string[], expectedEvidenceFingerprints: Record<string, string>) {
  return request(app).post('/api/inbound-orders/bulk-action').send({ recordIds, action: 'delete', expectedEvidenceFingerprints });
}

async function configureArchiveTestStorage() {
  const [canonical] = await db.insert(schema.storageProviderConfigs).values({ organizationId: org, providerType: 'local_filesystem',
    role: 'canonical', status: 'validated', displayName: 'Isolated archive test storage', configJson: {} }).returning();
  const [intake] = await db.insert(schema.storageProviderConfigs).values({ organizationId: org, providerType: 'local_filesystem',
    role: 'intake', status: 'validated', displayName: 'Isolated archive test intake', configJson: {} }).returning();
  await db.insert(schema.organizationStorageProfiles).values({ organizationId: org, mode: 'byos_local', status: 'active',
    primaryProviderConfigId: canonical.id, intakeProviderConfigId: intake.id });
}

async function syntheticStoredArchive() {
  const stored = await storageApplicationService.finalizeUpload({ organizationId: org, createdByUserId: user,
    resource: { organizationId: org, resourceType: 'inbound_order', resourceId: id },
    source: { kind: 'buffer', buffer: Buffer.from('PK\x03\x04synthetic archive fixture'), originalFilename: 'Archive.zip', mimeType: 'application/zip' },
    persistLink: async (tx, result) => {
      const [file] = await tx.insert(schema.inboundOrderFiles).values({ organizationId: org, inboundRecordId: id,
        fileRecordId: result.fileRecord.id, sourceFilename: 'Archive.zip', role: 'email_attachment',
        mimeType: 'application/zip', status: 'quarantined', checksum: result.fileRecord.checksum,
        providerMessageId: 'synthetic-message', providerAttachmentId: 'synthetic-archive',
        metadataJson: { attachmentState: 'scan_pending' } }).returning();
      return file;
    },
  });
  return stored.linkedRecord;
}

test('archive upload and explicit resolution preserve ZIP and reject stale or foreign evidence', async () => {
  await configureArchiveTestStorage();
  const archive = await syntheticStoredArchive();
  const mailboxId = randomUUID();
  await db.insert(schema.inboundEmailMailboxes).values({ id: mailboxId, organizationId: org, name: 'Synthetic mailbox', emailAddress: 'archive-qa@example.invalid' });
  await db.update(schema.inboundOrderRecords).set({ sourceMessageId: 'synthetic-message',
    rawPayloadJson: { subject: 'Synthetic request', bodyText: 'Please review this request', mailbox: { id: mailboxId } },
    normalizedPayloadJson: { importIncomplete: true } }).where(eq(schema.inboundOrderRecords.id, id));
  await db.insert(schema.inboundEmailImportJobs).values({ organizationId: org, mailboxId, provider: 'gmail',
    providerAccount: 'archive-qa@example.invalid', providerMessageId: 'synthetic-message', inboundRecordId: id,
    status: 'needs_attention', errorCode: 'IMPORT_EVIDENCE_UNAVAILABLE' });
  const app = bulkApp();
  const first = await state();
  const download = await request(app).get(`/api/inbound-orders/${id}/files/${archive.id}/download`);
  expect(download.status).toBe(200);
  expect(download.headers['content-disposition']).toContain('Archive.zip');
  const unsupported = await request(app).post(`/api/inbound-orders/${id}/archives/${archive.id}/extracted-files`)
    .field('expectedEvidenceFingerprint', first.fingerprint).field('role', 'artwork')
    .attach('file', Buffer.from('PK\x03\x04nested'), { filename: 'Nested.zip', contentType: 'application/zip' });
  expect(unsupported.status).toBe(409);
  expect((await repo.listFiles(org, id))).toHaveLength(1);
  const missingToken = await request(app).post(`/api/inbound-orders/${id}/archives/${archive.id}/extracted-files`)
    .field('role', 'artwork')
    .attach('file', Buffer.from('%PDF-1.4\nfixture'), { filename: 'Front.pdf', contentType: 'application/pdf' });
  expect(missingToken.status).toBe(400);
  expect((await repo.listFiles(org, id))).toHaveLength(1);
  const upload = await request(app).post(`/api/inbound-orders/${id}/archives/${archive.id}/extracted-files`)
    .field('expectedEvidenceFingerprint', first.fingerprint).field('role', 'artwork')
    .attach('file', Buffer.from('%PDF-1.4\nsynthetic extracted artwork'), { filename: 'Front.pdf', contentType: 'application/pdf' });
  expect(upload.status).toBe(200);
  const extracted = upload.body.data.file;
  expect(extracted).toMatchObject({ status: 'available', role: 'artwork', metadataJson: { extractedFromArchiveFileId: archive.id } });
  const replay = await request(app).post(`/api/inbound-orders/${id}/archives/${archive.id}/extracted-files`)
    .field('expectedEvidenceFingerprint', first.fingerprint).field('role', 'artwork')
    .attach('file', Buffer.from('%PDF-1.4\nsynthetic extracted artwork'), { filename: 'Front.pdf', contentType: 'application/pdf' });
  expect(replay.status).toBe(409);
  expect((await repo.listFiles(org, id))).toHaveLength(2);
  expect(unavailableInboundImportFiles((await state()).files).map((file) => file.id)).toContain(archive.id);
  await expect(repo.assertImportComplete(org, id)).rejects.toThrow();
  const current = await state();
  const incompleteDraft = await draft(current.fingerprint);
  const stale = await request(app).post(`/api/inbound-orders/${id}/archives/${archive.id}/resolve`).send({
    expectedEvidenceFingerprint: first.fingerprint, fileIds: [extracted.id], contentsReviewed: true,
  });
  expect(stale.status).toBe(409);
  const reviewed = await request(app).post(`/api/inbound-orders/${id}/archives/${archive.id}/resolve`).send({
    expectedEvidenceFingerprint: current.fingerprint, fileIds: [extracted.id], contentsReviewed: true,
  });
  expect(reviewed.status).toBe(200);
  expect(reviewed.body.data.evidenceFingerprint).not.toBe(current.fingerprint);
  await expect(approve(incompleteDraft)).rejects.toThrow();
  expect((await repo.getLatestReviewSnapshot(org, id))?.payloadJson?.reviewNotes).toBe('Staff edited: retain this text');
  expect((await repo.getFile(org, id, archive.id))?.status).toBe('quarantined');
  expect(archiveResolution((await repo.getFile(org, id, archive.id))!, (await state()).files)?.fileIds).toEqual([extracted.id]);
  expect((await record())?.normalizedPayloadJson?.importIncomplete).toBe(false);
  expect((await db.select().from(schema.inboundEmailImportJobs).where(eq(schema.inboundEmailImportJobs.inboundRecordId, id)))[0].status).toBe('complete');
  await repo.assertImportComplete(org, id);
  const events = await repo.listEvents(org, id);
  expect(events.map((item) => item.eventType)).toContain('archive.evidence_reviewed');
  expect(events.map((item) => item.eventType)).toContain('archive.extracted_file_uploaded');
  const repeat = await request(app).post(`/api/inbound-orders/${id}/archives/${archive.id}/resolve`).send({
    expectedEvidenceFingerprint: (await state()).fingerprint, fileIds: [extracted.id], contentsReviewed: true,
  });
  expect(repeat.status).toBe(200);
  expect((await repo.listEvents(org, id)).filter((item) => item.eventType === 'archive.evidence_reviewed')).toHaveLength(1);
  const foreignApp = bulkApp(`foreign-${randomUUID()}`);
  const crossTenant = await request(foreignApp).post(`/api/inbound-orders/${id}/archives/${archive.id}/resolve`).send({
    expectedEvidenceFingerprint: (await state()).fingerprint, fileIds: [extracted.id], contentsReviewed: true,
  });
  expect(crossTenant.status).toBe(409);
  const additional = await inboundArchiveResolutionService.uploadExtractedFile({ organizationId: org, inboundRecordId: id,
    archiveFileId: archive.id, actorUserId: user, expectedEvidenceFingerprint: (await state()).fingerprint,
    filename: 'Additional.pdf', mimeType: 'application/pdf', role: 'reference', buffer: Buffer.from('%PDF-1.4\nadditional evidence') });
  expect(archiveResolution((await repo.getFile(org, id, archive.id))!, (await state()).files)).toBeNull();
  await expect(repo.assertImportComplete(org, id)).rejects.toThrow();
  await inboundArchiveResolutionService.resolveArchive({ organizationId: org, inboundRecordId: id,
    archiveFileId: archive.id, actorUserId: user, expectedEvidenceFingerprint: additional.evidenceFingerprint,
    fileIds: [extracted.id, additional.file.id], contentsReviewed: true });
  expect(archiveResolution((await repo.getFile(org, id, archive.id))!, (await state()).files)?.fileIds).toHaveLength(2);
  await repo.updateFile({ organizationId: org, inboundRecordId: id, fileId: extracted.id, patch: { checksum: 'changed-extracted-bytes' } });
  expect(archiveResolution((await repo.getFile(org, id, archive.id))!, (await state()).files)).toBeNull();
  const changed = await repo.updateFile({ organizationId: org, inboundRecordId: id, fileId: archive.id, patch: { checksum: 'changed-archive-bytes' } });
  expect(changed?.status).toBe('quarantined');
  expect(archiveResolution(changed!, (await state()).files)).toBeNull();
  await expect(repo.assertImportComplete(org, id)).rejects.toThrow();
  expect(archiveEvidenceIdentity(changed!)).not.toBe(archiveEvidenceIdentity(archive));
});

test('archive resolution does not clear a separate unavailable document', async () => {
  await configureArchiveTestStorage();
  const archive = await syntheticStoredArchive();
  await repo.createFile({ organizationId: org, inboundRecordId: id, sourceFilename: 'Missing-PO.pdf', role: 'po', status: 'uploaded',
    providerMessageId: 'synthetic-message', providerAttachmentId: 'missing-po', metadataJson: { attachmentState: 'download_failed' } });
  const initial = await state();
  const uploaded = await inboundArchiveResolutionService.uploadExtractedFile({ organizationId: org, inboundRecordId: id,
    archiveFileId: archive.id, actorUserId: user, expectedEvidenceFingerprint: initial.fingerprint,
    filename: 'Specification.pdf', mimeType: 'application/pdf', role: 'reference', buffer: Buffer.from('%PDF-1.4\nfixture') });
  const resolved = await inboundArchiveResolutionService.resolveArchive({ organizationId: org, inboundRecordId: id,
    archiveFileId: archive.id, actorUserId: user, expectedEvidenceFingerprint: uploaded.evidenceFingerprint,
    fileIds: [uploaded.file.id], contentsReviewed: true });
  expect(resolved.remainingUnresolvedFileIds).toHaveLength(1);
  expect(unavailableInboundImportFiles((await state()).files).map((file) => file.sourceFilename)).toEqual(['Missing-PO.pdf']);
  await expect(repo.assertImportComplete(org, id)).rejects.toThrow();
});

// Wait for a PostgreSQL-observed lock waiter, never for a guessed sleep. The
// deadline fails diagnostically if the participant does not use the protocol.
async function waitForBlocked(pid: number) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    const result = await pool.query('select 1 from pg_locks where pid=$1 and not granted', [pid]);
    if (result.rowCount) return;
    await setImmediate();
  }
  throw new Error('Participant did not wait on the expected PostgreSQL lock');
}
async function blockedByEvidence<T>(action: (repository: InboundOrdersRepository) => Promise<T>, whileBlocked: () => Promise<void>) {
  const holder = await pool.connect(), participant = await secondPool.connect();
  let pending: Promise<T> | undefined;
  try {
    await holder.query('begin');
    await holder.query('select pg_advisory_xact_lock(hashtext($1))', [`inbound-evidence:${org}`]);
    const { rows } = await participant.query('select pg_backend_pid() as pid');
    pending = action(new InboundOrdersRepository(drizzle(participant, { schema }) as any));
    // Attach rejection handler immediately while the actual promise remains awaited below.
    void pending.catch(() => undefined);
    await waitForBlocked(rows[0].pid);
    await whileBlocked();
    await holder.query('commit');
    return await pending;
  } finally {
    await holder.query('rollback');
    if (pending) await pending.catch(() => undefined);
    holder.release(); participant.release();
  }
}

test('0240 has its real unique indexes, lease invariant and foreign keys', async () => {
  const result = await pool.query(`select indexname from pg_indexes where tablename='inbound_email_processing_jobs'`);
  expect(result.rows.map(row => row.indexname)).toEqual(expect.arrayContaining(['inbound_email_processing_evidence_uidx', 'inbound_email_processing_claim_idx', 'inbound_email_processing_record_idx']));
  await importEmail();
  await expect(db.update(schema.inboundEmailProcessingJobs).set({ status: 'processing' }).where(eq(schema.inboundEmailProcessingJobs.organizationId, org))).rejects.toThrow();
  const constraints = await pool.query(`select contype from pg_constraint where conrelid='inbound_email_processing_jobs'::regclass`);
  expect(constraints.rows.filter(row => row.contype === 'f')).toHaveLength(3);
});
test('concurrent completed imports schedule exactly one durable job', async () => {
  await Promise.all([importEmail(), other.completeEmailImport(org, id, user), importEmail()]);
  expect(await jobs()).toHaveLength(1); expect((await jobs())[0].attempts).toBe(0);
});
test('competing initial draft writes commit exactly one editable snapshot',async()=>{
  const outcomes=await Promise.allSettled([draft(),draft()]);
  expect(outcomes.filter(result=>result.status==='fulfilled')).toHaveLength(1);
  expect(outcomes.filter(result=>result.status==='rejected')).toHaveLength(1);
  expect(await repo.listReviewSnapshots(org,id)).toHaveLength(1);
});
test('competing real connections claim one owner and skip a locked candidate', async () => {
  await importEmail();
  const holder = await pool.connect();
  try {
    await holder.query('begin'); await holder.query('select id from inbound_email_processing_jobs where organization_id=$1 for update', [org]);
    expect(await competing.claim()).toBeNull();
    await holder.query('commit');
    const claims = await Promise.all([queue.claim(), competing.claim()]);
    expect(claims.filter(Boolean)).toHaveLength(1); expect((await jobs())[0].attempts).toBe(1);
  } finally { await holder.query('rollback'); holder.release(); }
});
test('expired claim recovers and fences old heartbeat, finish and draft publication', async () => {
  await importEmail(); const first = (await queue.claim())!; await expire(first);
  const replacement = (await competing.claim())!;
  expect(replacement.claimToken).not.toBe(first.claimToken); expect(replacement.attempts).toBe(2);
  expect(await queue.heartbeat(first)).toBe(false); expect(await queue.finish(first, 'review_ready')).toEqual([]);
  const attempt = await repo.createParseAttempt({ organizationId: org, inboundOrderRecordId: id, status: 'success', rawResponse: { inboundEvidenceFingerprint: first.evidenceFingerprint } });
  await expect(repo.createReviewSnapshotWithEvent({ snapshot: { organizationId: org, inboundRecordId: id, snapshotType: 'approval', payloadJson: {} },
    evidenceSourceParseAttemptId: attempt.id, automaticProcessing: claimArgs(first), event })).rejects.toBeInstanceOf(InboundEvidenceConflictError);
  expect(await repo.listReviewSnapshots(org, id)).toHaveLength(0);
});
test('abandoned claims stop after three attempts and staff retry is bounded and audited', async () => {
  await importEmail();
  for (let n=1;n<=3;n++) { const job=(await queue.claim())!; expect(job.attempts).toBe(n); await expire(job); }
  expect(await competing.claim()).toBeNull(); expect((await jobs())[0]).toMatchObject({ status: 'failed', errorCode: 'ABANDONED_CLAIM_LIMIT' });
  await repo.retryEmailProcessing(org, id, user);
  await expect(repo.retryEmailProcessing(org, id, user)).rejects.toThrow();
  expect((await queue.claim())?.attempts).toBe(1);
  expect((await repo.listEvents(org,id)).filter(e=>e.eventType==='email.automatic_processing_retry')).toHaveLength(1);
});
test('provider failures persist retry backoff and terminal failure without waiting for the clock', async () => {
  await importEmail();
  for(let n=1;n<=3;n++) {
    const job=(await queue.claim())!; await queue.fail(job);
    expect(await competing.claim()).toBeNull();
    expect((await jobs())[0].status).toBe(n===3?'failed':'waiting');
    if(n<3) await db.update(schema.inboundEmailProcessingJobs).set({nextAttemptAt:new Date(0)}).where(eq(schema.inboundEmailProcessingJobs.id,job.id));
  }
});
test('new evidence supersedes active work and preserves the newer waiting job', async () => {
  await importEmail(); const old=(await queue.claim())!; await change(other);
  expect(await jobs()).toHaveLength(2);
  expect((await jobs()).find(job=>job.id===old.id)?.status).toBe('superseded');
  await expect(repo.updateRecordWithEvent({ ...identity(), automaticProcessing:claimArgs(old), patch:{parsedAt:new Date()}, event })).rejects.toThrow();
  expect((await jobs()).find(job=>job.evidenceFingerprint!==old.evidenceFingerprint)?.status).toBe('waiting');
});
test('email and attachment changes retain staff edits and invalidate approval and both conversion claims', async () => {
  await importEmail(); const saved=await draft(); const prior=saved.payloadJson;
  await change(); await repo.createFile({ organizationId:org,inboundRecordId:id,sourceFilename:'revision.txt',checksum:'changed-content' });
  expect((await repo.listReviewSnapshots(org,id))[0].payloadJson).toEqual(prior);
  await expect(approve(saved)).rejects.toThrow();
  await expect(repo.claimInboundOrderForOrderConversion({...identity(),actorUserId:user,snapshotId:saved.id})).rejects.toThrow();
  await expect(repo.createQuoteDraftFromInboundReview(org,{...identity(),snapshotId:saved.id} as any)).rejects.toThrow();
  const currentFingerprint=(await state()).fingerprint;
  expect((await jobs()).find(job=>job.evidenceFingerprint===currentFingerprint)?.status).toBe('needs_attention');
});
test('current tracked evidence can approve and claim the existing conversion path', async () => {
  const saved=await draft(); const ready=await approve(saved);
  expect(await repo.claimInboundOrderForOrderConversion({...identity(),actorUserId:user,snapshotId:ready.snapshot.id})).toMatchObject({ status:'processing',reviewOutcome:'order_conversion_requested' });
});
test('legacy drafts cannot acquire coverage through ordinary saves or approval', async () => {
  const saved=await draft(null); await expect(approve(saved)).rejects.toThrow();
  expect((await repo.listReviewSnapshots(org,id))[0].payloadJson.metadata).toMatchObject({evidenceFingerprint:null});
});
test('approval waits for the evidence lock and rejects evidence committed before it acquires it', async () => {
  const saved=await draft();
  await expect(blockedByEvidence(r=>approve(saved,r),async()=>{
    // Writer uses the same lock-holding connection in this controlled transaction.
    // The public writer is separately proven to wait on this protocol below.
    await pool.query(`update inbound_order_records set raw_payload_json='{"bodyText":"Changed while approval waited"}' where id=$1`,[id]);
  })).rejects.toThrow();
  expect(await repo.listReviewSnapshots(org,id)).toHaveLength(1);
});
test('evidence writers participate in the same PostgreSQL advisory locking protocol', async () => {
  await blockedByEvidence(r=>change(r),async()=>{ expect((await record())?.rawPayloadJson).toMatchObject({bodyText:'Please review this request'}); });
  expect((await state()).record.rawPayloadJson.bodyText).toBe('Revised request');
});
test('an evidence writer waiting behind approval reopens review after that approval commits', async () => {
  const saved=await draft();
  const holder=await pool.connect(),participant=await secondPool.connect();
  let pending:Promise<unknown>|undefined;
  try {
    // Pass a real Drizzle transaction, so the canonical nested operation uses
    // a SAVEPOINT rather than issuing COMMIT on a raw client's outer BEGIN.
    await drizzle(holder as unknown as import('pg').PoolClient,{schema}).transaction(async tx=>{
      const approved=await approve(saved,new InboundOrdersRepository(tx as any));
      expect(approved.snapshot.payloadJson.status).toBe('ready_to_convert');
      const {rows}=await participant.query('select pg_backend_pid() as pid');
      pending=change(new InboundOrdersRepository(drizzle(participant,{schema}) as any));void pending.catch(()=>undefined);
      await waitForBlocked(rows[0].pid);
    });
    await pending;
    expect(await record()).toMatchObject({status:'needs_review',approvedAt:null});
    expect((await repo.listReviewSnapshots(org,id))[0].payloadJson.reviewNotes).toBe(saved.payloadJson.reviewNotes);
  } finally {await holder.query('rollback');if(pending)await pending.catch(()=>undefined);holder.release();participant.release();}
});
test('a conversion claim blocked by a committed revision fails without a partial status change', async () => {
  const saved=await draft(); const ready=await approve(saved);
  await expect(blockedByEvidence(r=>r.claimInboundOrderForOrderConversion({...identity(),actorUserId:user,snapshotId:ready.snapshot.id}),async()=>{
    await pool.query(`update inbound_order_records set raw_payload_json='{"bodyText":"Revision"}' where id=$1`,[id]);
  })).rejects.toThrow();
  expect((await record())?.reviewOutcome).not.toBe('order_conversion_requested');
});
test('dismissal is audited once, attachment revisions reopen it, and stale resolutions reject', async () => {
  const fp=(await state()).fingerprint; await Promise.all([dismiss(fp),dismiss(fp,other)]);
  expect((await repo.listEvents(org,id)).filter(e=>e.eventType==='review.ignored')).toHaveLength(1);
  expect(await repo.listRecords(org,{statusGroup:'active',limit:100,offset:0})).toHaveLength(0);
  await repo.createFile({organizationId:org,inboundRecordId:id,sourceFilename:'PO.txt',checksum:'revision'});
  await expect(dismiss(fp)).rejects.toThrow();
  expect(await repo.listRecords(org,{statusGroup:'active',limit:100,offset:0})).toHaveLength(1);
});

test('bulk route removes distinct current and legacy email evidence without deleting source, files or audit', async () => {
  const secondId = randomUUID();
  await db.insert(schema.inboundOrderRecords).values({ id: secondId, organizationId: org, sourceType: 'email', status: 'needs_review',
    sourceMessageId: `gmail-${secondId}`, rawPayloadJson: { subject: 'Second synthetic request', bodyText: 'Second email' } });
  await repo.createFile({ organizationId: org, inboundRecordId: secondId, sourceFilename: 'source.pdf', checksum: 'unchanged-source' });
  const service = new InboundOrderService(repo);
  const listed = await service.listRecords({ organizationId: org, filters: { statusGroup: 'active', limit: 100, offset: 0 } });
  const tokens = Object.fromEntries(listed.records.map(record => [record.id, (record.normalizedPayloadJson as any)?.evidenceFingerprint]));
  expect(tokens[id]).toMatch(/^v1:/);
  expect(tokens[secondId]).toMatch(/^v1:/);
  expect(tokens[id]).not.toBe(tokens[secondId]);
  expect((await repo.getRecord(org, id))?.normalizedPayloadJson?.evidenceFingerprint).toBe(tokens[id]);

  const app = bulkApp();
  const response = await bulkDelete(app, [id, secondId], tokens);
  expect(response.status).toBe(200);
  expect(response.body.data).toMatchObject({ updatedIds: [id, secondId], emailsProcessed: 2, emailsSkipped: 0, actualErrors: [] });
  expect(await repo.listRecords(org, { statusGroup: 'active', limit: 100, offset: 0 })).toHaveLength(0);
  expect(await repo.getRecord(org, secondId)).toMatchObject({ sourceMessageId: `gmail-${secondId}`, rawPayloadJson: { subject: 'Second synthetic request', bodyText: 'Second email' }, status: 'terminal', reviewOutcome: 'deleted' });
  expect(await repo.listFiles(org, secondId)).toHaveLength(1);
  expect((await repo.listEvents(org, secondId)).filter(event => event.eventType === 'review.queue_deleted')).toHaveLength(1);
  await repo.completeEmailImport(org, secondId, user); // Unchanged rediscovery must not reopen the dismissed evidence.
  expect(await repo.listRecords(org, { statusGroup: 'active', limit: 100, offset: 0 })).toHaveLength(0);
  const repeated = await bulkDelete(app, [secondId], { [secondId]: tokens[secondId] });
  expect(repeated.body.data).toMatchObject({ emailsProcessed: 1, emailsSkipped: 0 });
  expect((await repo.listEvents(org, secondId)).filter(event => event.eventType === 'review.queue_deleted')).toHaveLength(1);
  await repo.createFile({ organizationId: org, inboundRecordId: secondId, sourceFilename: 'revision.pdf', checksum: 'new-evidence' });
  await repo.getEvidenceState(org, secondId);
  expect((await repo.getRecord(org, secondId))?.reviewOutcome).toBe('new_evidence_requires_review');
  expect(await repo.listRecords(org, { statusGroup: 'active', limit: 100, offset: 0 })).toHaveLength(1);
});

test('bulk route keeps stale and foreign-tenant rows while removing only current evidence', async () => {
  const secondId = randomUUID();
  await db.insert(schema.inboundOrderRecords).values({ id: secondId, organizationId: org, sourceType: 'email', status: 'needs_review',
    rawPayloadJson: { subject: 'Synthetic stale request', bodyText: 'Original' } });
  const first = (await repo.getEvidenceState(org, id)).fingerprint;
  const stale = (await repo.getEvidenceState(org, secondId)).fingerprint;
  await repo.updateRecordWithEvent({ organizationId: org, inboundRecordId: secondId,
    patch: { rawPayloadJson: { subject: 'Synthetic stale request', bodyText: 'Changed' } },
    event: { actorType: 'system', eventType: 'email.updated' } });
  const response = await bulkDelete(bulkApp(), [id, secondId], { [id]: first, [secondId]: stale });
  expect(response.status).toBe(200);
  expect(response.body.data).toMatchObject({ updatedIds: [id], emailsProcessed: 1, emailsSkipped: 1 });
  expect(response.body.data.actualErrors[0]).toMatchObject({ id: secondId });
  expect((await repo.getRecord(org, secondId))?.status).toBe('needs_review');
  const foreign = await bulkDelete(bulkApp(`foreign-${randomUUID()}`), [secondId], { [secondId]: stale });
  expect(foreign.body.data).toMatchObject({ updatedIds: [], emailsProcessed: 0, emailsSkipped: 1 });
  expect((await repo.listEvents(org, secondId)).filter(event => event.eventType === 'review.queue_deleted')).toHaveLength(0);
});

test('bulk route rejects evidence changed while disposition waits on the PostgreSQL evidence lock', async () => {
  const fingerprint = (await repo.getEvidenceState(org, id)).fingerprint;
  const response = await blockedByEvidence(async repository => bulkDelete(bulkApp(org, repository), [id], { [id]: fingerprint }), async () => {
    await pool.query('update inbound_order_records set raw_payload_json = $1 where id = $2 and organization_id = $3',
      [JSON.stringify({ subject: 'Concurrent revision', bodyText: 'New source evidence' }), id, org]);
  });
  expect(response.body.data).toMatchObject({ updatedIds: [], emailsProcessed: 0, emailsSkipped: 1 });
  expect((await repo.getRecord(org, id))?.status).toBe('needs_review');
  expect((await repo.listEvents(org, id)).filter(event => event.eventType === 'review.queue_deleted')).toHaveLength(0);
});

test('bulk route cannot remove a converted record or its Order', async () => {
  const [order] = await db.insert(schema.orders).values({ organizationId: org, orderNumber: 'BULK-TEST-ORDER', createdByUserId: user }).returning();
  await db.update(schema.inboundOrderRecords).set({ createdOrderId: order.id, status: 'submitted' }).where(and(
    eq(schema.inboundOrderRecords.organizationId, org), eq(schema.inboundOrderRecords.id, id),
  ));
  const fingerprint = (await repo.getEvidenceState(org, id)).fingerprint;
  const response = await bulkDelete(bulkApp(), [id], { [id]: fingerprint });
  expect(response.body.data).toMatchObject({ updatedIds: [], emailsProcessed: 0, emailsSkipped: 1 });
  expect((await repo.getRecord(org, id))?.createdOrderId).toBe(order.id);
  expect(await db.select().from(schema.orders).where(eq(schema.orders.id, order.id))).toHaveLength(1);
  expect((await repo.listEvents(org, id)).filter(event => event.eventType === 'review.queue_deleted')).toHaveLength(0);
});
test('failed event persistence rolls back draft insertion, approval and evidence metadata', async () => {
  const saved=await draft(); const before=await record();
  await expect(repo.createReviewSnapshotWithEvent({snapshot:{organizationId:org,inboundRecordId:id,snapshotType:'approval',payloadJson:{...saved.payloadJson,status:'ready_to_convert'}},
    evidenceSourceSnapshotId:saved.id,recordPatch:{status:'ready'},event:{...event,actorUserId:'nonexistent-user-for-fk-failure'}})).rejects.toThrow();
  expect(await repo.listReviewSnapshots(org,id)).toHaveLength(1); expect(await record()).toEqual(before);
});
test('foreign tenant cannot read evidence, schedule, retry, approve, dismiss or inspect work', async () => {
  await importEmail(); const saved=await draft();
  const foreign=`foreign-${randomUUID()}`;
  await expect(repo.getEvidenceState(foreign,id)).rejects.toThrow();
  await expect(repo.completeEmailImport(foreign,id,user)).rejects.toThrow();
  await expect(repo.retryEmailProcessing(foreign,id,user)).rejects.toThrow();
  expect(await repo.updateRecordWithEvent({organizationId:foreign,inboundRecordId:id,patch:{status:'ignored'},event})).toBeNull();
  await expect(repo.createReviewSnapshotWithEvent({snapshot:{organizationId:foreign,inboundRecordId:id,snapshotType:'approval',payloadJson:saved.payloadJson},event})).rejects.toThrow();
  expect((await queue.view(foreign,id,(await state()).fingerprint)).job).toBeNull();
});

function deferred() { let resolve!:()=>void; const promise=new Promise<void>(r=>{resolve=r;}); return {promise,resolve}; }
function worker(provider: any) {
  const parser=new InboundOrderParsingService(repo,()=>provider,{buildEvidenceBundle:async()=>({items:[],conflicts:[]})} as any);
  return new InboundEmailProcessingWorker(queue,repo,parser,new InboundOrderService(repo),{getSettings:async()=>({inboundEmailIntakeEnabled:true})} as any);
}
const uncertain=()=>inboundOrderParsedDraftSchema.parse({customer:{},order:{},lineItems:[],artwork:[],globalWarnings:[{code:'possible_revision',severity:'warning',message:'Review synthetic request'}],missingDecisions:[]});
test('real worker/parser/draft path publishes one editable uncertain draft with external AI stubbed',async()=>{
  await importEmail(); const output=uncertain();
  const provider={generateJson:jest.fn(async()=>({provider:'stub',model:'synthetic',rawText:JSON.stringify(output),parsed:output}))};
  await worker(provider).runOnce(1);
  expect(provider.generateJson).toHaveBeenCalledTimes(1);
  expect(await repo.listReviewSnapshots(org,id)).toHaveLength(1);
  expect((await jobs())[0].status).toBe('needs_attention');
  expect(await record()).toMatchObject({status:'needs_review',createdOrderId:null,createdQuoteId:null});
  await importEmail(); await worker(provider).runOnce(1);
  expect(await repo.listReviewSnapshots(org,id)).toHaveLength(1); expect(provider.generateJson).toHaveBeenCalledTimes(1);
});
test('restart after tracked parse persistence reuses the parse and never calls AI again',async()=>{
  await importEmail();const first=(await queue.claim())!;const output=uncertain();
  await repo.createParseAttempt({organizationId:org,inboundOrderRecordId:id,status:'success',parsedDraft:output as any,
    rawResponse:{inboundEvidenceFingerprint:first.evidenceFingerprint}});
  await expire(first);
  const provider={generateJson:jest.fn(async()=>{throw new Error('Should reuse the persisted parse');})};
  await worker(provider).runOnce(1);
  expect(provider.generateJson).not.toHaveBeenCalled();expect(await repo.listReviewSnapshots(org,id)).toHaveLength(1);
  expect((await jobs())[0]).toMatchObject({status:'needs_attention',attempts:2});
});
test('provider barrier allows evidence commit during AI call; late parse cannot cover the revision',async()=>{
  await importEmail(); const entered=deferred(),release=deferred(); const output=uncertain();
  const running=worker({generateJson:async()=>{entered.resolve();await release.promise;return{provider:'stub',model:'synthetic',rawText:JSON.stringify(output),parsed:output};}}).runOnce(1);
  try { await entered.promise; await change(other); } finally {release.resolve();}
  await running;
  expect(await repo.listReviewSnapshots(org,id)).toHaveLength(0);
  const currentFingerprint=(await state()).fingerprint;
  expect((await jobs()).find(job=>job.evidenceFingerprint===currentFingerprint)?.status).toBe('waiting');
  expect((await state()).record.status).toBe('needs_review');
});
test('rollout disabled leaves durable waiting work and never calls the provider',async()=>{
  await importEmail(); delete process.env.WORKER_INBOUND_EMAIL_DRAFTS_ENABLED;
  const provider={generateJson:jest.fn()}; expect(await worker(provider).runOnce()).toEqual({processed:0});
  expect(provider.generateJson).not.toHaveBeenCalled();expect((await jobs())[0].status).toBe('waiting');
});
test('killed worker process leaves a durable recoverable lease; a new worker publishes one draft',async()=>{
  await importEmail();
  const childEnv:NodeJS.ProcessEnv={...process.env,INBOUND_TEST_CRASH_CHILD:'true'};
  for(const key of ['DATABASE_URL','MIGRATION_DATABASE_URL','DIRECT_DATABASE_URL']) delete childEnv[key];
  const child=spawn(process.execPath,['node_modules/jest/bin/jest.js','--config','jest.inbound-postgres.config.js','--runInBand',
    '--testMatch','**/inboundWorkerCrash.postgres.child.ts','--runTestsByPath','server/tests/helpers/inboundWorkerCrash.postgres.child.ts'],
    {cwd:process.cwd(),env:childEnv,windowsHide:true,stdio:['ignore','pipe','pipe']});
  let entered=false,output='';
  const closed=new Promise<void>(resolve=>child.once('close',()=>resolve()));
  let deadline:ReturnType<typeof setTimeout>;
  try {
    await new Promise<void>((resolve,reject)=>{
      deadline=setTimeout(()=>reject(new Error('Child worker did not reach its stub provider boundary')),20000);
      child.stdout.on('data',chunk=>{output+=String(chunk);if(output.includes('INBOUND_TEST_PROVIDER_ENTERED')){entered=true;resolve();}});
      child.stderr.resume();
      child.once('error',reject);child.once('exit',()=>{if(!entered)reject(new Error('Child worker exited before its stub provider boundary'));});
    }).finally(()=>clearTimeout(deadline!));
    const abandoned=(await jobs())[0];expect(abandoned.status).toBe('processing');
    child.kill('SIGKILL');await closed;
    expect((await jobs())[0]).toMatchObject({status:'processing',claimToken:abandoned.claimToken});
    await expire(abandoned); // Advance the persisted lease deterministically.
    const restartedDraft=uncertain();
    await worker({generateJson:async()=>({provider:'stub',model:'restarted',rawText:JSON.stringify(restartedDraft),parsed:restartedDraft})}).runOnce(1);
    expect((await jobs())[0]).toMatchObject({status:'needs_attention',attempts:2});
    expect(await repo.listReviewSnapshots(org,id)).toHaveLength(1);
    expect(await record()).toMatchObject({createdOrderId:null,status:'needs_review'});
  } finally {child.kill('SIGKILL');await closed;}
},40000);

async function linkedQuote() {
  const customerId=randomUUID(), productId=randomUUID();
  await db.insert(schema.customers).values({id:customerId,organizationId:org,companyName:'Synthetic acceptance customer',creditLimit:'1000000',creditLimitConfiguredAt:new Date()});
  await db.insert(schema.products).values({id:productId,organizationId:org,name:'Synthetic item',description:'Isolated test fixture',requiresProductionJob:false,requiresProofApproval:false});
  const quote=await new QuotesRepository(db).createQuote(org,{
    userId:user,customerId,customerName:'Synthetic acceptance customer',source:'internal',status:'draft',subtotal:10,taxAmount:0,taxableSubtotal:10,totalPrice:10,
    lineItems:[{productId,productName:'Synthetic item',quantity:1,width:12,height:18,selectedOptions:[],linePrice:10,
      priceBreakdown:{basePrice:10,optionsPrice:0,total:10,formula:'test'},pbv2SnapshotJson:{},taxAmount:0,isTaxableSnapshot:true,requiresDesign:false,requiresPrepress:false}],
  } as any);
  const fp=(await state()).fingerprint;
  // Synthetic provenance represents a Quote prepared from this version. Actual
  // conversion below uses the unchanged canonical Order repository operation.
  await db.update(schema.inboundOrderRecords).set({createdQuoteId:quote.id,status:'submitted',
    normalizedPayloadJson:{evidenceFingerprint:fp,quoteEvidenceFingerprint:fp}}).where(eq(schema.inboundOrderRecords.id,id));
  return quote;
}
const convert=(quoteId:string,database:any=db)=>new OrdersRepository(database).convertQuoteToOrder(org,quoteId,user,{productionIntakePolicy:'deferred'});
test('quote-only records stay pending and real SQL counts and filters agree',async()=>{
  await linkedQuote();
  await repo.markLinkedQuoteCompleted({organizationId:org,quoteId:(await record())!.createdQuoteId!,quoteStatus:'active',completionSource:'quote_staff_approval'});
  const summary=await repo.getQueueSummary(org);
  expect(summary.waitingOnCustomer).toBe(1); expect(summary.convertedSubmitted).toBe(0);
  expect(await repo.listRecords(org,{statusGroup:'active',limit:100,offset:0})).toHaveLength(1);
  expect(await repo.listRecords(org,{statusGroup:'waiting',limit:100,offset:0})).toHaveLength(summary.waitingOnCustomer);
});
test('canonical concurrent Quote conversion links one Order and resolves only its covered evidence',async()=>{
  const quote=await linkedQuote();
  const [a,b]=await Promise.all([convert(quote.id),convert(quote.id,secondDb)]);
  expect(a.id).toBe(b.id);
  expect(await record()).toMatchObject({createdOrderId:a.id,status:'submitted'});
  expect(await repo.listRecords(org,{statusGroup:'active',limit:100,offset:0})).toHaveLength(0);
  expect((await repo.getQueueSummary(org)).convertedSubmitted).toBe(1);
  await state(); expect((await record())?.status).toBe('submitted');
  await change(other);
  expect(await record()).toMatchObject({createdOrderId:a.id,status:'needs_review'});
  await convert(quote.id);
  expect(await repo.listRecords(org,{statusGroup:'active',limit:100,offset:0})).toHaveLength(1);
  expect(await db.select().from(schema.orders).where(eq(schema.orders.organizationId,org))).toHaveLength(1);
  expect((await new OrdersRepository(db).getOrderById(org,a.id))?.lineItems).toHaveLength(1);
});

test('reviewed extracted PO and specification files reach a QA Order once without linking the ZIP', async () => {
  await configureArchiveTestStorage();
  const archive = await syntheticStoredArchive();
  let fingerprint = (await state()).fingerprint;
  const po = await inboundArchiveResolutionService.uploadExtractedFile({ organizationId: org, inboundRecordId: id,
    archiveFileId: archive.id, actorUserId: user, expectedEvidenceFingerprint: fingerprint,
    filename: 'PO.pdf', mimeType: 'application/pdf', role: 'po', buffer: Buffer.from('%PDF-1.4\nPO fixture') });
  fingerprint = po.evidenceFingerprint;
  const specs = await inboundArchiveResolutionService.uploadExtractedFile({ organizationId: org, inboundRecordId: id,
    archiveFileId: archive.id, actorUserId: user, expectedEvidenceFingerprint: fingerprint,
    filename: 'Specs.pdf', mimeType: 'application/pdf', role: 'reference', buffer: Buffer.from('%PDF-1.4\nspec fixture') });
  const art = await inboundArchiveResolutionService.uploadExtractedFile({ organizationId: org, inboundRecordId: id,
    archiveFileId: archive.id, actorUserId: user, expectedEvidenceFingerprint: specs.evidenceFingerprint,
    filename: 'Art.pdf', mimeType: 'application/pdf', role: 'artwork', buffer: Buffer.from('%PDF-1.4\nart fixture') });
  await inboundArchiveResolutionService.resolveArchive({ organizationId: org, inboundRecordId: id,
    archiveFileId: archive.id, actorUserId: user, expectedEvidenceFingerprint: art.evidenceFingerprint,
    fileIds: [po.file.id, specs.file.id, art.file.id], contentsReviewed: true });
  const quote = await linkedQuote();
  const order = await convert(quote.id);
  const files = await repo.listFiles(org, id);
  const service = new InboundOrderService(repo, new OrdersRepository(db));
  const linkDocuments = async () => repo.transaction(async (tx, conversionRepository) =>
    (service as any).materializeReviewedArchiveDocumentsForOrder({ organizationId: org, inboundRecordId: id,
      actorUserId: user, files, order, conversionRepository, orderRepository: new OrdersRepository(tx as any) }));
  await linkDocuments();
  await linkDocuments();
  const attachments = await db.select().from(schema.orderAttachments).where(eq(schema.orderAttachments.orderId, order.id));
  expect(attachments).toHaveLength(3);
  expect(attachments.map((item) => item.role).sort()).toEqual(['customer_po', 'other', 'reference']);
  expect(attachments.map((item) => item.fileRecordId).sort()).toEqual([po.file.fileRecordId, specs.file.fileRecordId, art.file.fileRecordId].sort());
  expect(attachments.some((item) => item.fileRecordId === archive.fileRecordId)).toBe(false);
  expect((await repo.getFile(org, id, po.file.id))?.createdOrderAttachmentId).toBeTruthy();
  expect((await repo.getFile(org, id, specs.file.id))?.createdOrderAttachmentId).toBeTruthy();
  expect((await repo.getFile(org, id, art.file.id))?.createdOrderAttachmentId).toBeTruthy();
  expect((await repo.getFile(org, id, archive.id))?.status).toBe('quarantined');
  expect((await new OrdersRepository(db).getOrderById(org, order.id))?.id).toBe(order.id);
});
test('stale explicit Order attachment rejects; current attachment resolves the revision without changing the job',async()=>{
  const quote=await linkedQuote();const order=await convert(quote.id);const old=(await state()).fingerprint;
  const before=await db.select().from(schema.orderLineItems).where(eq(schema.orderLineItems.orderId,order.id));
  await repo.createFile({organizationId:org,inboundRecordId:id,sourceFilename:'new-evidence.txt',checksum:'new-evidence',
    metadataJson:{attachmentClassification:{source:'manual_override',classification:'OTHER'}}});
  const attach=(fingerprint:string)=>repo.updateRecordWithEvent({...identity(),expectedEvidenceFingerprint:fingerprint,
    patch:{status:'ignored',reviewOutcome:'attached_to_order',normalizedPayloadJson:{attachedOrderId:order.id}},
    event:{actorType:'user',actorUserId:user,eventType:'order.attached'}});
  await expect(attach(old)).rejects.toThrow();
  expect((await repo.getQueueSummary(org)).needsReview).toBe(1);
  const current=(await state()).fingerprint;await attach(current);await attach(current);
  expect(await repo.listRecords(org,{statusGroup:'active',limit:100,offset:0})).toHaveLength(0);
  expect((await repo.listEvents(org,id)).filter(e=>e.eventType==='order.attached')).toHaveLength(1);
  expect(await db.select().from(schema.orderLineItems).where(eq(schema.orderLineItems.orderId,order.id))).toEqual(before);
  expect(await db.select().from(schema.orders).where(eq(schema.orders.organizationId,org))).toHaveLength(1);
});
test('new evidence committed while canonical Quote conversion waits remains unresolved',async()=>{
  const quote=await linkedQuote(); const before=(await state()).fingerprint;
  await blockedByEvidence(async r=>r.transaction(async (tx)=>{
    return new OrdersRepository(tx as any).convertQuoteToOrder(org,quote.id,user,{productionIntakePolicy:'deferred'});
  }),async()=>{
    await pool.query(`update inbound_order_records set raw_payload_json='{"bodyText":"New Quote revision"}' where id=$1`,[id]);
  });
  expect(await record()).toMatchObject({status:'needs_review',normalizedPayloadJson:{quoteEvidenceFingerprint:before}});
  expect((await record())?.createdOrderId).toBeTruthy();
  expect((await repo.getQueueSummary(org)).needsReview).toBe(1);
});
test('failure after inbound linkage rolls back Order, lines, Quote linkage and inbound audit together',async()=>{
  const quote=await linkedQuote();const before=await record();
  const original=InboundOrdersRepository.prototype.markLinkedQuoteOrderConverted;
  const fault=jest.spyOn(InboundOrdersRepository.prototype,'markLinkedQuoteOrderConverted').mockImplementation(async function(this:InboundOrdersRepository,args){
    await original.call(this,args);throw new Error('Synthetic post-linkage failure');
  });
  try {await expect(convert(quote.id)).rejects.toThrow('Synthetic post-linkage failure');} finally {fault.mockRestore();}
  expect(await db.select().from(schema.orders).where(eq(schema.orders.organizationId,org))).toHaveLength(0);
  expect((await repo.getQuote(org,quote.id))?.convertedToOrderId).toBeNull();
  expect(await record()).toEqual(before);
  expect((await repo.listEvents(org,id)).filter(e=>e.eventType==='order.linked_from_quote')).toHaveLength(0);
});
test('merged parent Order context is exact and cannot cross tenant boundaries',async()=>{
  const quote=await linkedQuote(); const order=await convert(quote.id);
  const child=randomUUID();
  await db.insert(schema.inboundOrderRecords).values({id:child,organizationId:org,sourceType:'email',status:'needs_review',normalizedPayloadJson:{combinedParentRecordId:id}});
  expect(await repo.getRecord(org,child)).toMatchObject({linkedParentOrderId:order.id});
  const foreign=`foreign-${randomUUID()}`;
  await db.insert(schema.organizations).values({id:foreign,name:'Synthetic foreign tenant',slug:foreign});
  const foreignChild=randomUUID();
  await db.insert(schema.inboundOrderRecords).values({id:foreignChild,organizationId:foreign,sourceType:'email',status:'submitted',createdOrderId:order.id,normalizedPayloadJson:{combinedParentRecordId:id}});
  expect(await repo.getRecord(foreign,foreignChild)).toMatchObject({linkedParentOrderId:null,accountabilityBucket:'needs_review'});
  expect(await repo.listRecords(foreign,{statusGroup:'active',limit:100,offset:0})).toHaveLength(1);
});
