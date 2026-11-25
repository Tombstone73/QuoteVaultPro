import { beforeAll, afterAll, expect, jest, test } from '@jest/globals';
import { randomUUID, createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import express from 'express';
import request from 'supertest';
import { and, eq } from 'drizzle-orm';
import { db, pool } from '../db';
import { auditLogs } from '@shared/schema';
import { organizations, users, userOrganizations, customers, products, orders, orderLineItems, productionJobs, productionRuns, productionRunMembers, prepressSessions, pickupHandoffs, pickupHandoffItems, stations, productionStationSteps, shipments, shipmentItems, shipmentOrders, shipmentPackages, upsShipmentRateQuotes, upsLabelPurchases, upsPackageLabels, upsLabelPurchaseOrders, fulfillmentEvents, fulfillmentReadyQuantities, invoices, materials, inventoryAdjustments, inventoryReservations, orderMaterialUsage } from '@shared/schema';
import type { FulfillmentProductionOverrideLine } from '@shared/fulfillmentProductionOverride';
import { InventoryRepository } from '../storage/inventory.repo';
import { FulfillmentDashboardRepo } from '../services/fulfillment/repository';
const realConnection=await import('../services/ups/upsConnection');
jest.unstable_mockModule('../services/ups/upsConnection',()=>({...realConnection,upsRateCredentials:async()=>({row:{mode:'live'},accountNumber:'SYNTHETIC',token:'synthetic-not-a-credential',baseUrl:'https://ups.invalid'})}));
const realRates=await import('../services/ups/upsRates');
// Only preflight carrier context is synthetic. The production override, UPS
// response normalization, transactions, storage, guards and readbacks are real.
const party={name:'QA',company:'QA',address1:'1 Synthetic St',address2:null,city:'Carmel',state:'IN',postalCode:'46032',country:'US',phone:'3175550123',email:null};
jest.unstable_mockModule('../services/ups/upsRates',()=>({...realRates,resolveUpsShippingContext:async(organizationId:string,shipmentId:string)=>{
 const [shipment]=await db.select().from(shipments).where(and(eq(shipments.organizationId,organizationId),eq(shipments.id,shipmentId)));
 const packages=await db.select().from(shipmentPackages).where(eq(shipmentPackages.shipmentId,shipmentId));
 return {shipment:{...shipment,packages},origin:party,sender:party,destination:party,packages:packages.map(pkg=>({id:pkg.id,packagingType:'02',weightLbs:1,lengthIn:6,widthIn:4,heightIn:2}))};
}}));
const {registerFulfillmentRoutes}=await import('../routes/fulfillment.routes');
const {registerOrderRoutes}=await import('../routes/orders.routes');
const {FulfillmentService}=await import('../services/fulfillment/service');
const { createProductionRun, recordProductionRunOutcome } = await import('../services/productionRunService');
const org=randomUUID(),otherOrg=randomUUID(),actor=randomUUID();let customer:string,product:string,number=20000;
const app=express();app.use(express.json());
const auth=(req:any,_res:any,next:any)=>{req.organizationId=req.headers['x-tenant']||org;req.orgRole=req.headers['x-role']||'admin';req.user={id:actor,role:req.orgRole};next();};
const admin=(req:any,res:any,next:any)=>['admin','owner'].includes(req.orgRole)?next():res.status(403).json({message:'Admin or owner required'});
beforeAll(async()=>{
 await db.insert(organizations).values([org,otherOrg].map(id=>({id,name:'Shipping workflow QA',slug:id,settings:{preferences:{proofing:{policy:'manual_requested_only' as const}}}})));
 await db.insert(users).values({id:actor,email:`${actor}@example.invalid`,role:'admin'});await db.insert(userOrganizations).values({userId:actor,organizationId:org,role:'admin'});
 [{id:customer}]=await db.insert(customers).values({organizationId:org,companyName:'Synthetic fulfillment customer',creditLimit:'100000',creditLimitConfiguredAt:new Date()}).returning();
 [{id:product}]=await db.insert(products).values({organizationId:org,name:'QA physical product',description:'Isolated',requiresProductionJob:true,requiresProofApproval:false,isActive:true}).returning();
 await db.insert(stations).values(['roll','fulfillment','prepress'].map(key=>({id:randomUUID(),organizationId:org,key,name:key,active:true})));
 await db.insert(productionStationSteps).values({organizationId:org,stationKey:'roll',key:'queued',label:'Queued',sortOrder:0,active:true,triggers:[{type:'on_complete_route',config:{stationKey:'fulfillment',stepKey:'fulfillment'}}]});
 await registerOrderRoutes(app,{isAuthenticated:auth,tenantContext:auth,isAdmin:admin,isAdminOrOwner:admin});registerFulfillmentRoutes(app,{isAuthenticated:auth,tenantContext:auth,requireOrgOwnerAdmin:admin});
},120000);
afterAll(async()=>{await pool.end();});
async function fixture(partial=false, quantity=10){
 const [order]=await db.insert(orders).values({organizationId:org,customerId:customer,createdByUserId:actor,orderNumber:String(++number),state:'open',status:'in_production',shippingMethod:'ship',shippingCents:0,shippingChargeDecision:'free',fulfillmentStatus:partial?'partially_shipped':'pending',
   shipToName:party.name,shipToAddress1:party.address1,shipToCity:party.city,shipToState:party.state,shipToPostalCode:party.postalCode,shipToCountry:party.country}).returning();
 const [line]=await db.insert(orderLineItems).values({orderId:order.id,productId:product,description:'QA line',quantity,unitPrice:'10',totalPrice:String(quantity * 10),workflowState:'in_production',status:'in_production',requiresDesign:false,requiresPrepress:false,requiresProofApproval:false}).returning();
 const [job]=await db.insert(productionJobs).values({organizationId:org,orderId:order.id,lineItemId:line.id,stationKey:'roll',stepKey:'queued',status:'in_progress',startedAt:new Date()}).returning();
 const [invoice]=await db.insert(invoices).values({organizationId:org,orderId:order.id,customerId:customer,createdByUserId:actor,invoiceNumber:++number,status:'paid',total:'100',totalCents:10000,balanceDue:'0',amountPaid:'100'}).returning();
 if(partial){const [shipment]=await db.insert(shipments).values({organizationId:org,orderId:order.id,primaryOrderId:order.id,status:'SHIPPED',createdByUserId:actor}).returning();await db.insert(shipmentItems).values({organizationId:org,shipmentId:shipment.id,orderId:order.id,orderLineItemId:line.id,quantity:3});}
 return {order,line,job,invoice};
}

const overridePath = (orderId: string) => `/api/fulfillment/orders/${orderId}/production-override`;
const previewOverride = async (orderId: string, role = 'employee'): Promise<FulfillmentProductionOverrideLine[]> => {
  const result = await request(app).get(overridePath(orderId)).set('x-role', role);
  expect(result.status).toBe(200);
  return result.body.data;
};
const override = (orderId: string, items: Array<{ lineItemId: string; quantity: number; revision: string }>, clientRequestId = randomUUID(), role = 'employee') =>
  request(app).post(overridePath(orderId)).set('x-role', role).send({ clientRequestId, items });
const overrideItem = ({ lineItemId, revision, maximumQuantity }: FulfillmentProductionOverrideLine, quantity = maximumQuantity) =>
  ({ lineItemId, revision, quantity });
const startDraft = (orderId: string) => request(app).post('/api/fulfillment/shipments')
  .send({ scope: 'SINGLE_ORDER', orderIds: [orderId] });
const readDraft = (shipmentId: string) => request(app).get(`/api/fulfillment/shipments/${shipmentId}`);
const saveDraft = (draft: { id: string; updatedAt: string }, patch: object, clientRequestId = randomUUID()) =>
  request(app).patch(`/api/fulfillment/shipments/${draft.id}`).send({
    expectedUpdatedAt: draft.updatedAt, clientRequestId, ...patch,
  });
const readJob = async (jobId: string) => (await db.select().from(productionJobs).where(eq(productionJobs.id, jobId)))[0];
const readStandaloneQuantity = async (lineId: string) => (await db.select({
  quantity: orderLineItems.standaloneProductionCompletedQuantity,
}).from(orderLineItems).where(eq(orderLineItems.id, lineId)))[0].quantity;
const readReady = async (lineId: string) => (await db.select().from(fulfillmentReadyQuantities)
  .where(eq(fulfillmentReadyQuantities.orderLineItemId, lineId)))[0]?.readyWaitingQuantity ?? 0;
const confirmStock = (orderId: string, lineId: string, quantity: number, clientRequestId = randomUUID()) => request(app)
  .post(`/api/fulfillment/orders/${orderId}/ready-quantities`).set('x-role', 'employee')
  .send({ action: 'confirm_stock', clientRequestId, items: [{ orderLineItemId: lineId, quantityDelta: quantity }] });

async function addStockLine(orderId: string, onHand: number | null, quantity = 20, sharedMaterial?: typeof materials.$inferSelect) {
  const material = sharedMaterial ?? (onHand == null ? null : (await db.insert(materials).values({
    organizationId: org, name: 'Stakes stock', sku: randomUUID(), type: 'each', materialForm: 'each',
    inventoryUnit: 'each', consumptionUnit: 'each', costPerUnit: '1', stockQuantity: String(onHand),
  }).returning())[0]);
  const [supply] = await db.insert(products).values({ organizationId: org, name: 'Economy Yard Sign Stakes', description: 'Stocked supply',
    workflowIntent: 'fulfillment_only', requiresProductionJob: false, primaryMaterialId: material?.id }).returning();
  const [line] = await db.insert(orderLineItems).values({ orderId, productId: supply.id, description: 'Stakes', quantity,
    unitPrice: '2', totalPrice: String(quantity * 2) }).returning();
  return { line, material };
}

test('an empty stock-only draft fills Package 1 when stock arrives and saves a 10/10 split', async () => {
  const f = await fixture();
  await db.delete(productionJobs).where(eq(productionJobs.id, f.job.id));
  await db.delete(orderLineItems).where(eq(orderLineItems.id, f.line.id));
  const { line, material } = await addStockLine(f.order.id, 0);
  const created = await startDraft(f.order.id);
  expect(created.status).toBe(200);
  const draft = created.body.data.shipment;
  const packageId = draft.packages[0].id;
  expect(draft.packages[0]).toMatchObject({ ordinal: 1, packageReference: `${draft.shipmentReference}-P1` });
  expect(draft.items).toEqual([]);
  expect((await readDraft(draft.id)).body.data.canInitializeAllocations).toBe(true);
  const early = await saveDraft(draft, { initializeAllocations: true });
  expect(early.body.code).toBe('QTY_NOT_READY');
  expect((await readDraft(draft.id)).body.data).toMatchObject({ updatedAt: draft.updatedAt, items: [], canInitializeAllocations: true });
  const notes = await saveDraft(draft, { internalNotes: 'Stock arriving today' });
  expect(notes.status).toBe(200);
  const before = notes.body.data;
  await db.update(materials).set({ stockQuantity: '700' }).where(eq(materials.id, material!.id));
  expect((await readDraft(draft.id)).body.data.lineAvailability).toEqual([expect.objectContaining({
    orderLineItemId: line.id, readyQuantity: 20, remainingQuantity: 20, reservedHere: 0,
  })]);

  const requestIds = [randomUUID(), randomUUID()];
  const results = await Promise.all(requestIds.map(id => saveDraft(before, { initializeAllocations: true }, id)));
  expect(results.map(result => result.status).sort()).toEqual([200, 409]);
  const winner = results.findIndex(result => result.status === 200);
  const replay = await saveDraft(before, { initializeAllocations: true }, requestIds[winner]);
  expect(replay.status).toBe(200);
  const persisted = (await readDraft(draft.id)).body.data;
  expect(persisted).toMatchObject({
    internalNotes: 'Stock arriving today', canInitializeAllocations: false,
    items: [expect.objectContaining({ orderLineItemId: line.id, packageId, quantity: 20 })],
    lineAvailability: [expect.objectContaining({ reservedHere: 20 })],
  });
  expect(replay.body.data.items).toEqual(persisted.items);

  const reduced = await saveDraft(persisted, {
    shipmentItems: [{ orderId: f.order.id, orderLineItemId: line.id, packageId, quantity: 10 }],
  });
  expect(reduced.status).toBe(200);
  const added = await request(app).post(`/api/fulfillment/shipments/${draft.id}/packages`)
    .send({ expectedUpdatedAt: reduced.body.data.updatedAt, allocateReady: true });
  expect(added.status).toBe(201);
  const reloaded = (await readDraft(draft.id)).body.data;
  expect(reloaded.items).toHaveLength(2);
  expect(reloaded.items).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: reduced.body.data.items[0].id, packageId, quantity: 10 }),
    expect.objectContaining({ packageId: added.body.data.id, quantity: 10 }),
  ]));
  expect((await db.select().from(materials).where(eq(materials.id, material!.id)))[0].stockQuantity).toBe('700.000000');
});

test('saved empty allocations and legacy drafts cannot be automatically refilled', async () => {
  const f = await fixture();
  const { line, material } = await addStockLine(f.order.id, 0);
  const empty = (await startDraft(f.order.id)).body.data.shipment;
  const savedZero = await saveDraft(empty, { shipmentItems: [] });
  expect(savedZero.status).toBe(200);

  const [legacy] = await db.insert(shipments).values({
    organizationId: org, orderId: f.order.id, primaryOrderId: f.order.id, status: 'DRAFT',
  }).returning();
  await db.insert(shipmentOrders).values({ organizationId: org, shipmentId: legacy.id, orderId: f.order.id });
  const [legacyBox] = await db.insert(shipmentPackages).values({
    organizationId: org, shipmentId: legacy.id, ordinal: 1, packageReference: 'LEGACY-P1',
  }).returning();
  await db.insert(shipmentItems).values({
    organizationId: org, shipmentId: legacy.id, orderId: f.order.id, orderLineItemId: line.id, packageId: legacyBox.id, quantity: 0,
  });
  await db.update(materials).set({ stockQuantity: '700' }).where(eq(materials.id, material!.id));
  for (const id of [empty.id, legacy.id]) {
    const reloaded = (await readDraft(id)).body.data;
    expect(reloaded.canInitializeAllocations).toBe(false);
    expect(reloaded.items).toEqual(id === legacy.id
      ? [expect.objectContaining({ orderLineItemId: line.id, quantity: 0, packageId: legacyBox.id })] : []);
    expect((await saveDraft(reloaded, { initializeAllocations: true })).body.code).toBe('DRAFT_STALE');
    expect((await readDraft(id)).body.data).toMatchObject({ updatedAt: reloaded.updatedAt, items: reloaded.items });
  }
});

test('multiple stock lines default to Package 1 and an omitted line stays omitted when splitting after reload', async () => {
  const f = await fixture();
  const { line, material } = await addStockLine(f.order.id, 700);
  const sibling = await addStockLine(f.order.id, null, 14, material!);
  const draft = (await startDraft(f.order.id)).body.data.shipment;
  const packageId = draft.packages[0].id;
  expect(draft.items).toHaveLength(2);
  expect(draft.items).toEqual(expect.arrayContaining([
    expect.objectContaining({ orderLineItemId: line.id, packageId, quantity: 20 }),
    expect.objectContaining({ orderLineItemId: sibling.line.id, packageId, quantity: 14 }),
  ]));
  const saved = await saveDraft(draft, {
    shipmentItems: [{ orderId: f.order.id, orderLineItemId: line.id, packageId, quantity: 10 }],
  });
  expect(saved.status).toBe(200);
  const reloaded = (await readDraft(draft.id)).body.data;
  const box = await request(app).post(`/api/fulfillment/shipments/${draft.id}/packages`)
    .send({ expectedUpdatedAt: reloaded.updatedAt, allocateReady: true });
  expect(box.status).toBe(201);
  const result = (await readDraft(draft.id)).body.data;
  expect(result.items).toHaveLength(2);
  expect(result.items).toEqual(expect.arrayContaining([
    expect.objectContaining({ orderLineItemId: line.id, packageId, quantity: 10 }),
    expect.objectContaining({ orderLineItemId: line.id, packageId: box.body.data.id, quantity: 10 }),
  ]));
});

test('a mixed 20/20 order shows forty to fulfill, only manufactured units in production, and defaults tracked stock to Package 1', async () => {
  const f = await fixture(false, 20);
  const { line, material } = await addStockLine(f.order.id, 20);
  const service = new FulfillmentService();
  const detail = await service.getOrderDetail(org, f.order.id, 'employee');
  expect(detail).toMatchObject({ remainingQuantity: 40, productionCompleteQuantity: 0 });
  expect(detail.lineItems.find(item => item.id === line.id)).toMatchObject({
    stock: { status: 'tracked', availableQuantity: 20 },
    production: { productionRequired: false, productionCompleteQuantity: 0, readyWaitingQuantity: 20, jobId: null },
  });
  expect(await previewOverride(f.order.id)).toEqual([expect.objectContaining({ lineItemId: f.line.id, outstandingQuantity: 20 })]);
  expect((await confirmStock(f.order.id, line.id, 20)).body.code).toBe('STOCK_CONFIRMATION_UNAVAILABLE');
  await db.update(orderLineItems).set({ materialId: material!.id, requiresInventory: true }).where(eq(orderLineItems.id, line.id));
  expect(await new InventoryRepository().autoDeductInventoryWhenOrderMovesToProduction(org, f.order.id, actor))
    .toMatchObject({ deductedCount: 0 });
  const draft = (await startDraft(f.order.id)).body.data.shipment;
  expect(draft.items).toEqual([expect.objectContaining({ orderLineItemId: line.id, quantity: 20, packageId: draft.packages[0].id })]);
  await service.patchShipment(org, draft.id, { shipmentItems: [{
    orderId: f.order.id, orderLineItemId: line.id, quantity: 3, packageId: draft.packages[0].id,
  }] });
  const dispatch = { suppressBillingAutomation: true, clientRequestId: randomUUID() };
  await service.markShipmentShipped(org, draft.id, actor, dispatch);
  expect(await service.markShipmentShipped(org, draft.id, actor, dispatch)).toMatchObject({ replayed: true });
  expect((await db.select().from(materials).where(eq(materials.id, material!.id)))[0].stockQuantity).toBe('17.000000');
  expect(await db.select().from(inventoryAdjustments).where(eq(inventoryAdjustments.materialId, material!.id)))
    .toEqual([expect.objectContaining({ quantityChange: '-3.000000', userId: actor, orderId: f.order.id })]);
  const next = (await startDraft(f.order.id)).body.data.shipment;
  expect(next.items).toEqual([expect.objectContaining({ orderLineItemId: line.id, quantity: 17, packageId: next.packages[0].id })]);
  expect(await readJob(f.job.id)).toMatchObject({ status: 'in_progress' });
});

test('stock shortage excludes existing manual and PBV2 reservations and zero stock yields an empty Package 1', async () => {
  const f = await fixture();
  const { line, material } = await addStockLine(f.order.id, 10);
  const empty = await addStockLine(f.order.id, 0);
  await db.insert(inventoryReservations).values([
    { organizationId: org, orderId: f.order.id, sourceType: 'MANUAL', sourceKey: material!.sku!, uom: 'EA', qty: '2' },
    { organizationId: org, orderId: f.order.id, sourceType: 'PBV2_MATERIAL', sourceKey: material!.id, uom: 'each', qty: '1' },
  ]);
  const service = new FulfillmentService();
  const before = await service.getOrderDetail(org, f.order.id);
  expect(before.lineItems.find(item => item.id === line.id)).toMatchObject({
    stock: { availableQuantity: 7 }, production: { readyWaitingQuantity: 7, notReadyQuantity: 13 },
  });
  expect(before.lineItems.find(item => item.id === empty.line.id)).toMatchObject({
    stock: { availableQuantity: 0 }, production: { readyWaitingQuantity: 0, notReadyQuantity: 20 },
  });
  const first = (await startDraft(f.order.id)).body.data.shipment;
  expect(first.items).toEqual([expect.objectContaining({ orderLineItemId: line.id, quantity: 7 })]);
  const next = (await startDraft(f.order.id)).body.data.shipment;
  expect(next.packages).toEqual([expect.objectContaining({ ordinal: 1 })]);
  expect(next.items).toEqual([]);
});

test('parallel drafts for separate orders cannot reserve the same stock and dispatch rechecks reduced inventory', async () => {
  const first = await fixture();
  const second = await fixture();
  const { material } = await addStockLine(first.order.id, 12, 10);
  await addStockLine(second.order.id, null, 10, material!);
  const replies = await Promise.all([startDraft(first.order.id), startDraft(second.order.id)]);
  expect(replies.map(reply => reply.status)).toEqual([200, 200]);
  const drafts = replies.map(reply => reply.body.data.shipment);
  expect(drafts.flatMap(draft => draft.items).map(item => item.quantity).sort((a, b) => a - b)).toEqual([2, 10]);
  await db.update(materials).set({ stockQuantity: '5' }).where(eq(materials.id, material!.id));
  const service = new FulfillmentService();
  const largest = drafts.find(draft => draft.items[0].quantity === 10);
  await expect(service.markShipmentShipped(org, largest.id, actor, { suppressBillingAutomation: true }))
    .rejects.toMatchObject({ code: 'QTY_NOT_READY' });
  expect((await service.getShipment(org, largest.id))?.status).toBe('DRAFT');
  expect(await db.select().from(inventoryAdjustments).where(eq(inventoryAdjustments.materialId, material!.id))).toEqual([]);
});

test('legacy ship quantities reduce stock eligibility and ambiguous prior material usage requires reconciliation', async () => {
  const f = await fixture();
  const { line, material } = await addStockLine(f.order.id, 40);
  const [shipped] = await db.insert(shipments).values({ organizationId: org, orderId: f.order.id, primaryOrderId: f.order.id, status: 'SHIPPED' }).returning();
  await db.insert(shipmentItems).values({ organizationId: org, shipmentId: shipped.id, orderId: f.order.id, orderLineItemId: line.id, quantity: 3 });
  const service = new FulfillmentService();
  const before = await service.getOrderDetail(org, f.order.id);
  expect(before.lineItems.find(item => item.id === line.id)).toMatchObject({ production: { shippedQuantity: 3, readyWaitingQuantity: 17 } });
  await db.insert(orderMaterialUsage).values({ orderId: f.order.id, orderLineItemId: line.id,
    materialId: material!.id, quantityUsed: '20', unitOfMeasure: 'each', calculatedBy: 'auto' });
  expect((await service.getOrderDetail(org, f.order.id)).lineItems.find(item => item.id === line.id))
    .toMatchObject({ stock: { status: 'reconcile' }, production: { readyWaitingQuantity: 0, shippedQuantity: 3 } });
  expect(await db.select().from(inventoryAdjustments).where(eq(inventoryAdjustments.materialId, material!.id))).toEqual([]);
});

const productionEvidence = (orderId: string) => db.select().from(fulfillmentEvents).where(and(
  eq(fulfillmentEvents.organizationId, org), eq(fulfillmentEvents.entityId, orderId),
  eq(fulfillmentEvents.eventType, 'FULFILLMENT_PRODUCTION_COMPLETED'),
));

async function markFixtureUnstarted(f: Awaited<ReturnType<typeof fixture>>) {
  await db.delete(productionJobs).where(eq(productionJobs.id, f.job.id));
  await db.update(orderLineItems).set({ workflowState: 'new', status: 'new' }).where(eq(orderLineItems.id, f.line.id));
}

test('an unstarted line with no job completes 12 of 20, then 8, and closes operationally only after shipment', async () => {
  const f = await fixture(false, 20);
  await markFixtureUnstarted(f);
  const [line] = await previewOverride(f.order.id);
  expect(line).toMatchObject({
    lineItemId: f.line.id, action: 'administrative_completion', statusLabel: expect.stringMatching(/not (?:yet )?started|unstarted|new|not in production/i),
    orderedQuantity: 20, productionCompleteQuantity: 0, outstandingQuantity: 20, maximumQuantity: 20,
  });
  const submitted = [overrideItem(line, 12)];
  const ids = [randomUUID(), randomUUID()];
  const attempts = await Promise.all(ids.map(id => override(f.order.id, submitted, id)));
  expect(attempts.map(result => result.status).sort()).toEqual([200, 409]);
  expect(attempts.find(result => result.status === 409)?.body.code).toBe('PRODUCTION_COMPLETION_STALE');
  const winner = ids[attempts.findIndex(result => result.status === 200)];
  const replay = await override(f.order.id, submitted, winner);
  expect(replay.status).toBe(200);
  expect(replay.body.data.replayed).toBe(true);
  const reused = await override(f.order.id, [overrideItem(line, 1)], winner);
  expect(reused.status).toBe(409);
  expect(reused.body.code).toBe('PRODUCTION_COMPLETION_REQUEST_CONFLICT');

  expect(await readStandaloneQuantity(f.line.id)).toBe(12);
  expect(await readReady(f.line.id)).toBe(12);
  expect((await db.select().from(orders).where(eq(orders.id, f.order.id)))[0].state).toBe('open');
  expect(await db.select().from(productionJobs).where(eq(productionJobs.lineItemId, f.line.id))).toEqual([]);
  expect(await db.select().from(productionRuns).where(eq(productionRuns.orderId, f.order.id))).toEqual([]);
  expect(await db.select().from(orderMaterialUsage).where(eq(orderMaterialUsage.orderId, f.order.id))).toEqual([]);
  expect(await db.select().from(shipments).where(eq(shipments.orderId, f.order.id))).toEqual([]);
  expect(await db.select().from(pickupHandoffs).where(eq(pickupHandoffs.orderId, f.order.id))).toEqual([]);
  expect(await productionEvidence(f.order.id)).toEqual([expect.objectContaining({
    actorUserId: actor, payloadJson: expect.objectContaining({
      completedAt: expect.any(String), items: [expect.objectContaining({ lineItemId: f.line.id, quantity: 12, newProduction: 12, mode: 'administrative_completion' })],
    }),
  })]);

  const service = new FulfillmentService();
  const first = await startDraft(f.order.id);
  expect(first.status).toBe(200);
  expect(first.body.data.shipment.items).toEqual([expect.objectContaining({ orderLineItemId: f.line.id, quantity: 12 })]);
  await service.markShipmentShipped(org, first.body.data.shipmentId, actor, { suppressBillingAutomation: true, requireProductionComplete: true });
  expect(await readReady(f.line.id)).toBe(0);

  const [remaining] = await previewOverride(f.order.id);
  expect(remaining).toMatchObject({
    lineItemId: f.line.id, orderedQuantity: 20, productionCompleteQuantity: 12, outstandingQuantity: 8, maximumQuantity: 8,
  });
  expect((await override(f.order.id, [overrideItem(remaining, 9)])).status).toBe(409);
  expect(await readStandaloneQuantity(f.line.id)).toBe(12);
  expect((await override(f.order.id, [overrideItem(remaining)])).status).toBe(200);
  expect(await readStandaloneQuantity(f.line.id)).toBe(20);
  expect(await readReady(f.line.id)).toBe(8);
  expect((await db.select().from(orders).where(eq(orders.id, f.order.id)))[0].state).toBe('production_complete');
  const [physical] = await new FulfillmentDashboardRepo().listLineEligibility(org, { lineItemIds: [f.line.id] });
  expect(physical.projection).toMatchObject({
    productionCompleteQuantity: 20, shippedQuantity: 12, pickedUpQuantity: 0, remainingQuantity: 8, readyWaitingQuantity: 8,
  });
  expect(await db.select().from(shipments).where(eq(shipments.orderId, f.order.id))).toEqual([
    expect.objectContaining({ id: first.body.data.shipmentId, status: 'SHIPPED' }),
  ]);
  const jobsAfter = await db.select().from(productionJobs).where(eq(productionJobs.lineItemId, f.line.id));
  expect(jobsAfter.filter(job => job.stationKey !== 'fulfillment')).toEqual([]);

  const second = await startDraft(f.order.id);
  expect(second.status).toBe(200);
  expect(second.body.data.shipment.items).toEqual([expect.objectContaining({ orderLineItemId: f.line.id, quantity: 8 })]);
  const { seedDefaultPillsForOrg } = await import('../services/orderStatusPillService');
  await seedDefaultPillsForOrg(org);
  await service.markShipmentShipped(org, second.body.data.shipmentId, actor, { suppressBillingAutomation: true, requireProductionComplete: true });
  const [closed] = await db.select().from(orders).where(eq(orders.id, f.order.id));
  expect(closed.fulfillmentStatus).toBe('shipped');
  // Operational completion does not require or manufacture a financial close.
  expect(['operationally_complete', 'completed']).toContain(closed.status);
  expect(await readReady(f.line.id)).toBe(0);
  expect((await previewOverride(f.order.id)).every(item => item.maximumQuantity === 0)).toBe(true);
  expect((await db.select().from(invoices).where(eq(invoices.id, f.invoice.id)))[0]).toEqual(f.invoice);
});

test('native Production intake skips the fully reconciled line and schedules a partial sibling without resetting its quantities', async () => {
  const f = await fixture();
  await markFixtureUnstarted(f);
  const [sibling] = await db.insert(orderLineItems).values({
    orderId: f.order.id, productId: product, description: 'Partially reconciled sibling', quantity: 20,
    unitPrice: '10', totalPrice: '200', workflowState: 'new', status: 'new',
    requiresDesign: false, requiresPrepress: false, requiresProofApproval: false,
  }).returning();
  await db.insert(stations).values({ id: randomUUID(), organizationId: org, key: 'flatbed', name: 'Flatbed', active: true });
  await db.insert(productionStationSteps).values({
    organizationId: org, stationKey: 'flatbed', key: 'queued', label: 'Queued', sortOrder: 0, active: true,
  });
  const preview = await previewOverride(f.order.id);
  expect((await override(f.order.id, preview.map(item => overrideItem(item, item.lineItemId === sibling.id ? 12 : 10)))).status).toBe(200);
  const [finished] = await db.select().from(orderLineItems).where(eq(orderLineItems.id, f.line.id));

  const { canonicalProductionOperations } = await import('../services/canonicalProductionOperations');
  const { appendEvent, loadProductionLineItemStatusRulesForOrganization } = await import('../productionHelpers');
  const result = await canonicalProductionOperations.intakeLineItems({
    organizationId: org, orderId: f.order.id, actorUserId: actor,
    loadRoutingRules: loadProductionLineItemStatusRulesForOrganization, appendEvent,
  });
  expect(result).toMatchObject({ success: true, data: { createdJobCount: 1, affectedLineItemIds: [sibling.id], failed: [] } });
  expect(await db.select().from(productionJobs).where(eq(productionJobs.orderId, f.order.id))).toEqual([
    expect.objectContaining({ lineItemId: sibling.id, stationKey: 'flatbed', status: 'queued' }),
  ]);
  expect((await db.select().from(orderLineItems).where(eq(orderLineItems.id, f.line.id)))[0]).toEqual(finished);
  expect(await readStandaloneQuantity(sibling.id)).toBe(12);
  expect(await readReady(sibling.id)).toBe(12);
  expect((await previewOverride(f.order.id)).find(item => item.lineItemId === sibling.id)).toMatchObject({
    action: 'tracked_completion', outstandingQuantity: 8, maximumQuantity: 8,
  });
});


test('an intermediate Roll job stays active only for the remainder and does not create a fictitious finishing job', async () => {
  const f = await fixture(false, 20);
  await db.insert(productionStationSteps).values({
    organizationId: org, stationKey: 'roll', key: 'qa_before_finishing', label: 'Before finishing', sortOrder: 1, active: true,
    triggers: [{ type: 'on_complete_route', config: { stationKey: 'finishing', stepKey: 'finishing' } }],
  });
  await db.update(productionJobs).set({ stepKey: 'qa_before_finishing' }).where(eq(productionJobs.id, f.job.id));
  const [preview] = await previewOverride(f.order.id);
  expect(preview).toMatchObject({
    lineItemId: f.line.id, action: 'administrative_completion', maximumQuantity: 20, outstandingQuantity: 20,
  });
  const first = await override(f.order.id, [overrideItem(preview, 12)]);
  expect(first.status).toBe(200);
  expect(await readStandaloneQuantity(f.line.id)).toBe(12);
  expect(await readReady(f.line.id)).toBe(12);
  expect(await readJob(f.job.id)).toMatchObject({ stationKey: 'roll', stepKey: 'qa_before_finishing', status: 'in_progress' });
  const [remaining] = await previewOverride(f.order.id);
  expect(remaining).toMatchObject({ maximumQuantity: 8, outstandingQuantity: 8 });
  const second = await override(f.order.id, [overrideItem(remaining)]);
  expect(second.status).toBe(200);
  expect(await readStandaloneQuantity(f.line.id)).toBe(20);
  expect(await readReady(f.line.id)).toBe(20);
  const history = await db.select().from(productionJobs).where(eq(productionJobs.lineItemId, f.line.id));
  expect(history.filter(job => job.stationKey !== 'fulfillment')).toEqual([
    expect.objectContaining({ id: f.job.id, stationKey: 'roll', stepKey: 'qa_before_finishing', status: 'void' }),
  ]);
  expect(await db.select().from(orderMaterialUsage).where(eq(orderMaterialUsage.orderId, f.order.id))).toEqual([]);
});

test('an unselected line stays untouched and a canceled line or Order cannot be completed', async () => {
  const f = await fixture();
  await markFixtureUnstarted(f);
  const [unselected, canceled] = await db.insert(orderLineItems).values([
    { orderId: f.order.id, productId: product, description: 'Unselected', quantity: 4, unitPrice: '10', totalPrice: '40', workflowState: 'new', status: 'new' },
    { orderId: f.order.id, productId: product, description: 'Canceled', quantity: 4, unitPrice: '10', totalPrice: '40', workflowState: 'canceled', status: 'canceled' },
  ]).returning();
  const preview = await previewOverride(f.order.id);
  const selected = preview.find(line => line.lineItemId === f.line.id)!;
  const untouched = preview.find(line => line.lineItemId === unselected.id)!;
  expect(selected).toMatchObject({ maximumQuantity: 10 });
  expect(untouched).toMatchObject({ maximumQuantity: 4 });
  expect(preview.find(line => line.lineItemId === canceled.id)).toMatchObject({
    action: 'blocked', maximumQuantity: 0, blockedReason: expect.stringMatching(/canceled|void/i),
  });
  const rejected = await override(f.order.id, [
    overrideItem(selected), { lineItemId: canceled.id, quantity: 4, revision: selected.revision },
  ]);
  expect(rejected.status).toBe(409);
  expect(await readStandaloneQuantity(f.line.id)).toBe(0);
  expect(await readReady(f.line.id)).toBe(0);
  expect(await productionEvidence(f.order.id)).toEqual([]);
  expect((await override(f.order.id, [overrideItem(selected)])).status).toBe(200);
  expect(await readReady(f.line.id)).toBe(10);
  expect(await readStandaloneQuantity(unselected.id)).toBe(0);
  expect(await readReady(unselected.id)).toBe(0);
  expect(await readStandaloneQuantity(canceled.id)).toBe(0);

  await db.update(orders).set({ canceledAt: new Date().toISOString() }).where(eq(orders.id, f.order.id));
  expect((await previewOverride(f.order.id)).every(line => line.maximumQuantity === 0)).toBe(true);
  expect((await override(f.order.id, [overrideItem(untouched)])).status).toBe(409);
  expect(await readReady(unselected.id)).toBe(0);
});

test('a prior pickup cannot be made ready again by administrative production completion', async () => {
  const f = await fixture(false, 20);
  await markFixtureUnstarted(f);
  await db.update(orders).set({ shippingMethod: 'pickup' }).where(eq(orders.id, f.order.id));
  const [initial] = await previewOverride(f.order.id);
  expect((await override(f.order.id, [overrideItem(initial, 12)])).status).toBe(200);
  const service = new FulfillmentService();
  const ticket = await service.createOrGetPickupTicket(org, f.order.id, actor);
  await service.recordPickupHandoff(org, ticket.id, {
    items: [{ orderLineItemId: f.line.id, quantity: 12 }], clientRequestId: randomUUID(), requireProductionComplete: true,
  }, actor);
  const history = await db.select().from(pickupHandoffItems).where(eq(pickupHandoffItems.orderLineItemId, f.line.id));
  expect(history).toEqual([expect.objectContaining({ quantity: 12 })]);
  const [remaining] = await previewOverride(f.order.id);
  expect(remaining).toMatchObject({ productionCompleteQuantity: 12, outstandingQuantity: 8, maximumQuantity: 8 });
  expect((await override(f.order.id, [overrideItem(remaining)])).status).toBe(200);
  expect(await readReady(f.line.id)).toBe(8);
  expect(await db.select().from(pickupHandoffItems).where(eq(pickupHandoffItems.orderLineItemId, f.line.id))).toEqual(history);
});


test('a failure after readiness writes rolls back the quantity, readiness, and request receipt', async () => {
  const f = await fixture();
  await markFixtureUnstarted(f);
  const [line] = await previewOverride(f.order.id);
  const id = randomUUID();
  const adjust = FulfillmentDashboardRepo.prototype.adjustReadyQuantitiesInTransaction;
  const injectedFailure = jest.spyOn(FulfillmentDashboardRepo.prototype, 'adjustReadyQuantitiesInTransaction')
    .mockImplementationOnce(async function (this: FulfillmentDashboardRepo, ...args: Parameters<typeof adjust>) {
      expect(await adjust.apply(this, args)).toMatchObject({ ok: true });
      throw new Error('Synthetic failure after readiness write');
    });
  try {
    expect((await override(f.order.id, [overrideItem(line)], id)).status).toBe(500);
    expect(injectedFailure).toHaveBeenCalledTimes(1);
  } finally {
    injectedFailure.mockRestore();
  }
  expect(await readStandaloneQuantity(f.line.id)).toBe(0);
  expect(await readReady(f.line.id)).toBe(0);
  expect(await productionEvidence(f.order.id)).toEqual([]);
  expect((await db.select().from(orders).where(eq(orders.id, f.order.id)))[0].state).toBe('open');

  const retry = await override(f.order.id, [overrideItem(line)], id);
  expect(retry.status).toBe(200);
  expect(retry.body.data.replayed).toBe(false);
  expect(await readStandaloneQuantity(f.line.id)).toBe(10);
  expect(await readReady(f.line.id)).toBe(10);
  expect(await productionEvidence(f.order.id)).toHaveLength(1);
});

test('a Prepress owner stays visible but only an admin can reconcile that ownership', async () => {
  const f = await fixture();
  await db.update(productionJobs).set({ stationKey: 'prepress', stepKey: 'prepress' }).where(eq(productionJobs.id, f.job.id));
  await db.update(orderLineItems).set({ workflowState: 'in_prepress', requiresPrepress: true }).where(eq(orderLineItems.id, f.line.id));
  const [employee] = await previewOverride(f.order.id);
  expect(employee).toMatchObject({
    lineItemId: f.line.id, action: 'blocked', maximumQuantity: 0,
    statusLabel: expect.stringMatching(/prepress/i), blockedReason: expect.stringMatching(/admin|owner/i),
  });
  const rejected = await override(f.order.id, [overrideItem(employee, 10)]);
  expect(rejected.status).toBe(409);
  expect(await readJob(f.job.id)).toMatchObject({ status: 'in_progress' });
  expect(await readReady(f.line.id)).toBe(0);

  const [admin] = await previewOverride(f.order.id, 'admin');
  expect(admin).toMatchObject({ lineItemId: f.line.id, action: 'administrative_completion', maximumQuantity: 10 });
  const completed = await override(f.order.id, [overrideItem(admin)], randomUUID(), 'admin');
  expect(completed.status).toBe(200);
  expect(await readStandaloneQuantity(f.line.id)).toBe(10);
  expect(await readReady(f.line.id)).toBe(10);
  expect(await readJob(f.job.id)).toMatchObject({ status: 'void' });
});


test('live Prepress ownership, unresolved required proof and held work stay protected during administrative override', async () => {
  const f = await fixture();
  await db.update(productionJobs).set({ stationKey: 'prepress', stepKey: 'prepress' }).where(eq(productionJobs.id, f.job.id));
  await db.update(orderLineItems).set({ workflowState: 'in_prepress', requiresPrepress: true }).where(eq(orderLineItems.id, f.line.id));
  const [session] = await db.insert(prepressSessions).values({
    organizationId: org, orderId: f.order.id, lineItemId: f.line.id, status: 'active',
    startedByUserId: actor, lockOwnerUserId: actor,
  }).returning();

  const [prepress] = await previewOverride(f.order.id, 'admin');
  expect(prepress).toMatchObject({ action: 'blocked', maximumQuantity: 0, blockedReason: expect.stringMatching(/prepress.*session/i) });
  expect((await override(f.order.id, [overrideItem(prepress, 10)], randomUUID(), 'admin')).status).toBe(409);
  expect((await db.select().from(prepressSessions).where(eq(prepressSessions.id, session.id)))[0]).toEqual(session);
  expect(await readJob(f.job.id)).toMatchObject({ status: 'in_progress' });

  const proof = await fixture();
  await markFixtureUnstarted(proof);
  await db.update(orderLineItems).set({ requiresProofApproval: true }).where(eq(orderLineItems.id, proof.line.id));
  const [pending] = await previewOverride(proof.order.id, 'admin');
  expect(pending).toMatchObject({ action: 'blocked', maximumQuantity: 0, blockedReason: expect.stringMatching(/proof/i) });
  expect((await override(proof.order.id, [overrideItem(pending, 10)], randomUUID(), 'admin')).status).toBe(409);
  expect(await productionEvidence(f.order.id)).toEqual([]);
  expect(await productionEvidence(proof.order.id)).toEqual([]);
  expect(await readStandaloneQuantity(proof.line.id)).toBe(0);
  expect(await readReady(proof.line.id)).toBe(0);

  const held = await fixture();
  await markFixtureUnstarted(held);
  await db.update(orderLineItems).set({ workflowState: 'on_hold', standaloneProductionCompletedQuantity: 3 })
    .where(eq(orderLineItems.id, held.line.id));
  const [onlyReadiness] = await previewOverride(held.order.id, 'admin');
  expect(onlyReadiness).toMatchObject({
    action: 'confirm_readiness', maximumQuantity: 3, outstandingQuantity: 7, blockedReason: expect.stringMatching(/resume.*workflow/i),
  });
  expect((await override(held.order.id, [overrideItem(onlyReadiness, 4)], randomUUID(), 'admin')).status).toBe(409);
  expect((await override(held.order.id, [overrideItem(onlyReadiness)], randomUUID(), 'admin')).status).toBe(200);
  expect(await readStandaloneQuantity(held.line.id)).toBe(3);
  expect(await readReady(held.line.id)).toBe(3);
  const [blocked] = await previewOverride(held.order.id, 'admin');
  expect(blocked).toMatchObject({ action: 'blocked', maximumQuantity: 0, blockedReason: expect.stringMatching(/resume.*workflow/i) });
});


test('conflicting fulfillment history and open inventory reservations must be reconciled before direct completion', async () => {
  const historical = await fixture(true, 20);
  await markFixtureUnstarted(historical);
  const historicalItems = await db.select().from(shipmentItems).where(eq(shipmentItems.orderId, historical.order.id));
  const [inconsistent] = await previewOverride(historical.order.id);
  expect(inconsistent).toMatchObject({
    action: 'blocked', maximumQuantity: 0, blockedReason: expect.stringMatching(/previously fulfilled.*exceed recorded production/i),
  });
  const historyRejected = await override(historical.order.id, [overrideItem(inconsistent, 3)]);
  expect(historyRejected.status).toBe(409);
  expect(historyRejected.body.code).toBe('PRODUCTION_LINE_INELIGIBLE');
  expect(await db.select().from(shipmentItems).where(eq(shipmentItems.orderId, historical.order.id))).toEqual(historicalItems);
  expect(await readReady(historical.line.id)).toBe(0);

  const reserved = await fixture();
  await markFixtureUnstarted(reserved);
  const [reservation] = await db.insert(inventoryReservations).values({
    organizationId: org, orderId: reserved.order.id, orderLineItemId: reserved.line.id,
    sourceType: 'MANUAL', sourceKey: 'QA-RESERVATION', uom: 'each', qty: '10', createdByUserId: actor,
  }).returning();
  const [openReservation] = await previewOverride(reserved.order.id);
  expect(openReservation).toMatchObject({
    action: 'blocked', maximumQuantity: 0, blockedReason: expect.stringMatching(/material reservations/i),
  });
  expect((await override(reserved.order.id, [overrideItem(openReservation, 10)])).status).toBe(409);
  expect((await db.select().from(inventoryReservations).where(eq(inventoryReservations.id, reservation.id)))[0]).toEqual(reservation);
  expect(await readStandaloneQuantity(reserved.line.id)).toBe(0);
  expect(await readReady(reserved.line.id)).toBe(0);
});


test('override completes twenty, audits exactly once, and racing new drafts reserve twenty in total', async () => {
  const f = await fixture(false, 20);
  const [line] = await previewOverride(f.order.id);
  expect(line).toMatchObject({ lineItemId: f.line.id, action: 'tracked_completion', orderedQuantity: 20, maximumQuantity: 20, productionCompleteQuantity: 0 });
  const id = randomUUID();
  const completed = await Promise.all([override(f.order.id, [overrideItem(line)], id), override(f.order.id, [overrideItem(line)], id)]);
  expect(completed.map(response => [response.status, response.body.data?.replayed]).sort()).toEqual([[200, false], [200, true]]);
  expect(await readJob(f.job.id)).toMatchObject({ status: 'done' });
  expect(await readReady(f.line.id)).toBe(20);
  const events = await db.select().from(fulfillmentEvents).where(and(eq(fulfillmentEvents.entityId, f.order.id),
    eq(fulfillmentEvents.eventType, 'FULFILLMENT_PRODUCTION_COMPLETED')));
  expect(events).toEqual([expect.objectContaining({ actorUserId: actor, payloadJson: expect.objectContaining({
    items: [expect.objectContaining({ lineItemId: f.line.id, quantity: 20, newProduction: 20, mode: 'tracked_completion' })],
  }) })]);
  const drafts = await Promise.all([startDraft(f.order.id), startDraft(f.order.id)]);
  expect(drafts.map(result => result.status)).toEqual([200, 200]);
  const saved = drafts.map(result => result.body.data.shipment);
  expect(saved.map(draft => draft.packages[0].ordinal)).toEqual([1, 1]);
  expect(saved.flatMap(draft => draft.items)).toEqual([expect.objectContaining({ orderLineItemId: f.line.id, quantity: 20 })]);
  const allocated = saved.find(draft => draft.items.length > 0);
  expect(allocated.items[0].packageId).toBe(allocated.packages[0].id);
  expect((await db.select().from(invoices).where(eq(invoices.id, f.invoice.id)))[0]).toEqual(f.invoice);
});

test('override records 12 of 20 and a second line independently, then completes the remaining eight after dispatch', async () => {
  const f = await fixture(false, 20);
  const [second] = await db.insert(orderLineItems).values({ orderId: f.order.id, productId: product, description: 'Second run',
    quantity: 4, unitPrice: '10', totalPrice: '40', workflowState: 'in_production', status: 'in_production', requiresProofApproval: false }).returning();
  const [secondJob] = await db.insert(productionJobs).values({ organizationId: org, orderId: f.order.id, lineItemId: second.id,
    stationKey: 'roll', stepKey: 'queued', status: 'in_progress', startedAt: new Date() }).returning();
  const lines = await previewOverride(f.order.id);
  const selected = lines.map(line => overrideItem(line, line.lineItemId === f.line.id ? 12 : 4));
  const saved = await override(f.order.id, selected);
  expect(saved.status).toBe(200);
  expect((await override(f.order.id, selected)).body.code).toBe('PRODUCTION_COMPLETION_STALE');
  expect(await readJob(f.job.id)).toMatchObject({ status: 'in_progress' });
  expect(await readStandaloneQuantity(f.line.id)).toBe(12);
  expect(await readJob(secondJob.id)).toMatchObject({ status: 'done' });
  expect((await db.select().from(orders).where(eq(orders.id, f.order.id)))[0].status).toBe('in_production');
  const firstDraft = await startDraft(f.order.id);
  expect(firstDraft.status).toBe(200);
  expect(firstDraft.body.data.shipment.items).toEqual(expect.arrayContaining([
    expect.objectContaining({ orderLineItemId: f.line.id, quantity: 12 }),
    expect.objectContaining({ orderLineItemId: second.id, quantity: 4 }),
  ]));
  const service = new FulfillmentService();
  await service.markShipmentShipped(org, firstDraft.body.data.shipmentId, actor, { suppressBillingAutomation: true, requireProductionComplete: true });
  expect(await readJob(f.job.id)).toMatchObject({ status: 'in_progress' });
  expect(await readStandaloneQuantity(f.line.id)).toBe(12);
  const afterDispatch = await previewOverride(f.order.id);
  expect(afterDispatch).toEqual(expect.arrayContaining([
    expect.objectContaining({ lineItemId: f.line.id, maximumQuantity: 8, productionCompleteQuantity: 12, outstandingQuantity: 8 }),
    expect.objectContaining({ lineItemId: second.id, maximumQuantity: 0, action: 'blocked' }),
  ]));
  const remainder = afterDispatch.find(item => item.lineItemId === f.line.id)!;
  expect((await override(f.order.id, [overrideItem(remainder)])).status).toBe(200);
  expect(await readJob(f.job.id)).toMatchObject({ status: 'done' });
  const next = await startDraft(f.order.id);
  expect(next.body.data.shipment.items).toEqual([expect.objectContaining({ orderLineItemId: f.line.id, quantity: 8 })]);
});

test('readiness-only reconciliation keeps completed production intact and a new draft defaults to seven after shipping three', async () => {
  const f = await fixture();
  expect((await complete(f.order.id)).status).toBe(200);
  const done = await readJob(f.job.id);
  const [line] = await previewOverride(f.order.id);
  expect(line).toMatchObject({ action: 'confirm_readiness', productionCompleteQuantity: 10, outstandingQuantity: 0, maximumQuantity: 10 });
  expect((await override(f.order.id, [overrideItem(line)])).status).toBe(200);
  expect(await readJob(f.job.id)).toEqual(done);
  expect(await productionEvidence(f.order.id)).toEqual([expect.objectContaining({ payloadJson: expect.objectContaining({
    items: [expect.objectContaining({ lineItemId: f.line.id, quantity: 10, newProduction: 0, mode: 'confirm_readiness' })],
  }) })]);
  const service = new FulfillmentService();
  const first = (await startDraft(f.order.id)).body.data.shipment;
  await service.patchShipment(org, first.id, { shipmentItems: [{
    orderId: f.order.id, orderLineItemId: f.line.id, packageId: first.packages[0].id, quantity: 3,
  }] });
  await service.markShipmentShipped(org, first.id, actor, { suppressBillingAutomation: true });
  const next = await startDraft(f.order.id);
  expect(next.body.data.shipment.items).toEqual([expect.objectContaining({ orderLineItemId: f.line.id, quantity: 7 })]);
});

test('a combined Production run keeps both unfinished members and remains their completion authority', async () => {
  const f = await fixture(false, 20);
  const [line] = await previewOverride(f.order.id);
  expect((await override(f.order.id, [overrideItem(line, 12)])).status).toBe(200);
  const [otherLine] = await db.insert(orderLineItems).values({
    orderId: f.order.id, productId: product, description: 'Other member', quantity: 4, unitPrice: '10', totalPrice: '40',
    workflowState: 'in_production', status: 'in_production',
  }).returning();
  const [otherJob] = await db.insert(productionJobs).values({
    organizationId: org, orderId: f.order.id, lineItemId: otherLine.id,
    stationKey: 'roll', stepKey: 'queued', status: 'in_progress',
  }).returning();
  const { run } = await createProductionRun({ organizationId: org, actorUserId: actor, orderId: f.order.id,
    stationKey: 'roll', members: [{ productionJobId: f.job.id }, { productionJobId: otherJob.id }] });
  const members = await db.select().from(productionRunMembers).where(eq(productionRunMembers.productionRunId, run.id));
  expect(members).toEqual(expect.arrayContaining([
    expect.objectContaining({ orderLineItemId: f.line.id, allocatedQuantity: 8 }),
    expect.objectContaining({ orderLineItemId: otherLine.id, allocatedQuantity: 4 }),
  ]));
  const preview = await previewOverride(f.order.id);
  for (const lineItemId of [f.line.id, otherLine.id]) {
    expect(preview.find(item => item.lineItemId === lineItemId)).toMatchObject({
      action: 'blocked', maximumQuantity: 0, blockedReason: expect.stringMatching(/run/i),
    });
  }
  const selected = preview.find(item => item.lineItemId === f.line.id)!;
  const rejected = await override(f.order.id, [overrideItem(selected, 8)]);
  expect(rejected.status).toBe(409);
  expect(await readJob(f.job.id)).toMatchObject({ status: 'in_progress' });
  expect(await readJob(otherJob.id)).toMatchObject({ status: 'in_progress' });
  expect(await readStandaloneQuantity(f.line.id)).toBe(12);
  expect(await readReady(otherLine.id)).toBe(0);
  expect((await db.select().from(productionRuns).where(eq(productionRuns.id, run.id)))[0].status).toBe(run.status);
  expect(await db.select().from(productionRunMembers).where(eq(productionRunMembers.productionRunId, run.id))).toEqual(members);

  await recordProductionRunOutcome({ organizationId: org, actorUserId: actor, runId: run.id,
    members: members.map(member => ({ memberId: member.id, successfulQuantity: member.allocatedQuantity, damagedQuantity: 0 })) });
  expect(await readJob(f.job.id)).toMatchObject({ status: 'done' });
  expect(await readJob(otherJob.id)).toMatchObject({ status: 'done' });
  expect((await db.select().from(orders).where(eq(orders.id, f.order.id)))[0].state).toBe('production_complete');
});


test('adding Package 2 fills only the remaining ten and stale concurrent Add Box is rejected', async () => {
  const f = await fixture(false, 20);
  const [line] = await previewOverride(f.order.id);
  expect((await override(f.order.id, [overrideItem(line)])).status).toBe(200);
  const service = new FulfillmentService();
  const draft = (await startDraft(f.order.id)).body.data.shipment;
  const saved = (await service.patchShipment(org, draft.id, { shipmentItems: [{
    orderId: f.order.id, orderLineItemId: f.line.id, quantity: 10, packageId: draft.packages[0].id,
  }] }))!;
  const addBox = () => request(app).post(`/api/fulfillment/shipments/${draft.id}/packages`)
    .send({ expectedUpdatedAt: saved.updatedAt.toISOString(), allocateReady: true });
  const added = await Promise.all([addBox(), addBox()]);
  expect(added.map(result => result.status).sort()).toEqual([201, 409]);
  const result = (await service.getShipment(org, draft.id))!;
  expect(result.items).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: saved.items[0].id, packageId: result.packages[0].id, quantity: 10 }),
    expect.objectContaining({ packageId: result.packages[1].id, quantity: 10 }),
  ]));
  expect(result.items).toHaveLength(2);
});

test('untracked stock uses a separate reason-free confirmation with the existing permission and audit boundary', async () => {
  const f = await fixture();
  const [supply] = await db.insert(products).values({ organizationId: org, name: 'Stakes', description: 'Stocked supply',
    workflowIntent: 'fulfillment_only', requiresProductionJob: false }).returning();
  const [line] = await db.insert(orderLineItems).values({ orderId: f.order.id, productId: supply.id,
    description: 'Stakes', quantity: 5, unitPrice: '2', totalPrice: '10' }).returning();
  expect((await request(app).get(overridePath(f.order.id)).set('x-role', 'member')).status).toBe(403);
  expect((await request(app).get(overridePath(f.order.id)).set('x-tenant', otherOrg)).status).toBe(404);
  const previews = await previewOverride(f.order.id);
  const produced = previews.find(item => item.lineItemId === f.line.id)!;
  expect(previews.map(item => item.lineItemId)).toEqual([f.line.id]);
  const invalidItem = { lineItemId: line.id, revision: produced.revision, quantity: 5 };
  expect((await override(f.order.id, [overrideItem(produced), invalidItem])).status).toBe(409);
  expect(await readJob(f.job.id)).toMatchObject({ status: 'in_progress' });
  expect(await readStandaloneQuantity(f.line.id)).toBe(0);
  expect(await readReady(f.line.id)).toBe(0);
  const confirmationId = randomUUID();
  expect((await confirmStock(f.order.id, line.id, 5, confirmationId)).status).toBe(200);
  expect((await confirmStock(f.order.id, line.id, 5, confirmationId)).status).toBe(200);
  expect(await db.select().from(fulfillmentEvents).where(and(eq(fulfillmentEvents.entityId, f.order.id),
    eq(fulfillmentEvents.eventType, 'FULFILLMENT_READY')))).toEqual([expect.objectContaining({
      actorUserId: actor, payloadJson: expect.objectContaining({ source: 'operator_stock_confirmation' }),
    })]);
  const draft = (await startDraft(f.order.id)).body.data.shipment;
  expect(draft.items).toEqual([expect.objectContaining({ orderLineItemId: line.id, quantity: 5 })]);
  expect(await db.select().from(productionJobs).where(eq(productionJobs.lineItemId, line.id))).toEqual([]);
});

const complete=(id:string,body:object={confirmBypass:true,closeJobOverride:true,reconciliationReason:'completed_outside_printershero'})=>request(app).post(`/api/orders/${id}/complete-production`).send(body);
test('Fulfillment exposes canonical admin authority; production-only API completion preserves partial shipping and financial history',async()=>{
 const f=await fixture(true);const service=new FulfillmentService();
 expect((await service.getOrderDetail(org,f.order.id,'employee')).permissions.canCompleteProductionOverride).toBe(false);expect((await service.getOrderDetail(org,f.order.id,'admin')).permissions.canCompleteProductionOverride).toBe(true);
 const beforeItems=await db.select().from(shipmentItems).where(eq(shipmentItems.orderId,f.order.id));
 const result=await complete(f.order.id);expect(result.status).toBe(200);const [saved]=await db.select().from(orders).where(eq(orders.id,f.order.id));expect(saved.state).toBe('production_complete');expect(saved.fulfillmentStatus).toBe(f.order.fulfillmentStatus);
 expect(await db.select().from(shipmentItems).where(eq(shipmentItems.orderId,f.order.id))).toEqual(beforeItems);expect((await db.select().from(invoices).where(eq(invoices.id,f.invoice.id)))[0]).toEqual(f.invoice);
 expect(await db.select().from(productionJobs).where(and(eq(productionJobs.lineItemId,f.line.id),eq(productionJobs.stationKey,'fulfillment')))).toEqual([expect.objectContaining({status:'queued'})]);
 expect((await complete(f.order.id)).status).toBe(200);expect(await db.select().from(productionJobs).where(and(eq(productionJobs.lineItemId,f.line.id),eq(productionJobs.stationKey,'fulfillment')))).toHaveLength(1);
});
test('override permissions, tenant boundaries and current canonical prerequisites are rechecked on submission',async()=>{
 const f=await fixture();expect((await request(app).post(`/api/orders/${f.order.id}/complete-production`).set('x-role','employee').send({confirmBypass:true})).status).toBe(403);
 expect((await request(app).post(`/api/orders/${f.order.id}/complete-production`).set('x-tenant',otherOrg).send({confirmBypass:true})).status).toBe(404);
 await db.update(productionJobs).set({stationKey:'prepress',stepKey:'prepress'}).where(eq(productionJobs.id,f.job.id));await db.update(orderLineItems).set({workflowState:'in_prepress',requiresPrepress:true}).where(eq(orderLineItems.id,f.line.id));
 const stale=await complete(f.order.id,{});expect(stale.status).toBe(409);expect(stale.body.code).toBe('PRODUCTION_BYPASS_CONFIRMATION_REQUIRED');expect((await db.select().from(productionJobs).where(eq(productionJobs.id,f.job.id)))[0].status).toBe('in_progress');
});
const gif=readFileSync('server/tests/fixtures/shipping-labels/portrait.gif');

async function createRatedShipment(orderId: string) {
  const [line] = await previewOverride(orderId);
  expect((await override(orderId, [overrideItem(line)])).status).toBe(200);
  const started = await startDraft(orderId);
  expect(started.status).toBe(200);
  const draft = started.body.data.shipment;
  const [box] = await db.update(shipmentPackages).set({
    upsPackagingType: '02', weightLbs: '1', dimLengthIn: '6', dimWidthIn: '4', dimHeightIn: '2',
  }).where(eq(shipmentPackages.id, draft.packages[0].id)).returning();
  const [quote] = await db.insert(upsShipmentRateQuotes).values({
    organizationId: org, shipmentId: draft.id, environment: 'live',
    requestFingerprint: realRates.upsShippingFingerprint({
      origin: party, sender: party, destination: party, accountNumber: 'SYNTHETIC', shipDate: null,
      packages: [{ id: box.id, packagingType: '02', weightLbs: 1, lengthIn: 6, widthIn: 4, heightIn: 2 }],
    }),
    rates: [{ optionId: '0', serviceCode: '03', serviceName: 'UPS Ground', currency: 'USD', total: '13.99',
      negotiated: true, estimatedArrival: null }],
    expiresAt: new Date(Date.now() + 60_000),
  }).returning();
  return { shipmentId: draft.id as string, quote };
}

async function newQuote(original: Awaited<ReturnType<typeof createRatedShipment>>['quote'], total = '13.99') {
  const [quote] = await db.insert(upsShipmentRateQuotes).values({
    organizationId: org, shipmentId: original.shipmentId, environment: 'live',
    requestFingerprint: original.requestFingerprint, rates: original.rates.map(rate => ({ ...rate, total })),
    expiresAt: new Date(Date.now() + 60_000),
  }).returning();
  return quote;
}

const buyLabel = (shipmentId: string, quoteId: string, customerCharge?: object) =>
  request(app).post(`/api/fulfillment/shipments/${shipmentId}/ups-labels/purchase`).send({ quoteId, optionId: '0', customerCharge });

function mockedUpsLabel(tracking: string) {
  return Response.json({
    ShipmentResponse: { ShipmentResults: { ShipmentIdentificationNumber: tracking,
      ShipmentCharges: { TotalCharges: { MonetaryValue: '13.99', CurrencyCode: 'USD' } },
      PackageResults: [{ TrackingNumber: tracking, ShippingLabel: { ImageFormat: { Code: 'GIF' }, GraphicImage: gif.toString('base64') } }] } },
  });
}

test('a corrected order needs a charge decision for UPS labels and retains the billing checkpoint for dispatch', async () => {
  const { order, invoice, job } = await fixture();
  await db.insert(auditLogs).values({
    organizationId: org, userId: actor, entityId: order.id, entityType: 'order',
    actionType: 'FULFILLMENT_METHOD_CHANGED', description: 'Synthetic Pickup to Shipping correction',
    newValues: { requiresShippingDecision: true },
  });
  await db.update(orders).set({ shippingChargeDecision: 'unset' }).where(eq(orders.id, order.id));
  const { shipmentId, quote } = await createRatedShipment(order.id);
  const tracking = '1ZQA' + randomUUID().replaceAll('-', '').slice(0, 14).toUpperCase();
  const carrier = jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce(Response.json({
    response: { errors: [{ code: 'QA_ADDRESS', message: 'Destination postal code is invalid' }] },
  }, { status: 422 })).mockImplementation(async () => mockedUpsLabel(tracking));
  const purchase = (quoteId = quote.id) => buyLabel(shipmentId, quoteId);
  try {
    expect((await purchase()).body.code).toBe('UPS_CUSTOMER_CHARGE_UNSET');
    expect(carrier).not.toHaveBeenCalled();
    await db.update(orders).set({ shippingChargeDecision: 'manual', shippingCents: 1800 }).where(eq(orders.id, order.id));
    const [savedOrder] = await db.select().from(orders).where(eq(orders.id, order.id));
    const savedJob = await readJob(job.id);
    const rejected = await purchase();
    expect(rejected.status).toBe(422);
    expect(rejected.body).toMatchObject({ code: 'UPS_PURCHASE_REJECTED',
      message: expect.stringContaining('Destination postal code is invalid (UPS QA_ADDRESS)') });
    const freshQuote = await newQuote(quote);
    const bought = await purchase(freshQuote.id);
    expect(bought.status).toBe(201);
    expect(bought.body.data).toMatchObject({ carrierCostCents: 1399, labels: [{ trackingNumber: tracking }] });
    expect((await purchase(freshQuote.id)).body.code).toBe('UPS_PURCHASE_EXISTS');
    expect(carrier).toHaveBeenCalledTimes(2);
    await expect(new FulfillmentService().markShipmentShipped(org, shipmentId, actor, { suppressBillingAutomation: true }))
      .rejects.toMatchObject({ code: 'SHIPPING_BILLING_REQUIRED' });
    expect((await readDraft(shipmentId)).body.data.status).toBe('DRAFT');
    expect(await db.select().from(invoices).where(eq(invoices.orderId, order.id))).toEqual([invoice]);
    expect(await db.select().from(orders).where(eq(orders.id, order.id))).toEqual([savedOrder]);
    expect(await readJob(job.id)).toEqual(savedJob);
  } finally {
    carrier.mockRestore();
  }
});

test.each(['selected_rate', 'manual'] as const)(
  'UPS purchase commits the %s customer charge before contacting UPS and preserves it on retry',
  async source => {
    const { order, invoice } = await fixture();
    await db.update(orders).set({ shippingChargeDecision: 'unset' }).where(eq(orders.id, order.id));
    const { shipmentId, quote } = await createRatedShipment(order.id);
    const chargesPath = `/api/fulfillment/shipments/${shipmentId}/ups-customer-charges`;
    const [initial] = (await request(app).get(chargesPath)).body.data;
    const customerCharge = source === 'manual'
      ? { source, shippingCents: 2000, expectedOrderUpdatedAt: new Date(initial.updatedAt).toISOString() }
      : { source };
    const shippingCents = source === 'manual' ? 2000 : 1399;
    const decision = source === 'manual' ? 'manual' : 'ups_rate';
    const tracking = '1ZQA' + randomUUID().replaceAll('-', '').slice(0, 14).toUpperCase();
    const readBillBeforeCarrier = jest.fn();
    const carrier = jest.spyOn(globalThis, 'fetch').mockImplementationOnce(async () => {
      const [saved] = await db.select().from(orders).where(eq(orders.id, order.id));
      readBillBeforeCarrier(saved.shippingCents, saved.shippingChargeDecision);
      return Response.json({ response: { errors: [{ code: 'QA_PACKAGE', message: 'Package 1 details need review' }] } }, { status: 422 });
    }).mockImplementation(async () => mockedUpsLabel(tracking));
    try {
      const rejected = await buyLabel(shipmentId, quote.id, customerCharge);
      expect(rejected.status).toBe(422);
      expect(readBillBeforeCarrier).toHaveBeenCalledWith(shippingCents, decision);
      const [saved] = (await request(app).get(chargesPath)).body.data;
      expect(saved).toMatchObject({ shippingCents, shippingChargeDecision: decision, billingStatus: 'invoiced',
        shippingChargeRateQuoteId: source === 'manual' ? null : quote.id });
      const updatedRate = await newQuote(quote, '15.25');
      const results = await Promise.all([buyLabel(shipmentId, updatedRate.id, { source: 'selected_rate' }),
        buyLabel(shipmentId, updatedRate.id, { source: 'selected_rate' })]);
      expect(results.map(result => result.status).sort()).toEqual([201, 409]);
      expect(results.find(result => result.status === 201)?.body.data).toMatchObject({ carrierCostCents: 1399 });
      expect(carrier).toHaveBeenCalledTimes(2);
      expect((await request(app).get(chargesPath)).body.data).toEqual([saved]);
      const invoiceRows = await db.select().from(invoices).where(eq(invoices.orderId, order.id));
      expect(invoiceRows).toHaveLength(2);
      expect(invoiceRows.find(row => row.id === invoice.id)).toEqual(invoice);
      expect(invoiceRows.find(row => row.id !== invoice.id)).toMatchObject({ shippingCents, totalCents: shippingCents });
      expect((await readDraft(shipmentId)).body.data.status).toBe('DRAFT');
    } finally {
      carrier.mockRestore();
    }
  },
);

test('stale quotes and a blocked shipping invoice leave the order and purchase attempts untouched', async () => {
  const { order, invoice } = await fixture();
  const [untouchedInvoice] = await db.update(invoices).set({ shippingCents: 900 })
    .where(eq(invoices.id, invoice.id)).returning();
  await db.update(orders).set({ shippingChargeDecision: 'unset' }).where(eq(orders.id, order.id));
  const { shipmentId, quote } = await createRatedShipment(order.id);
  const [before] = await db.select().from(orders).where(eq(orders.id, order.id));
  const carrier = jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Unexpected carrier request'));
  try {
    const expired = await newQuote(quote);
    await db.update(upsShipmentRateQuotes).set({ expiresAt: new Date(0) }).where(eq(upsShipmentRateQuotes.id, expired.id));
    expect((await buyLabel(shipmentId, expired.id, { source: 'selected_rate' })).body.code).toBe('UPS_RATE_STALE');
    const invalidated = await newQuote(quote);
    await db.update(upsShipmentRateQuotes).set({ requestFingerprint: 'stale-fingerprint' }).where(eq(upsShipmentRateQuotes.id, invalidated.id));
    expect((await buyLabel(shipmentId, invalidated.id, { source: 'selected_rate' })).body.code).toBe('UPS_RATE_STALE');
    const blocked = await buyLabel(shipmentId, quote.id, { source: 'selected_rate' });
    expect(blocked.body).toMatchObject({ code: 'SHIPPING_BILLING_REVIEW',
      message: expect.stringContaining('No UPS label was requested.') });
    expect(carrier).not.toHaveBeenCalled();
    expect(await db.select().from(upsLabelPurchases).where(eq(upsLabelPurchases.shipmentId, shipmentId))).toEqual([]);
    expect(await db.select().from(orders).where(eq(orders.id, order.id))).toEqual([before]);
    expect(await db.select().from(invoices).where(eq(invoices.orderId, order.id))).toEqual([untouchedInvoice]);
  } finally {
    carrier.mockRestore();
  }
});

async function uncertain(savedResponse=true){
 const f=await fixture();const [shipment]=await db.insert(shipments).values({organizationId:org,orderId:f.order.id,primaryOrderId:f.order.id,status:'DRAFT',createdByUserId:actor}).returning();await db.insert(shipmentOrders).values({organizationId:org,shipmentId:shipment.id,orderId:f.order.id});
 const [pkg]=await db.insert(shipmentPackages).values({organizationId:org,shipmentId:shipment.id,ordinal:1,packageReference:`QA-BOX-${randomUUID()}`}).returning();
 const [quote]=await db.insert(upsShipmentRateQuotes).values({organizationId:org,shipmentId:shipment.id,environment:'live',requestFingerprint:'qa',rates:[],expiresAt:new Date(Date.now()+60000)}).returning();
 const tracking='1ZQA'+randomUUID().replaceAll('-','').slice(0,14).toUpperCase();
 const response={ShipmentResponse:{ShipmentResults:{ShipmentIdentificationNumber:tracking,ShipmentCharges:{TotalCharges:{MonetaryValue:'17.25',CurrencyCode:'USD'}},PackageResults:[{TrackingNumber:tracking,ShippingLabel:{ImageFormat:{Code:'GIF'},GraphicImage:gif.toString('base64')}}]}}};
 const [attempt]=await db.insert(upsLabelPurchases).values({organizationId:org,shipmentId:shipment.id,quoteId:quote.id,environment:'live',status:'UNCERTAIN',serviceCode:'03',serviceName:'UPS Ground',estimateCents:1725,estimateCurrency:'USD',providerTransactionId:randomUUID().slice(0,32),requestFingerprint:'qa',errorCode:'LOCAL_PERSISTENCE_UNCERTAIN',providerEvidence:savedResponse?{response}:{}}).returning();
 return {...f,shipment,pkg,quote,attempt,tracking};
}
const recover=(f:Awaited<ReturnType<typeof uncertain>>)=>request(app).post(`/api/fulfillment/shipments/${f.shipment.id}/ups-labels/${f.attempt.id}/recover`);
test('uncertain purchase recovery persists original response exactly once without carrier calls or fulfillment changes',async()=>{
 const f=await uncertain();const external=jest.spyOn(globalThis,'fetch').mockRejectedValue(new Error('External carrier calls forbidden in this test'));
 try{
  const results=await Promise.all([recover(f),recover(f)]);expect(results.map(r=>r.status).sort()).toEqual([200,409]);
  const [saved]=await db.select().from(upsLabelPurchases).where(eq(upsLabelPurchases.id,f.attempt.id));expect(saved).toMatchObject({status:'PURCHASED',providerShipmentId:f.tracking,errorCode:null,carrierCostCents:1725});
  const labels=await db.select().from(upsPackageLabels).where(eq(upsPackageLabels.purchaseId,f.attempt.id));expect(labels).toHaveLength(1);expect(labels[0]).toMatchObject({packageId:f.pkg.id,trackingNumber:f.tracking,labelBytes:gif,labelSha256:createHash('sha256').update(gif).digest('hex')});
  expect((await db.select().from(shipments).where(eq(shipments.id,f.shipment.id)))[0].status).toBe('DRAFT');expect((await db.select().from(invoices).where(eq(invoices.id,f.invoice.id)))[0]).toEqual(f.invoice);
  expect(await db.select().from(fulfillmentEvents).where(and(eq(fulfillmentEvents.entityId,f.shipment.id),eq(fulfillmentEvents.eventType,'SHIPMENT_UPDATED')))).toHaveLength(1);expect(external).not.toHaveBeenCalled();
 }finally{external.mockRestore();}
});
test('uncertain attempts block another purchase; missing response, stale state, permissions and tenant isolation fail closed',async()=>{
 const f=await uncertain(false);const purchase=await request(app).post(`/api/fulfillment/shipments/${f.shipment.id}/ups-labels/purchase`).send({quoteId:f.quote.id,optionId:'03'});expect(purchase.status).toBe(409);expect(purchase.body.code).toBe('UPS_PURCHASE_EXISTS');
 expect((await recover(f)).body.code).toBe('UPS_MANUAL_RECOVERY_REQUIRED');
 const url=`/api/fulfillment/shipments/${f.shipment.id}/ups-labels/${f.attempt.id}/recover`;
 expect((await request(app).post(url).set('x-role','employee')).status).toBe(403);expect((await request(app).post(url).set('x-tenant',otherOrg)).status).toBe(404);
 const valid=await uncertain();await db.update(shipments).set({status:'SHIPPED'}).where(eq(shipments.id,valid.shipment.id));expect((await recover(valid)).body.code).toBe('UPS_RECOVERY_SHIPMENT_CHANGED');
 const history=await request(app).get(`/api/fulfillment/shipments/${f.shipment.id}/ups-labels`);expect(history.body.data[0]).toMatchObject({canRecoverRecordedPurchase:true,savedPurchaseResponseAvailable:false});expect(JSON.stringify(history.body)).not.toContain('providerEvidence');
 expect((await db.select().from(upsLabelPurchases).where(eq(upsLabelPurchases.id,f.attempt.id)))[0].status).toBe('UNCERTAIN');expect(await db.select().from(upsPackageLabels).where(eq(upsPackageLabels.purchaseId,f.attempt.id))).toHaveLength(0);
});


test('mid-transaction persistence failure rolls back labels, links and audit; safe diagnostics permit later recovery only',async()=>{
 const f=await uncertain();const fn='qa_ups_failure_'+randomUUID().replaceAll('-','');const logger=jest.spyOn(console,'error').mockImplementation(()=>{});
 await pool.query(`create function ${fn}() returns trigger language plpgsql as $$ begin if NEW.purchase_id='${f.attempt.id}' then raise exception 'Synthetic storage failure' using errcode='23514'; end if; return NEW; end; $$`);
 await pool.query(`create trigger ${fn}_tr before insert on ups_package_labels for each row execute function ${fn}()`);
 try{
  const failed=await recover(f);expect(failed.status).toBe(409);expect(failed.body.code).toBe('UPS_LOCAL_RECOVERY_REQUIRED');
  expect(await db.select().from(upsPackageLabels).where(eq(upsPackageLabels.purchaseId,f.attempt.id))).toHaveLength(0);expect(await db.select().from(upsLabelPurchaseOrders).where(eq(upsLabelPurchaseOrders.purchaseId,f.attempt.id))).toHaveLength(0);
  expect((await db.select().from(upsLabelPurchases).where(eq(upsLabelPurchases.id,f.attempt.id)))[0]).toMatchObject({status:'UNCERTAIN',providerEvidence:f.attempt.providerEvidence});
  expect(logger).toHaveBeenCalledWith('[ups-label] local purchase persistence failed',expect.objectContaining({attemptId:f.attempt.id,stage:'save_label_artifacts',databaseCode:'23514'}));expect(JSON.stringify(logger.mock.calls)).not.toContain('GraphicImage');expect(JSON.stringify(logger.mock.calls)).not.toContain(gif.toString('base64'));
 }finally{await pool.query(`drop trigger ${fn}_tr on ups_package_labels`);await pool.query(`drop function ${fn}()`);logger.mockRestore();}
 expect((await recover(f)).status).toBe(200);expect(await db.select().from(upsPackageLabels).where(eq(upsPackageLabels.purchaseId,f.attempt.id))).toHaveLength(1);
});
