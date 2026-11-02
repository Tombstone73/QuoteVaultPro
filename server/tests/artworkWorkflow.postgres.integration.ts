import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import express from 'express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, expect, jest, test } from '@jest/globals';
import { and, eq } from 'drizzle-orm';
import { db, pool } from '../db';
import * as schema from '@shared/schema';
import { LineItemArtworkReadResolver, resolveProductionArtworkReferences } from '../services/artwork/LineItemArtworkReadResolver';
import { resolveLineItemProductionArtwork } from '@shared/productionHydration';
import { buildFulfillmentArtworkProjection } from '../services/artwork/FulfillmentArtworkProjection';
import { resolveLocalStoragePath } from '../services/localStoragePath';
import { storageRegistry } from '../services/storage/StorageRegistry';

// Preview generation is deliberately failed; persistence and every file resolver
// remain real. This also proves derivative failures do not change ownership.
jest.unstable_mockModule('../services/assets/AssetPreviewGenerator', () => ({
  assetPreviewGenerator: { generateCanonicalFilePreviews: async () => 'failed' },
}));
let files: typeof import('../prepressFileService');
let app: express.Express;
let org: string, user: string, customer: string, product: string;
const resolver = new LineItemArtworkReadResolver(db);
const root = path.resolve('node_modules/.cache/artwork-workflow-files');
const previousRoot = process.env.FILE_STORAGE_ROOT;
const localFiles = new Set<string>();

beforeAll(async () => {
  process.env.FILE_STORAGE_ROOT = root;
  await mkdir(root, { recursive: true });
  files = await import('../prepressFileService');
  // The production object-store adapter receives derivative object keys. Model
  // those private objects with actual isolated local bytes; all DB/file-access
  // authorization, placement, and derivative resolution stay unmocked.
  jest.spyOn(storageRegistry.getAdapter('local_filesystem'), 'readObject').mockImplementation(async input => {
    return readFile(resolveLocalStoragePath(input.localPathRef || input.objectKey || 'missing'));
  });
  app = express(); app.use(express.json());
  const auth = (req: any, res: any, next: any) => {
    if (req.headers['x-unauthenticated']) return res.sendStatus(401);
    req.user = { id: user, role: 'admin' }; next();
  };
  const tenant = (req: any, _res: any, next: any) => { req.organizationId = req.headers['x-organization'] || org; req.orgRole = 'admin'; next(); };
  const middleware = { isAuthenticated: auth, tenantContext: tenant, isAdminOrOwner: auth, assertInternalUser: () => true };
  const { registerArtworkAccessRoutes } = await import('../routes/artworkAccess.routes');
  registerArtworkAccessRoutes(app, middleware, { requestArtworkDerivativeRecovery: async () => {} });
  const { registerProductionJobsRoutes } = await import('../routes/productionJobs.routes');
  registerProductionJobsRoutes(app, middleware);
  const { registerPrepressQueueRoutes } = await import('../routes/prepress.routes');
  registerPrepressQueueRoutes(app, middleware);
}, 120000);

beforeEach(async () => {
  org = randomUUID(); user = randomUUID();
  await db.insert(schema.organizations).values({ id: org, name: 'Isolated artwork workflow', slug: org,
    settings: { preferences: { proofing: { policy: 'manual_requested_only' } } } } as any);
  await db.insert(schema.users).values({ id: user, email: `${user}@example.invalid`, role: 'admin' });
  await db.insert(schema.userOrganizations).values({ userId: user, organizationId: org, role: 'admin' });
  const [c] = await db.insert(schema.customers).values({ organizationId: org, companyName: 'Synthetic artwork buyer' }).returning(); customer = c.id;
  const [p] = await db.insert(schema.products).values({ organizationId: org, name: 'Synthetic print product', description: 'QA', isActive: true }).returning(); product = p.id;
  const [canonical] = await db.insert(schema.storageProviderConfigs).values({ organizationId: org, providerType: 'local_filesystem', role: 'canonical', status: 'validated', displayName: 'Isolated physical files', configJson: {} }).returning();
  const [intake] = await db.insert(schema.storageProviderConfigs).values({ organizationId: org, providerType: 'local_filesystem', role: 'intake', status: 'validated', displayName: 'Isolated intake', configJson: {} }).returning();
  await db.insert(schema.organizationStorageProfiles).values({ organizationId: org, mode: 'byos_local', status: 'active', primaryProviderConfigId: canonical.id, intakeProviderConfigId: intake.id });
  await db.insert(schema.stations).values(['prepress', 'roll', 'flatbed'].map((key, sort) => ({ id: randomUUID(), organizationId: org, key, name: key, sort, active: true })));
});

afterAll(async () => {
  const placements = await db.select().from(schema.storagePlacements);
  for (const placement of placements) if (placement.localPathRef) {
    const target = resolveLocalStoragePath(placement.localPathRef);
    if (target.startsWith(root + path.sep)) localFiles.add(target);
  }
  for (const target of localFiles) await unlink(target).catch(() => undefined);
  jest.restoreAllMocks();
  if (previousRoot === undefined) delete process.env.FILE_STORAGE_ROOT; else process.env.FILE_STORAGE_ROOT = previousRoot;
  await pool.end();
});

async function fixture(quantity = 1) {
  const [order] = await db.insert(schema.orders).values({ organizationId: org, customerId: customer, createdByUserId: user,
    orderNumber: `ART-${randomUUID()}`, state: 'open', status: 'in_production' } as any).returning();
  const [line] = await db.insert(schema.orderLineItems).values({ orderId: order.id, productId: product, description: 'Synthetic artwork',
    quantity, unitPrice: '10', totalPrice: String(10 * quantity), workflowState: 'in_prepress', status: 'new',
    requiresDesign: false, requiresPrepress: true, requiresProofApproval: false } as any).returning();
  return { order, line };
}
async function upload(f: Awaited<ReturnType<typeof fixture>>, role: 'original' | 'final', name = `${role}.pdf`, quantity?: number) {
  return files.uploadLineItemFile({ organizationId: org, orderId: f.order.id, lineItemId: f.line.id, role,
    tag: role === 'final' ? 'final_print' : undefined, sourceArtworkSide: 'front', productionQuantity: quantity,
    buffer: Buffer.from(`%PDF-1.4\n${name}`), originalFilename: name, mimeType: 'application/pdf', createdByUserId: user });
}
async function resolution(lineItemId: string) {
  return resolver.resolveForLineItem({ organizationId: org, lineItemId, purpose: 'production' });
}
async function derivatives(fileRecordId: string) {
  const [placement] = await db.select().from(schema.storagePlacements).where(eq(schema.storagePlacements.fileRecordId, fileRecordId));
  for (const variant of ['thumbnail', 'preview'] as const) {
    const key = `${randomUUID()}.png`; const target = path.join(root, key);
    await writeFile(target, Buffer.from(`${variant}:${fileRecordId}`)); localFiles.add(target);
    await db.insert(schema.fileDerivatives).values({ fileRecordId, derivativeType: variant, state: 'ready', sourcePlacementId: placement.id,
      objectKey: key, mimeType: 'image/png', sizeBytes: 100 });
  }
}
async function job(f: Awaited<ReturnType<typeof fixture>>, stationKey = 'roll') {
  const [created] = await db.insert(schema.productionJobs).values({ organizationId: org, orderId: f.order.id, lineItemId: f.line.id,
    stationKey, stepKey: stationKey === 'prepress' ? 'prepress' : 'queued', status: 'queued' }).returning();
  return created;
}
async function assertFileReads(id: string, name: string) {
  const original = await request(app).get(`/api/artwork/file-records/${id}/content`);
  expect(original.status).toBe(200); expect(original.body.toString()).toContain(name);
  for (const variant of ['thumbnail', 'preview']) {
    const response = await request(app).get(`/api/artwork/file-records/${id}/content?variant=${variant}`);
    expect(response.status).toBe(200); expect(response.body.toString()).toBe(`${variant}:${id}`);
  }
}

test('Prepress bypass uses the same canonical source identity for Production and authenticated retrieval', async () => {
  const f = await fixture(); const source = await upload(f, 'original'); await derivatives(source.fileRecordId!);
  const owner = await job(f);
  const refs = resolveProductionArtworkReferences(await resolution(f.line.id));
  expect(refs).toHaveLength(1); expect(refs[0]).toMatchObject({ fileRecordId: source.fileRecordId, source: 'canonical' });
  const detail = await request(app).get(`/api/production/jobs/${owner.id}`);
  expect(detail.status).toBe(200); expect(JSON.stringify(detail.body)).toContain(source.fileRecordId!);
  await assertFileReads(source.fileRecordId!, 'original.pdf');
});

test('Prepress final upload and actual Complete Prepress preserve files while Production resolves the final version', async () => {
  const f = await fixture(); const source = await upload(f, 'original'); const final = await upload(f, 'final');
  await derivatives(final.fileRecordId!); await job(f, 'prepress');
  const [session] = await db.insert(schema.prepressSessions).values({ organizationId: org, orderId: f.order.id, lineItemId: f.line.id, startedByUserId: user, lockOwnerUserId: user }).returning();
  const before = await db.select().from(schema.storagePlacements).where(eq(schema.storagePlacements.fileRecordId, source.fileRecordId!));
  const completed = await request(app).post(`/api/prepress/session/${session.id}/complete`).send({});
  expect({ status: completed.status, body: completed.body }).toMatchObject({ status: 200 });
  const resolved = await resolution(f.line.id);
  // This is the original defect: filtering ordinary ownership by final IDs yields nothing.
  expect(resolveLineItemProductionArtwork({ lineItemArtwork: resolved.artwork, productionFileRecordIds: [final.fileRecordId] })).toEqual([]);
  expect(resolveProductionArtworkReferences(resolved).map(ref => ref.fileRecordId)).toEqual([final.fileRecordId]);
  const owners = await db.select().from(schema.productionJobs).where(and(eq(schema.productionJobs.lineItemId, f.line.id), eq(schema.productionJobs.status, 'queued')));
  const owner = owners.find(row => row.stationKey !== 'prepress')!; expect(owner).toBeTruthy();
  const detail = await request(app).get(`/api/production/jobs/${owner.id}`);
  expect(detail.status).toBe(200); expect(detail.body.data.artwork?.map((ref: any) => ref.fileRecordId)).toEqual([final.fileRecordId]);
  expect(await db.select().from(schema.storagePlacements).where(eq(schema.storagePlacements.fileRecordId, source.fileRecordId!))).toEqual(before);
  expect(resolved.artwork.map(ref => ref.fileRecordId)).toEqual([source.fileRecordId]);
  await assertFileReads(final.fileRecordId!, 'final.pdf');
  expect((await request(app).get(`/api/artwork/file-records/${source.fileRecordId}/content`)).status).toBe(200);
});

test('multiple final files and lines keep exact identities and allocations without cross-line substitution', async () => {
  const a = await fixture(2), b = await fixture();
  const first = await upload(a, 'final', 'front-one.pdf', 1), second = await upload(a, 'final', 'front-two.pdf', 1), other = await upload(b, 'final', 'other-line.pdf', 1);
  const results = await resolver.resolveForLineItems({ organizationId: org, lineItemIds: [a.line.id, b.line.id], purpose: 'production' });
  expect(new Set(resolveProductionArtworkReferences(results.get(a.line.id)).map(ref => ref.fileRecordId))).toEqual(new Set([first.fileRecordId, second.fileRecordId]));
  expect(resolveProductionArtworkReferences(results.get(b.line.id)).map(ref => ref.fileRecordId)).toEqual([other.fileRecordId]);
  expect(resolveProductionArtworkReferences(results.get(a.line.id)).map(ref => ref.allocationQuantity)).toEqual([1, 1]);
});

test('unchanged Prepress artwork assignment reuses its source record and physical placement', async () => {
  const f = await fixture(); const source = await upload(f, 'original');
  const before = await db.select().from(schema.fileRecords).where(eq(schema.fileRecords.organizationId, org));
  const assigned = await files.assignCustomerArtworkAsProductionArtwork({ organizationId: org, orderId: f.order.id,
    lineItemId: f.line.id, createdByUserId: user, tag: 'final_print', artworkSide: 'front', source: { kind: 'line_item_original', fileId: source.id } });
  expect(assigned.file.fileRecordId).toBe(source.fileRecordId);
  expect(await db.select().from(schema.fileRecords).where(eq(schema.fileRecords.organizationId, org))).toEqual(before);
  expect(resolveProductionArtworkReferences(await resolution(f.line.id))).toEqual([expect.objectContaining({
    id: assigned.file.id, fileRecordId: source.fileRecordId, source: 'canonical',
  })]);
});

test('completed Production history and Fulfillment resolve the same selected final without ownership writes', async () => {
  const f = await fixture(); await upload(f, 'original', 'customer-source.pdf'); const final = await upload(f, 'final', 'completed-final.pdf');
  await derivatives(final.fileRecordId!); const owner = await job(f);
  await db.update(schema.productionJobs).set({ status: 'done', stepKey: 'done', completedAt: new Date(), completedByUserId: user }).where(eq(schema.productionJobs.id, owner.id));
  const before = await db.select().from(schema.lineItemArtwork).where(eq(schema.lineItemArtwork.lineItemId, f.line.id));
  const history = await request(app).get('/api/production/jobs/recently-completed?station=roll');
  expect({ status: history.status, message: history.body.message }).toMatchObject({ status: 200 });
  expect(history.body.data.find((row: any) => row.id === owner.id).artwork.map((ref: any) => ref.fileRecordId)).toEqual([final.fileRecordId]);
  const { FulfillmentDashboardRepo } = await import('../services/fulfillment/repository');
  const fulfillment = await new FulfillmentDashboardRepo(db).getFulfillmentDetail(org, f.order.id);
  expect(fulfillment?.lineItems.find(line => line.id === f.line.id)?.artwork.map(ref => ref.fileRecordId)).toEqual([final.fileRecordId]);
  expect(await db.select().from(schema.lineItemArtwork).where(eq(schema.lineItemArtwork.lineItemId, f.line.id))).toEqual(before);
});

test('final replacement selects the active version and retains historical physical bytes', async () => {
  const f = await fixture(); const old = await upload(f, 'final', 'old-final.pdf');
  const current = await files.replaceLineItemFile({ fileId: old.id, organizationId: org, createdByUserId: user,
    buffer: Buffer.from('%PDF-1.4\nnew-final.pdf'), originalFilename: 'new-final.pdf', mimeType: 'application/pdf' });
  expect(resolveProductionArtworkReferences(await resolution(f.line.id)).map(ref => ref.fileRecordId)).toEqual([current.fileRecordId]);
  const [history] = await db.select().from(schema.lineItemFiles).where(eq(schema.lineItemFiles.id, old.id));
  expect(history.status).toBe('superseded');
  expect((await request(app).get(`/api/artwork/file-records/${old.fileRecordId}/content`)).body.toString()).toContain('old-final.pdf');
});

test('historical final projections use tenant-owned file records without backfilling ordinary ownership', async () => {
  const f = await fixture(); const final = await upload(f, 'final', 'historical.pdf');
  await db.update(schema.lineItemFiles).set({ storagePath: 'obsolete/legacy/path.pdf', storageKey: 'obsolete/legacy/path.pdf' }).where(eq(schema.lineItemFiles.id, final.id));
  const before = await db.select().from(schema.lineItemArtwork).where(eq(schema.lineItemArtwork.lineItemId, f.line.id));
  const refs = resolveProductionArtworkReferences(await resolution(f.line.id));
  expect(refs[0]).toMatchObject({ id: final.id, source: 'line_item_file', fileRecordId: final.fileRecordId });
  const projected = await buildFulfillmentArtworkProjection(org, refs);
  expect(projected[0]).toMatchObject({ fileRecordId: final.fileRecordId, source: 'line_item_file' });
  expect(projected[0].relationshipId).toBeUndefined();
  expect(await db.select().from(schema.lineItemArtwork).where(eq(schema.lineItemArtwork.lineItemId, f.line.id))).toEqual(before);
  expect((await request(app).get(projected[0].originalUrl)).body.toString()).toContain('historical.pdf');
});

test('missing and foreign final references fail closed instead of showing obsolete source artwork', async () => {
  const f = await fixture(); const source = await upload(f, 'original'); const final = await upload(f, 'final');
  await db.update(schema.lineItemFiles).set({ fileRecordId: null }).where(eq(schema.lineItemFiles.id, final.id));
  expect(resolveProductionArtworkReferences(await resolution(f.line.id))).toEqual([]);
  await db.update(schema.fileRecords).set({ organizationId: 'inbound-bootstrap-test' }).where(eq(schema.fileRecords.id, source.fileRecordId!));
  await db.update(schema.lineItemFiles).set({ fileRecordId: source.fileRecordId }).where(eq(schema.lineItemFiles.id, final.id));
  expect(resolveProductionArtworkReferences(await resolution(f.line.id))).toEqual([]);
  expect((await request(app).get(`/api/artwork/file-records/${source.fileRecordId}/content`)).status).toBe(404);
  expect((await request(app).get('/api/artwork/file-records/nonexistent/content')).status).toBe(404);
  expect((await request(app).get(`/api/artwork/file-records/${final.fileRecordId}/content`).set('x-unauthenticated', '1')).status).toBe(401);
});

test('failed preview generation leaves file identity, ownership, and original retrieval intact', async () => {
  const f = await fixture(); const source = await upload(f, 'original'), final = await upload(f, 'final');
  const before = await resolution(f.line.id);
  expect((await request(app).get(`/api/artwork/file-records/${final.fileRecordId}/content?variant=thumbnail`)).status).toBe(404);
  expect((await request(app).get(`/api/artwork/file-records/${final.fileRecordId}/content`)).status).toBe(200);
  expect(await resolution(f.line.id)).toEqual(before);
  expect(before.artwork.map(ref => ref.fileRecordId)).toEqual([source.fileRecordId]);
});
