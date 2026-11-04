import { afterAll, beforeAll, expect, test } from '@jest/globals';
import { randomUUID, createHash } from 'node:crypto';
import express from 'express';
import { readFileSync } from 'node:fs';
import { PDFDocument } from 'pdf-lib';
import { registerFulfillmentRoutes } from '../routes/fulfillment.routes';
import request from 'supertest';
import { eq } from 'drizzle-orm';
import { db, pool } from '../db';
import { localBridgeAgents, organizations, printerProfiles, directPrintJobs, shipments, shipmentPackages, upsShipmentRateQuotes, upsLabelPurchases, upsPackageLabels } from '@shared/schema';
import { registerLocalBridgeRoutes } from '../routes/localBridge.routes';
const org = randomUUID(), otherOrg = randomUUID(), agentId = randomUUID(), otherAgentId = randomUUID();
const token = 'synthetic-agent-' + randomUUID(), otherToken = 'synthetic-other-' + randomUUID();
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const previousWebOrigin = process.env.APP_PUBLIC_WEB_ORIGIN;
const app = express(); app.use(express.json());
const middleware = {
  isAuthenticated: (req: any, res: any, next: any) => req.headers['x-staff'] ? next() : res.sendStatus(401),
  tenantContext: (req: any, _res: any, next: any) => { req.organizationId = req.headers['x-other-tenant'] ? otherOrg : org; next(); },
  requireOrgOwnerAdmin: (req: any, res: any, next: any) => req.headers['x-staff'] === 'admin' ? next() : res.sendStatus(403),
};
registerLocalBridgeRoutes(app, middleware);
registerFulfillmentRoutes(app, middleware);
beforeAll(async () => {
  process.env.APP_PUBLIC_WEB_ORIGIN = 'https://dev.printershero.com';
  await db.insert(organizations).values([org, otherOrg].map(id => ({ id, name: 'Synthetic bridge QA', slug: id })));
  await db.insert(localBridgeAgents).values([{ id: agentId, organizationId: org, name: 'QA Epson and Zebra', status: 'active', tokenHash: hash(token), agentVersion: '1.0.29' },
    { id: otherAgentId, organizationId: otherOrg, name: 'Other tenant', status: 'active', tokenHash: hash(otherToken), agentVersion: '1.0.29' }]);
});
afterAll(async () => { if (previousWebOrigin === undefined) delete process.env.APP_PUBLIC_WEB_ORIGIN; else process.env.APP_PUBLIC_WEB_ORIGIN = previousWebOrigin; await pool.end(); });
test('authenticated heartbeat persists and independently reads back; malformed status cannot replace saved state; tenant boundaries remain', async () => {
  const post = (body: object) => request(app).post('/api/local-bridge/heartbeat').auth(token, { type: 'bearer' }).send(body);
  expect((await request(app).post('/api/local-bridge/heartbeat').send({})).status).toBe(401);
  for (const state of ['connected', 'reconnecting', 'disconnected']) {
    expect((await post({ agentVersion: '1.0.29', windowsQueues: ['Epson TM-L90', 'Zebra 450'], connection: { state, error: null } })).status).toBe(200);
    const [saved] = await db.select().from(localBridgeAgents).where(eq(localBridgeAgents.id, agentId));
    expect(saved.connectionHealth?.state).toBe(state); expect(saved.knownWindowsQueues).toEqual(['Epson TM-L90', 'Zebra 450']);
    expect(saved.connectionHealth?.reportedAt).toBeTruthy();
  }
  expect((await post({ connection: { state: 'bad', error: 'private text' } })).status).toBe(400);
  expect((await post({ name: 'Legacy diagnostics' })).status).toBe(200);
  const [saved] = await db.select().from(localBridgeAgents).where(eq(localBridgeAgents.id, agentId));
  expect(saved.connectionHealth?.state).toBe('disconnected'); expect(saved.agentVersion).toBe('1.0.29');
  expect((await request(app).get('/api/local-bridge/admin/agents').set('x-staff', 'employee')).status).toBe(403);
  const response = await request(app).get('/api/local-bridge/admin/agents').set('x-staff', 'admin');
  expect(response.status).toBe(200); expect(response.body.data.map((agent: { id: string }) => agent.id)).toEqual([agentId]);
  expect(JSON.stringify(response.body)).not.toContain(token);
  expect((await db.select().from(localBridgeAgents).where(eq(localBridgeAgents.id, otherAgentId)))[0].connectionHealth).toBeNull();
});
test.each(['Zebra 450', 'Epson TM-L90'])('%s job remains bound to its queue and is never reclaimed after reconnect/submission', async queue => {
  const [profile] = await db.insert(printerProfiles).values({ organizationId: org, displayName: queue, printerType: 'production_ticket',
    windowsQueueName: queue, printAgentId: agentId, supportedDocuments: ['traveler'], isActive: true }).returning();
  const [job] = await db.insert(directPrintJobs).values({ organizationId: org, agentId, destinationId: profile.id,
    documentType: 'profile_test', copies: 1, requestKey: randomUUID() }).returning();
  const claim = () => request(app).post(`/api/local-bridge/direct-print/jobs/${job.id}/claim`).auth(token, { type: 'bearer' }).send({});
  const claims = await Promise.all([claim(), claim()]);
  expect(claims.map(result => result.status).sort()).toEqual([200, 409]);
  expect(claims.find(result => result.status === 200)?.body.data.queueName).toBe(queue);
  expect((await request(app).post(`/api/local-bridge/direct-print/jobs/${job.id}/submitted`).auth(token, { type: 'bearer' }).send({})).status).toBe(200);
  expect((await claim()).status).toBe(409);
  const pending = await request(app).get('/api/local-bridge/direct-print/jobs').auth(token, { type: 'bearer' });
  expect(pending.body.data).toEqual([]);
  const crossTenant = await request(app).post(`/api/local-bridge/direct-print/jobs/${job.id}/claim`).auth(otherToken, { type: 'bearer' }).send({});
  expect(crossTenant.status).toBe(409);
  const [saved] = await db.select().from(directPrintJobs).where(eq(directPrintJobs.id, job.id));
  expect(saved.status).toBe('submitted'); expect(saved.attempts).toBe(1);
});

test('authenticated download and bridge renderer share portrait geometry while original carrier bytes and tracking remain intact', async () => {
  const [shipment] = await db.insert(shipments).values({ organizationId: org, status: 'DRAFT', trackingNumber: 'SYNTHETIC-NOT-FOR-SHIPPING' }).returning();
  const [box] = await db.insert(shipmentPackages).values({ organizationId: org, shipmentId: shipment.id, ordinal: 1, packageReference: 'QA-BOX-1' }).returning();
  const [quote] = await db.insert(upsShipmentRateQuotes).values({ organizationId: org, shipmentId: shipment.id, requestFingerprint: 'synthetic', rates: [], expiresAt: new Date() }).returning();
  const [purchase] = await db.insert(upsLabelPurchases).values({ organizationId: org, shipmentId: shipment.id, quoteId: quote.id, status: 'PURCHASED', environment: 'test', serviceCode: '03', serviceName: 'Synthetic', estimateCents: 0, estimateCurrency: 'USD', providerTransactionId: randomUUID().slice(0, 32), requestFingerprint: 'synthetic' }).returning();
  const original = readFileSync('server/tests/fixtures/shipping-labels/landscape-left.gif');
  const [label] = await db.insert(upsPackageLabels).values({ organizationId: org, purchaseId: purchase.id, packageId: box.id, trackingNumber: 'SYNTHETIC-NOT-FOR-SHIPPING', labelFormat: 'GIF', labelBytes: original, labelSha256: createHash('sha256').update(original).digest('hex') }).returning();
  const url = `/api/fulfillment/shipments/${shipment.id}/ups-labels/${purchase.id}/packages/${box.id}/image`;
  const raw = await request(app).get(url).set('x-staff', 'admin'); expect(raw.status).toBe(200); expect(raw.headers['content-type']).toContain('image/gif'); expect(raw.body).toEqual(original);
  const preview = await request(app).get(url + '?view=print').set('x-staff', 'admin'); expect(preview.status).toBe(200); expect(preview.headers['content-type']).toContain('image/png');
  const pdf = await request(app).get(url + '?format=pdf&download=1').set('x-staff', 'admin'); expect(pdf.status).toBe(200); expect(pdf.headers['content-disposition']).toContain('.pdf');
  const page = (await PDFDocument.load(pdf.body)).getPage(0); expect(page.getSize()).toEqual({ width: 288, height: 432 }); expect(page.getRotation().angle).toBe(0);
  expect((await request(app).get(url + '?format=pdf')).status).toBe(401);
  expect((await request(app).get(url + '?format=pdf').set('x-staff', 'admin').set('x-other-tenant', 'yes')).status).toBe(404);
  const [saved] = await db.select().from(upsPackageLabels).where(eq(upsPackageLabels.id, label.id));
  expect(saved.labelBytes).toEqual(original); expect(saved.labelSha256).toBe(label.labelSha256); expect(saved.trackingNumber).toBe('SYNTHETIC-NOT-FOR-SHIPPING');
});
