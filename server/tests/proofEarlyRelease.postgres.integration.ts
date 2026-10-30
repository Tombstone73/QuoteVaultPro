import { randomUUID } from 'node:crypto';
import express from 'express';
import request from 'supertest';
import { beforeAll, afterAll, expect, jest, test } from '@jest/globals';
import { and, eq } from 'drizzle-orm';
import { db } from '../db';
import { organizations, users, userOrganizations, customers, products, orders, orderLineItems, productionJobs, productionEvents, auditLogs, stations, prepressSessions, productionRuns, productionRunMembers, lineItemFiles, orderAttachments, lineItemProofVersions, lineItemProofEarlyReleases, lineItemArtwork, fileRecords, orderAuditLog, lineItemProofApprovals, proofVersionLineItems } from '../../shared/schema';
import { transitionLineItemWorkflowState } from '../services/lineItemWorkflowService';
import { resolveLineItemProofReleaseGate } from '../services/proofGateService';
import { lockWorkflowLines } from '../services/workflowMutationLock';
jest.unstable_mockModule('sharp', () => ({ default: () => { throw new Error('No image processing in synthetic workflow fixtures'); } }));
let org = '', actor = '', customer = '', product = '', app: express.Express;
let proofing: typeof import('../services/proofingService');
beforeAll(async () => {
  const suffix = randomUUID();
  [ { id: org } ] = await db.insert(organizations).values({ name: 'Synthetic Early Release', slug: 'early-release-' + suffix, settings: { preferences: { proofing: { policy: 'manual_requested_only' } } } } as any).returning();
  [ { id: actor } ] = await db.insert(users).values({ email: suffix + '@example.test', role: 'admin', firstName: 'Synthetic', lastName: 'Authorizer' }).returning();
  await db.insert(userOrganizations).values({ organizationId: org, userId: actor, role: 'admin' });
  [ { id: customer } ] = await db.insert(customers).values({ organizationId: org, companyName: 'Synthetic Customer', creditLimit: '100000', creditLimitConfiguredAt: new Date() }).returning();
  [ { id: product } ] = await db.insert(products).values({ organizationId: org, name: 'Synthetic Product', description: 'Test only' }).returning();
  await db.insert(stations).values(['prepress', 'flatbed', 'roll', 'design'].map(key => ({ id: randomUUID(), organizationId: org, key, name: key, active: true })));
  app = express(); app.use(express.json());
  const pass = (req: any, _res: any, next: any) => { req.organizationId = req.headers['x-test-org'] || org; req.orgRole = 'admin'; req.user = { id: actor, email: 'synthetic@example.test' }; next(); };
  const { registerOrderRoutes } = await import('../routes/orders.routes');
  await registerOrderRoutes(app, { isAuthenticated: pass, tenantContext: pass, isAdmin: pass, isAdminOrOwner: pass });
  const { registerProofingRoutes } = await import('../routes/proofing.routes');
  registerProofingRoutes(app, { isAuthenticated: pass, tenantContext: pass, isAdmin: pass, assertInternalUser: () => true });
  const { registerPrepressQueueRoutes } = await import('../routes/prepress.routes');
  registerPrepressQueueRoutes(app, { isAuthenticated: pass, tenantContext: pass, isAdminOrOwner: pass, assertInternalUser: () => true });
  proofing = await import('../services/proofingService');
}, 180000);
afterAll(async () => {
  if (org) {
    await db.delete(lineItemProofEarlyReleases).where(eq(lineItemProofEarlyReleases.organizationId, org));
    await db.delete(productionRunMembers).where(eq(productionRunMembers.organizationId, org));
    await db.delete(productionRuns).where(eq(productionRuns.organizationId, org));
    await db.delete(productionEvents).where(eq(productionEvents.organizationId, org));
    await db.delete(productionJobs).where(eq(productionJobs.organizationId, org));
    await db.delete(lineItemArtwork).where(eq(lineItemArtwork.organizationId, org));
    await db.delete(orders).where(eq(orders.organizationId, org));
    await db.delete(fileRecords).where(eq(fileRecords.organizationId, org));
    await db.delete(auditLogs).where(eq(auditLogs.organizationId, org));
    await db.delete(products).where(eq(products.organizationId, org));
    await db.delete(customers).where(eq(customers.organizationId, org));
    await db.delete(organizations).where(eq(organizations.id, org));
  }
  if (actor) await db.delete(users).where(eq(users.id, actor));
});
async function fixture(prepress = false) {
  const [order] = await db.insert(orders).values({ organizationId: org, customerId: customer, orderNumber: 'QA-' + randomUUID(), createdByUserId: actor, state: 'open', total: '10', subtotal: '10' } as any).returning();
  const [line] = await db.insert(orderLineItems).values({ orderId: order.id, productId: product, description: 'Synthetic early-release line', quantity: 1, unitPrice: '10', totalPrice: '10', productType: 'flatbed', requiresProofApproval: true, requiresPrepress: prepress, workflowState: 'new', status: 'new' } as any).returning();
  await db.transaction(tx => transitionLineItemWorkflowState(tx, { organizationId: org, lineItemId: line.id, toState: 'awaiting_proof_approval', actorUserId: actor }));
  const [file] = await db.insert(fileRecords).values({ organizationId: org, originalFilename: 'synthetic-art.pdf', mimeType: 'application/pdf', sizeBytes: 10 }).returning();
  const [art] = await db.insert(lineItemArtwork).values({ organizationId: org, orderId: order.id, lineItemId: line.id, fileRecordId: file.id, role: 'production', side: 'front', origin: 'staff_upload', allocationQuantity: 1 }).returning();
  const [attachment] = await db.insert(orderAttachments).values({ orderId: order.id, orderLineItemId: line.id, fileName: 'synthetic-proof.pdf', role: 'proof', mimeType: 'application/pdf', fileSize: 10 }).returning();
  const version = await db.transaction(tx => proofing.createLineItemProofVersion(tx, { organizationId: org, lineItemId: line.id, proofFileId: attachment.id, createdByUserId: actor }));
  await db.update(lineItemProofVersions).set({ status: 'awaiting_response', sentAt: new Date() }).where(eq(lineItemProofVersions.id, version.id));
  return { order, line, version, art, file };
}
async function command(lineId: string) {
  const [line] = await db.select().from(orderLineItems).where(eq(orderLineItems.id, lineId));
  const jobs = await db.select().from(productionJobs).where(eq(productionJobs.lineItemId, lineId));
  const owner = jobs.find(j => !['done', 'canceled', 'cancelled', 'void'].includes(j.status))!;
  const gate = await resolveLineItemProofReleaseGate(db, { organizationId: org, lineItemId: lineId });
  return { confirmed: true, reason: 'Synthetic expedited production authorization', operationId: randomUUID(), proofVersionId: gate.currentRevision!.proofVersionId,
    artworkFingerprint: gate.currentRevision!.artworkFingerprint, expectedUpdatedAt: line.updatedAt.toISOString(), expectedOwnerJobId: owner.id };
}
async function release(lineId: string, body?: any) { return request(app).post('/api/proofing/line-item/' + lineId + '/early-production-release').send(body ?? await command(lineId)); }
async function owners(lineId: string) { return (await db.select().from(productionJobs).where(eq(productionJobs.lineItemId, lineId))).filter(j => !['done','canceled','cancelled','void'].includes(j.status)); }

test('pending Proofing and Prepress share exactly one physical owner; disabled proof has no actionable history entry', async () => {
  const f = await fixture(true);
  const { resolvePrepressQueueEligibility } = await import('../services/prepressQueueEligibility');
  expect((await proofing.listProofingQueue(db, { organizationId: org })).rows.some(r => r.lineItemId === f.line.id)).toBe(true);
  expect((await resolvePrepressQueueEligibility(db, { organizationId: org })).lineItemIds).toContain(f.line.id);
  expect(await owners(f.line.id)).toHaveLength(1);
  const [before] = await db.select().from(orderLineItems).where(eq(orderLineItems.id, f.line.id));
  const response = await request(app).patch('/api/order-line-items/' + f.line.id).send({ requiresProofApproval: false, expectedUpdatedAt: before.updatedAt.toISOString() });
  expect({ status: response.status, body: response.body.message }).toEqual({ status: 200, body: undefined });
  expect((await proofing.listProofingQueue(db, { organizationId: org })).rows.some(r => r.lineItemId === f.line.id)).toBe(false);
  expect(await db.select().from(lineItemProofVersions).where(eq(lineItemProofVersions.id, f.version.id))).toHaveLength(1);
  expect(await owners(f.line.id)).toHaveLength(1);
  expect((await resolvePrepressQueueEligibility(db, { organizationId: org })).lineItemIds).toContain(f.line.id);
});

test('pending approval blocks normal production, explicit release routes canonically without approval and is idempotent', async () => {
  const f = await fixture();
  await expect(db.transaction(tx => transitionLineItemWorkflowState(tx, { organizationId: org, lineItemId: f.line.id, toState: 'ready_for_production' }))).rejects.toMatchObject({ code: 'PROOF_APPROVAL_REQUIRED' });
  const body = await command(f.line.id), response = await release(f.line.id, body);
  expect({ status: response.status, error: response.body.error }).toEqual({ status: 200, error: undefined });
  const [line] = await db.select().from(orderLineItems).where(eq(orderLineItems.id, f.line.id));
  expect(line).toMatchObject({ requiresProofApproval: true, approvedProofVersionId: null, workflowState: 'ready_for_production' });
  const [version] = await db.select().from(lineItemProofVersions).where(eq(lineItemProofVersions.id, f.version.id));
  expect(version.status).toBe('awaiting_response');
  expect(await owners(f.line.id)).toHaveLength(1); expect((await owners(f.line.id))[0].stationKey).toBe('flatbed');
  const fresh = await request(app).get('/api/proofing/line-item/' + f.line.id);
  expect(fresh.status).toBe(200); expect(fresh.body.data.proofGate.earlyRelease.id).toBe(response.body.data.authorization.id);
  const duplicates = await Promise.all([release(f.line.id, body), release(f.line.id, body)]);
  expect(duplicates.map(r => r.status)).toEqual([200, 200]);
  expect(await db.select().from(lineItemProofEarlyReleases).where(eq(lineItemProofEarlyReleases.lineItemId, f.line.id))).toHaveLength(1);
  expect((await db.select().from(orderAuditLog).where(eq(orderAuditLog.orderLineItemId, f.line.id))).filter(e => e.actionType === 'proof_released_without_approval')).toHaveLength(1);
  expect((await proofing.listProofingQueue(db, { organizationId: org })).rows.find(r => r.lineItemId === f.line.id)?.currentQueueStatus).toBe('awaiting_approval');
});

test.each(['approved', 'rejected'] as const)('later customer %s preserves physical owner, release, materials, and event chronology', async decision => {
  const f = await fixture(); const response = await release(f.line.id); expect(response.status).toBe(200);
  const [owner] = await owners(f.line.id);
  const { canonicalProductionOperations } = await import('../services/canonicalProductionOperations');
  await canonicalProductionOperations.startJob({ organizationId: org, actorUserId: actor, jobId: owner.id });
  const usage = [{ materialId: 'synthetic-material', quantityUsed: 1, unitOfMeasure: 'sheet' }];
  await db.update(orderLineItems).set({ materialUsages: usage as any }).where(eq(orderLineItems.id, f.line.id));
  await db.transaction(tx => proofing.recordProofResponse(tx, { organizationId: org, proofVersionId: f.version.id, decision, responderSource: 'customer', responseNotes: 'Synthetic customer decision' }));
  expect((await owners(f.line.id)).map(j => j.id)).toEqual([owner.id]);
  const [line] = await db.select().from(orderLineItems).where(eq(orderLineItems.id, f.line.id)); expect(line.materialUsages).toEqual(usage);
  const [auth] = await db.select().from(lineItemProofEarlyReleases).where(eq(lineItemProofEarlyReleases.lineItemId, f.line.id));
  const [started] = await db.select().from(productionEvents).where(and(eq(productionEvents.productionJobId, owner.id), eq(productionEvents.type, 'timer_started')));
  const [approval] = await db.select().from(lineItemProofApprovals).where(eq(lineItemProofApprovals.proofVersionId, f.version.id));
  expect(auth.authorizedAt.getTime()).toBeLessThanOrEqual(started.createdAt.getTime()); expect(started.createdAt.getTime()).toBeLessThanOrEqual(approval.respondedAt.getTime());
  const gate = await resolveLineItemProofReleaseGate(db, { organizationId: org, lineItemId: f.line.id });
  expect(gate.approved).toBe(decision === 'approved'); expect(gate.allowed).toBe(decision === 'approved');
  if (decision === 'rejected') await expect(canonicalProductionOperations.startJob({ organizationId: org, actorUserId: actor, jobId: owner.id })).rejects.toMatchObject({ code: 'PROOF_APPROVAL_REQUIRED' });
});

test('replacement artwork or a newer proof never inherits an old release', async () => {
  const f = await fixture(); const initial = await command(f.line.id); expect((await release(f.line.id, initial)).status).toBe(200);
  await db.transaction(async tx => { await lockWorkflowLines(tx, org, [f.line.id]); await tx.update(lineItemArtwork).set({ allocationGroupId: 'new-revision' }).where(eq(lineItemArtwork.id, f.art.id)); });
  expect((await resolveLineItemProofReleaseGate(db, { organizationId: org, lineItemId: f.line.id })).allowed).toBe(false);
  expect((await release(f.line.id, initial)).status).toBe(409);
  await db.insert(lineItemProofVersions).values({ organizationId: org, orderId: f.order.id, lineItemId: f.line.id, proofFileId: f.version.proofFileId, versionNumber: 2, status: 'draft', createdByUserId: actor });
  expect((await resolveLineItemProofReleaseGate(db, { organizationId: org, lineItemId: f.line.id })).allowed).toBe(false);
  expect(await db.select().from(lineItemProofEarlyReleases).where(eq(lineItemProofEarlyReleases.lineItemId, f.line.id))).toHaveLength(1);
});

test.each(['prepress', 'design', 'credit', 'run', 'stale-owner', 'stale-version', 'permission', 'tenant', 'unconfirmed', 'artwork', 'canceled', 'hold'] as const)('%s blocker cannot leave a partial authorization, audit, or owner transition', async blocker => {
  const f = await fixture(blocker === 'prepress'); const body: any = await command(f.line.id);
  if (blocker === 'canceled') await db.update(orders).set({ state: 'canceled', canceledAt: new Date().toISOString() }).where(eq(orders.id, f.order.id));
  if (blocker === 'hold') await db.update(orderLineItems).set({ workflowState: 'on_hold' }).where(eq(orderLineItems.id, f.line.id));
  if (blocker === 'design') await db.update(orderLineItems).set({ requiresDesign: true, designStatus: 'in_design' }).where(eq(orderLineItems.id, f.line.id));
  if (blocker === 'credit') await db.update(customers).set({ creditLimit: '0' }).where(eq(customers.id, customer));
  if (blocker === 'run') { const [run] = await db.insert(productionRuns).values({ organizationId: org, runNumber: 1, stationKey: 'flatbed' }).returning(); await db.insert(productionRunMembers).values({ organizationId: org, productionRunId: run.id, productionJobId: body.expectedOwnerJobId, orderLineItemId: f.line.id, allocatedQuantity: 1 }); }
  if (blocker === 'stale-owner') body.expectedOwnerJobId = randomUUID();
  if (blocker === 'stale-version') body.proofVersionId = randomUUID();
  if (blocker === 'unconfirmed') body.confirmed = false;
  if (blocker === 'permission') await db.update(userOrganizations).set({ role: 'member' }).where(eq(userOrganizations.organizationId, org));
  if (blocker === 'artwork') await db.delete(lineItemArtwork).where(eq(lineItemArtwork.id, f.art.id));
  const prior = await owners(f.line.id);
  try {
    const req = request(app).post('/api/proofing/line-item/' + f.line.id + '/early-production-release');
    if (blocker === 'tenant') req.set('x-test-org', randomUUID());
    const response = await req.send(body);
    expect([400, 403, 404, 409]).toContain(response.status);
    expect(await db.select().from(lineItemProofEarlyReleases).where(eq(lineItemProofEarlyReleases.lineItemId, f.line.id))).toHaveLength(0);
    expect(await owners(f.line.id)).toEqual(prior);
    expect((await db.select().from(orderAuditLog).where(eq(orderAuditLog.orderLineItemId, f.line.id))).filter(e => e.actionType === 'proof_released_without_approval')).toHaveLength(0);
  } finally {
    if (blocker === 'credit') await db.update(customers).set({ creditLimit: '100000' }).where(eq(customers.id, customer));
    if (blocker === 'permission') await db.update(userOrganizations).set({ role: 'admin' }).where(eq(userOrganizations.organizationId, org));
  }
});

test('release races with customer rejection without permitting a rejected revision', async () => {
  const f = await fixture(), body = await command(f.line.id);
  const results = await Promise.allSettled([release(f.line.id, body), db.transaction(tx => proofing.recordProofResponse(tx, { organizationId: org, proofVersionId: f.version.id, decision: 'rejected', responderSource: 'customer' }))]);
  expect(results[1].status).toBe('fulfilled');
  expect((await resolveLineItemProofReleaseGate(db, { organizationId: org, lineItemId: f.line.id })).allowed).toBe(false);
  expect(await owners(f.line.id)).toHaveLength(1);
});

test('unstarted Prepress can be withdrawn while independent Proofing remains pending', async () => {
  const f = await fixture(true);
  // No production artwork has been prepared for this unstarted obligation.
  await db.delete(lineItemArtwork).where(eq(lineItemArtwork.id, f.art.id));
  const [before] = await db.select().from(orderLineItems).where(eq(orderLineItems.id, f.line.id));
  const response = await request(app).patch('/api/order-line-items/' + f.line.id).send({ requiresPrepress: false, expectedUpdatedAt: before.updatedAt.toISOString() });
  expect({ status: response.status, message: response.body.message }).toEqual({ status: 200, message: undefined });
  expect(response.body).toMatchObject({ requiresPrepress: false, requiresProofApproval: true, workflowState: 'awaiting_proof_approval' });
  const { resolvePrepressQueueEligibility } = await import('../services/prepressQueueEligibility');
  expect((await resolvePrepressQueueEligibility(db, { organizationId: org })).lineItemIds).not.toContain(f.line.id);
  expect((await proofing.listProofingQueue(db, { organizationId: org })).rows.some(r => r.lineItemId === f.line.id)).toBe(true);
  expect(await owners(f.line.id)).toHaveLength(1);
});

test('Prepress prepares and completes pending proof work before explicit release', async () => {
  const f = await fixture(true);
  await db.insert(lineItemFiles).values({ organizationId: org, orderId: f.order.id, lineItemId: f.line.id, fileRecordId: f.file.id,
    role: 'final', sourceArtworkSide: 'front', productionQuantity: 1, storagePath: 'synthetic/art.pdf', originalFilename: 'synthetic-art.pdf', mimeType: 'application/pdf', sizeBytes: 10, createdByUserId: actor });
  const start = await request(app).post('/api/prepress/session/start').send({ lineItemId: f.line.id });
  expect({ status: start.status, error: start.body.error }).toEqual({ status: 200, error: undefined });
  const sessions = await db.select().from(prepressSessions).where(eq(prepressSessions.lineItemId, f.line.id));
  expect(sessions).toHaveLength(1);
  const completed = await request(app).post('/api/prepress/session/' + sessions[0].id + '/complete').send({});
  expect({ status: completed.status, error: completed.body.error }).toEqual({ status: 200, error: undefined });
  const [line] = await db.select().from(orderLineItems).where(eq(orderLineItems.id, f.line.id));
  expect(line).toMatchObject({ requiresPrepress: true, requiresProofApproval: true, workflowState: 'awaiting_proof_approval', approvedProofVersionId: null });
  const { resolvePrepressQueueEligibility } = await import('../services/prepressQueueEligibility');
  expect((await resolvePrepressQueueEligibility(db, { organizationId: org })).lineItemIds).not.toContain(f.line.id);
  expect((await release(f.line.id)).status).toBe(200);
  expect((await owners(f.line.id))[0].stationKey).toBe('flatbed');
});

test('release racing with approval neither reroutes twice nor loses approval', async () => {
  const f = await fixture(), body = await command(f.line.id);
  const results = await Promise.allSettled([release(f.line.id, body), db.transaction(tx => proofing.recordProofResponse(tx, { organizationId: org, proofVersionId: f.version.id, decision: 'approved', responderSource: 'customer' }))]);
  expect(results[1].status).toBe('fulfilled');
  expect((await resolveLineItemProofReleaseGate(db, { organizationId: org, lineItemId: f.line.id })).approved).toBe(true);
  expect(await owners(f.line.id)).toHaveLength(1);
  expect((await owners(f.line.id))[0].stationKey).toBe('flatbed');
});

test('approval of an old early-released proof cannot authorize artwork replaced afterward', async () => {
  const f = await fixture(); expect((await release(f.line.id)).status).toBe(200);
  await db.transaction(async tx => { await lockWorkflowLines(tx, org, [f.line.id]); await tx.update(lineItemArtwork).set({ allocationGroupId: 'replacement-after-release' }).where(eq(lineItemArtwork.id, f.art.id)); });
  await db.transaction(tx => proofing.recordProofResponse(tx, { organizationId: org, proofVersionId: f.version.id, decision: 'approved', responderSource: 'customer' }));
  const gate = await resolveLineItemProofReleaseGate(db, { organizationId: org, lineItemId: f.line.id });
  expect(gate.allowed).toBe(false); expect(gate.earlyRelease).toBeNull();
  expect(await owners(f.line.id)).toHaveLength(1);
});

test('another tenant membership cannot authorize this tenant line', async () => {
  const f = await fixture(), body = await command(f.line.id);
  const [other] = await db.insert(organizations).values({ name: 'Other synthetic tenant', slug: 'other-' + randomUUID() }).returning();
  await db.insert(userOrganizations).values({ organizationId: other.id, userId: actor, role: 'admin' });
  try {
    const response = await request(app).post('/api/proofing/line-item/' + f.line.id + '/early-production-release').set('x-test-org', other.id).send(body);
    expect(response.status).toBe(404);
    expect(await db.select().from(lineItemProofEarlyReleases).where(eq(lineItemProofEarlyReleases.lineItemId, f.line.id))).toHaveLength(0);
  } finally { await db.delete(organizations).where(eq(organizations.id, other.id)); }
});

test('combined-run start and legacy status resume recheck the canonical proof gate after rejection', async () => {
  const f = await fixture(); expect((await release(f.line.id)).status).toBe(200);
  const [owner] = await owners(f.line.id);
  const [run] = await db.insert(productionRuns).values({ organizationId: org, runNumber: 200, stationKey: 'flatbed', status: 'ready_for_production', productionFileStrategy: 'rip_managed' }).returning();
  await db.insert(productionRunMembers).values({ organizationId: org, productionRunId: run.id, productionJobId: owner.id, orderLineItemId: f.line.id, allocatedQuantity: 1 });
  await db.transaction(tx => proofing.recordProofResponse(tx, { organizationId: org, proofVersionId: f.version.id, decision: 'rejected', responderSource: 'customer' }));
  const { transitionProductionRun } = await import('../services/productionRunService');
  await expect(transitionProductionRun({ organizationId: org, runId: run.id, actorUserId: actor, action: 'start' })).rejects.toMatchObject({ code: 'PROOF_APPROVAL_REQUIRED' });
  const { updateProductionJobStatusWorkflow } = await import('../routes/productionJobs.routes');
  await expect(db.transaction(tx => updateProductionJobStatusWorkflow(tx, { organizationId: org, userId: actor, jobId: owner.id, status: 'in_progress' }))).rejects.toMatchObject({ code: 'PROOF_APPROVAL_REQUIRED' });
  const [savedRun] = await db.select().from(productionRuns).where(eq(productionRuns.id, run.id)); expect(savedRun.startedAt).toBeNull();
  expect((await owners(f.line.id))[0].status).toBe('queued');
});

test('a changed production quantity requires a new reviewed authorization', async () => {
  const f = await fixture(); expect((await release(f.line.id)).status).toBe(200);
  await db.transaction(async tx => { await lockWorkflowLines(tx, org, [f.line.id]); await tx.update(orderLineItems).set({ quantity: 2 }).where(eq(orderLineItems.id, f.line.id)); });
  expect((await resolveLineItemProofReleaseGate(db, { organizationId: org, lineItemId: f.line.id })).allowed).toBe(false);
  expect(await db.select().from(lineItemProofEarlyReleases).where(eq(lineItemProofEarlyReleases.lineItemId, f.line.id))).toHaveLength(1);
});

test('unchecking an approved proof requirement removes actionable Proofing without losing decisions or versions', async () => {
  const f = await fixture();
  await db.transaction(tx => proofing.recordProofResponse(tx, { organizationId: org, proofVersionId: f.version.id, decision: 'approved', responderSource: 'customer' }));
  const [before] = await db.select().from(orderLineItems).where(eq(orderLineItems.id, f.line.id));
  const response = await request(app).patch('/api/order-line-items/' + f.line.id).send({ requiresProofApproval: false, expectedUpdatedAt: before.updatedAt.toISOString() });
  expect(response.status).toBe(200);
  expect((await proofing.listProofingQueue(db, { organizationId: org })).rows.some(row => row.lineItemId === f.line.id)).toBe(false);
  expect(await db.select().from(lineItemProofVersions).where(eq(lineItemProofVersions.id, f.version.id))).toHaveLength(1);
  expect(await db.select().from(lineItemProofApprovals).where(eq(lineItemProofApprovals.proofVersionId, f.version.id))).toHaveLength(1);
  expect(await owners(f.line.id)).toHaveLength(1);
});

test('a proof package early release authorizes only the selected line', async () => {
  const f = await fixture();
  const [other] = await db.insert(orderLineItems).values({ orderId: f.order.id, productId: product, description: 'Other synthetic package line', quantity: 1, unitPrice: '10', totalPrice: '10', productType: 'flatbed', requiresProofApproval: true, workflowState: 'new', status: 'new' } as any).returning();
  await db.transaction(tx => transitionLineItemWorkflowState(tx, { organizationId: org, lineItemId: other.id, toState: 'awaiting_proof_approval' }));
  await db.insert(proofVersionLineItems).values({ organizationId: org, orderId: f.order.id, lineItemId: other.id, proofVersionId: f.version.id, sortOrder: 1 });
  expect((await release(f.line.id)).status).toBe(200);
  expect((await resolveLineItemProofReleaseGate(db, { organizationId: org, lineItemId: other.id })).allowed).toBe(false);
  expect(await owners(f.line.id)).toHaveLength(1); expect(await owners(other.id)).toHaveLength(1);
  expect((await owners(other.id))[0].stationKey).toBe('prepress');
});
