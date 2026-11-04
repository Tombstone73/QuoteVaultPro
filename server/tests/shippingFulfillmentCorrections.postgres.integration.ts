import { beforeAll, afterAll, expect, jest, test } from '@jest/globals';
import { randomUUID, createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import express from 'express';
import request from 'supertest';
import { and, eq } from 'drizzle-orm';
import { db, pool } from '../db';
import { organizations, users, userOrganizations, customers, products, orders, orderLineItems, productionJobs, stations, productionStationSteps, shipments, shipmentItems, shipmentOrders, shipmentPackages, upsShipmentRateQuotes, upsLabelPurchases, upsPackageLabels, upsLabelPurchaseOrders, fulfillmentEvents, invoices } from '@shared/schema';
const realConnection=await import('../services/ups/upsConnection');
jest.unstable_mockModule('../services/ups/upsConnection',()=>({...realConnection,upsRateCredentials:async()=>({row:{mode:'live'},accountNumber:'SYNTHETIC',token:'synthetic-not-a-credential',baseUrl:'https://ups.invalid'})}));
const realRates=await import('../services/ups/upsRates');
// Only preflight carrier context is synthetic. The production override, UPS
// response normalization, transactions, storage, guards and readbacks are real.
const party={name:'QA',company:'QA',address1:'1 Synthetic St',address2:null,city:'Carmel',state:'IN',postalCode:'46032',country:'US',phone:'3175550123',email:null};
jest.unstable_mockModule('../services/ups/upsRates',()=>({...realRates,resolveUpsShippingContext:async(organizationId:string,shipmentId:string)=>{
 const [shipment]=await db.select().from(shipments).where(and(eq(shipments.organizationId,organizationId),eq(shipments.id,shipmentId)));
 const packages=await db.select().from(shipmentPackages).where(eq(shipmentPackages.shipmentId,shipmentId));
 return {shipment,origin:party,sender:party,destination:party,packages:packages.map(pkg=>({id:pkg.id,packagingType:'02',weightLbs:1,lengthIn:6,widthIn:4,heightIn:2}))};
}}));
const {registerFulfillmentRoutes}=await import('../routes/fulfillment.routes');
const {registerOrderRoutes}=await import('../routes/orders.routes');
const {FulfillmentService}=await import('../services/fulfillment/service');
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
async function fixture(partial=false){
 const [order]=await db.insert(orders).values({organizationId:org,customerId:customer,createdByUserId:actor,orderNumber:String(++number),state:'open',status:'in_production',shippingMethod:'ship',shippingCents:0,shippingChargeDecision:'free',fulfillmentStatus:partial?'partially_shipped':'pending'}).returning();
 const [line]=await db.insert(orderLineItems).values({orderId:order.id,productId:product,description:'QA line',quantity:10,unitPrice:'10',totalPrice:'100',workflowState:'in_production',status:'in_production',requiresDesign:false,requiresPrepress:false,requiresProofApproval:false}).returning();
 const [job]=await db.insert(productionJobs).values({organizationId:org,orderId:order.id,lineItemId:line.id,stationKey:'roll',stepKey:'queued',status:'in_progress',startedAt:new Date()}).returning();
 const [invoice]=await db.insert(invoices).values({organizationId:org,orderId:order.id,customerId:customer,createdByUserId:actor,invoiceNumber:++number,status:'paid',total:'100',totalCents:10000,balanceDue:'0',amountPaid:'100'}).returning();
 if(partial){const [shipment]=await db.insert(shipments).values({organizationId:org,orderId:order.id,primaryOrderId:order.id,status:'SHIPPED',createdByUserId:actor}).returning();await db.insert(shipmentItems).values({organizationId:org,shipmentId:shipment.id,orderId:order.id,orderLineItemId:line.id,quantity:3});}
 return {order,line,job,invoice};
}
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
