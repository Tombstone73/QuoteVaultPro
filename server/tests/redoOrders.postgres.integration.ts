import { randomUUID } from 'node:crypto';
import express from 'express';
import request from 'supertest';
import { beforeAll, afterAll, expect, jest, test } from '@jest/globals';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '../db';
import { organizations, users, userOrganizations, customers, products, orders, orderLineItems, invoices, invoiceLineItems, productionJobs, productionEvents, auditLogs, orderAuditLog, stations, productionStationSteps, shipments, shipmentItems, orderMaterialUsage, inventoryReservations, lineItemProofVersions, lineItemArtwork, payments } from '../../shared/schema';
import { OrdersRepository } from '../storage/orders.repo';
import { duplicateOrder } from '../services/orderDuplicationService';
import type { CreateRedoOrderRequest } from '../../shared/orderRedo';
jest.unstable_mockModule('sharp', () => ({ default: () => { throw new Error('No image processing in synthetic Redo tests'); } }));
let org = '', actor = '', customer = '', product = '', otherOrg = '', app: express.Express;
const repo = new OrdersRepository();
beforeAll(async () => {
 const suffix = randomUUID();
 [{id:org}] = await db.insert(organizations).values({ name:'Synthetic Redo Acceptance', slug:'redo-'+suffix, settings:{ preferences:{proofing:{policy:'manual_requested_only'}} } } as any).returning();
 [{id:otherOrg}] = await db.insert(organizations).values({name:'Synthetic Other Tenant',slug:'other-redo-'+suffix}).returning();
 [{id:actor}] = await db.insert(users).values({email:suffix+'@example.test',role:'admin',firstName:'Synthetic',lastName:'Redo Staff'}).returning();
 await db.insert(userOrganizations).values({organizationId:org,userId:actor,role:'admin'});
 [{id:customer}] = await db.insert(customers).values({organizationId:org,companyName:'Synthetic Redo Customer',creditLimit:'100000',creditLimitConfiguredAt:new Date()}).returning();
 [{id:product}] = await db.insert(products).values({organizationId:org,name:'Synthetic Redo Product',description:'Synthetic only',requiresProofApproval:false}).returning();
 await db.insert(stations).values(['roll','flatbed','prepress','design'].map(key=>({id:randomUUID(),organizationId:org,key,name:key,active:true})));
 await db.insert(productionStationSteps).values({organizationId:org,stationKey:'roll',key:'queued',label:'Queued',active:true,sortOrder:0,triggers:[{type:'on_complete_route',config:{stationKey:'fulfillment',stepKey:'fulfillment'}}]} as any);
 app=express();app.use(express.json());
 const auth=(req:any,_res:any,next:any)=>{req.organizationId=req.headers['x-test-org']||org;req.orgRole=req.headers['x-test-role']||'admin';req.user={id:actor,firstName:'Synthetic',lastName:'Redo Staff'};next();};
 const admin=(req:any,res:any,next:any)=>['admin','owner'].includes(req.orgRole)?next():res.status(403).json({message:'Admin or owner required'});
 const {registerOrderRoutes}=await import('../routes/orders.routes');
 await registerOrderRoutes(app,{isAuthenticated:auth,tenantContext:auth,isAdmin:admin,isAdminOrOwner:admin});
},180000);
afterAll(async()=>{
 // Entirely synthetic records in a verified disposable database. Remove provenance leaves before roots.
 for(const tenant of [org,otherOrg].filter(Boolean)) {
  await db.delete(productionEvents).where(eq(productionEvents.organizationId,tenant));
  await db.delete(productionJobs).where(eq(productionJobs.organizationId,tenant));
  await db.delete(auditLogs).where(eq(auditLogs.organizationId,tenant));
  await db.delete(invoices).where(eq(invoices.organizationId,tenant));
  for(let i=0;i<5;i++) await db.execute(sql`delete from orders o where o.organization_id=${tenant} and not exists(select 1 from orders child where child.redo_source_order_id=o.id or child.redo_root_order_id=o.id)`);
  await db.delete(products).where(eq(products.organizationId,tenant));
  await db.delete(customers).where(eq(customers.organizationId,tenant));
  await db.delete(organizations).where(eq(organizations.id,tenant));
 }
 if(actor) await db.delete(users).where(eq(users.id,actor));
});
async function fixture(group=false,gated=false){
 const source=await repo.createOrder(org,{customerId:customer,createdByUserId:actor,shippingMethod:'pickup',shippingCents:1900,taxAmount:10,discount:2,lineItems:[
 {productId:product,description:'Synthetic signs',quantity:10,width:'24',height:'18',unitPrice:'20',totalPrice:'200',productType:'wide_roll',nestingConfigSnapshot:{sheetWidth:48,sheetHeight:96,itemsPerSheet:2,totalSheets:5},specsJson:{laminate:'matte',priceOverride:{mode:'append_value',valueCents:900}},pbv2SnapshotJson:{pricing:{totalCents:20000}},requiresDesign:false,requiresProofApproval:gated,requiresPrepress:gated,lineItemRole:group?'parent':'standalone'},
 {productId:product,description:'Synthetic stakes',quantity:20,unitPrice:'5',totalPrice:'100',productType:'wide_roll',requiresDesign:false,requiresProofApproval:false,requiresPrepress:false,lineItemRole:group?'child':'standalone'}] as any});
 const [ordinaryInvoice] = await db.select().from(invoices).where(eq(invoices.orderId,source.id));
 expect(ordinaryInvoice.status).toBe('billed');expect(ordinaryInvoice.issuedAt).not.toBeNull();
 if(group) await db.update(orderLineItems).set({parentLineItemId:source.lineItems[0].id}).where(eq(orderLineItems.id,source.lineItems[1].id));
 await db.update(orderLineItems).set({workflowState:'completed',status:'complete',productionBypassed:false,materialUsageJson:[{materialId:'synthetic-reference',materialName:'old usage',quantityUsed:9,unitOfMeasure:'ea'}],materialUsages:[]} as any).where(eq(orderLineItems.orderId,source.id));
 await db.insert(productionJobs).values({organizationId:org,orderId:source.id,lineItemId:source.lineItems[0].id,stationKey:'roll',stepKey:'queued',status:'done',startedAt:new Date(),completedAt:new Date(),totalSeconds:100});
 const [shipment]=await db.insert(shipments).values({organizationId:org,orderId:source.id,status:'SHIPPED',shippedAt:new Date(),createdByUserId:actor} as any).returning();
 await db.insert(shipmentItems).values({organizationId:org,shipmentId:shipment.id,orderId:source.id,orderLineItemId:source.lineItems[0].id,quantity:10} as any);
 await db.update(invoices).set({status:'paid',balanceDue:'0',amountPaid:source.total} as any).where(eq(invoices.orderId,source.id));
 await db.update(orders).set({state:'closed',status:'completed',fulfillmentStatus:'shipped',productionCompletedAt:new Date().toISOString()} as any).where(eq(orders.id,source.id));
 return (await repo.getOrderById(org,source.id))!;
}
function command(source:any,group=false):CreateRedoOrderRequest {return {requestKey:randomUUID(),expectedUpdatedAt:new Date(source.updatedAt).toISOString(),lines:source.lineItems.slice(0,group?2:1).map((line:any,index:number)=>({sourceLineItemId:line.id,quantity:index?4:2,expectedUpdatedAt:new Date(line.updatedAt).toISOString()})),reason:'Print quality',explanation:'Synthetic partial reprint',promisedDate:'2026-11-04',disposition:'no_customer_charge',confirmed:true};}
const create=(source:any,body:any)=>request(app).post('/api/orders/'+source.id+'/redo').send(body);
test('closed, produced, fulfilled and paid source creates a visible partial zero-charge order; production reaches fulfillment without changing original history',async()=>{
 const source=await fixture(), body=command(source);
 const originalOrder=await db.select().from(orders).where(eq(orders.id,source.id));
 const originalInvoice=await db.select().from(invoices).where(eq(invoices.orderId,source.id));
 const originalInvoiceLines=await db.select().from(invoiceLineItems).where(eq(invoiceLineItems.invoiceId,originalInvoice[0].id));
 const originalShipments=await db.select().from(shipments).where(eq(shipments.orderId,source.id));
 const originalItems=await db.select().from(shipmentItems).where(eq(shipmentItems.orderId,source.id));
 const response=await create(source,body);
 expect({status:response.status,message:response.body.message}).toEqual({status:201,message:undefined});
 const redo=response.body.order;
 expect(redo.id).not.toBe(source.id);expect(redo.orderNumber).toMatch(/^\d+$/);expect(redo.orderNumber).not.toBe(source.orderNumber);
 expect(redo).toMatchObject({redoRootOrderId:source.id,redoSourceOrderId:source.id,redoReason:'Print quality',redoDisposition:'no_customer_charge',shippingCents:0});
 expect(redo.dueDate.slice(0,10)).toBe(body.promisedDate);expect(redo.promisedDate.slice(0,10)).toBe(body.promisedDate);expect(Number(redo.total)).toBe(0);
 expect(redo.lineItems).toHaveLength(1);const line=redo.lineItems[0];
 expect(line).toMatchObject({redoSourceLineItemId:source.lineItems[0].id,quantity:2,width:'24.00',height:'18.00',overridePriceCents:0,approvedProofVersionId:null,productionBypassed:false,materialUsageJson:null,materialUsages:[]});
 expect(line.nestingConfigSnapshot).toMatchObject({sheetWidth:48,sheetHeight:96,itemsPerSheet:2,totalSheets:1});
 expect(line.specsJson.laminate).toBe('matte');expect(line.pbv2SnapshotJson).toEqual(source.lineItems[0].pbv2SnapshotJson);expect(Number(line.totalPrice)).toBe(0);
 const [invoice]=await db.select().from(invoices).where(eq(invoices.orderId,redo.id));
 expect(invoice.status).toBe('draft');expect(Number(invoice.total)).toBe(0);expect(Number(invoice.balanceDue)).toBe(0);expect(invoice.lastSentAt).toBeNull();expect(invoice.issuedAt).toBeNull();
 const [newJob]=await db.select().from(productionJobs).where(eq(productionJobs.lineItemId,line.id));
 expect(newJob).toMatchObject({status:'queued',stationKey:'roll',completedAt:null,startedAt:null,totalSeconds:0});
 expect(await db.select().from(orderMaterialUsage).where(eq(orderMaterialUsage.orderId,redo.id))).toHaveLength(0);
 expect(await db.select().from(inventoryReservations).where(eq(inventoryReservations.orderId,redo.id))).toHaveLength(0);
 expect(await db.select().from(lineItemProofVersions).where(eq(lineItemProofVersions.orderId,redo.id))).toHaveLength(0);
 expect(await db.select().from(shipments).where(eq(shipments.orderId,redo.id))).toHaveLength(0);
 const read=await request(app).get('/api/orders/'+redo.id);expect(read.status).toBe(200);expect(read.body.redoOriginal.id).toBe(source.id);
 const originalRead=await request(app).get('/api/orders/'+source.id);expect(originalRead.body.relatedRedos.map((row:any)=>row.id)).toContain(redo.id);
 const list=await repo.getAllOrdersPaginated(org,{page:1,pageSize:100,includeThumbnails:false});expect(list.items.some((row:any)=>row.id===redo.id&&row.redoRootOrderId===source.id)).toBe(true);
 const overdue=await repo.getAllOrdersPaginated(org,{page:1,pageSize:100,includeThumbnails:false,dueFilter:'overdue',dueDatePart:'2026-11-05'});expect(overdue.items.some(row=>row.id===redo.id)).toBe(true);
 const audits=await db.select().from(orderAuditLog).where(eq(orderAuditLog.orderId,redo.id));
 expect(audits.find(row=>row.actionType==='redo_order_created')).toMatchObject({userId:actor,metadata:expect.objectContaining({sourceOrderId:source.id,redoOrderId:redo.id,promisedDate:body.promisedDate,disposition:'no_customer_charge',reason:'Print quality',lines:expect.arrayContaining([expect.objectContaining({quantity:2})])})});
 const {updateProductionJobStatusWorkflow,completeProductionJobWorkflow}=await import('../routes/productionJobs.routes');
 await db.transaction(tx=>updateProductionJobStatusWorkflow(tx,{organizationId:org,userId:actor,jobId:newJob.id,status:'in_progress'}));
 await db.transaction(tx=>completeProductionJobWorkflow(tx,{organizationId:org,userId:actor,jobId:newJob.id,skipProduction:false}));
 const jobs=await db.select().from(productionJobs).where(eq(productionJobs.lineItemId,line.id));
 expect(jobs.some(job=>job.stationKey==='fulfillment'&&job.status==='queued')).toBe(true);
 const {FulfillmentDashboardRepo}=await import('../services/fulfillment/repository');
 const eligibility=await new FulfillmentDashboardRepo().listLineEligibility(org,{orderIds:[redo.id]});
 expect(eligibility.some((item:any)=>item.id===line.id&&item.projection.remainingQuantity === 2)).toBe(true);
 const {FulfillmentService}=await import('../services/fulfillment/service');
 const fulfillment=new FulfillmentService();
 await fulfillment.adjustReadyQuantities(org,redo.id,{items:[{orderLineItemId:line.id,quantityDelta:2}],reason:'Synthetic pieces checked and ready'},actor,'admin');
 const ticket=await fulfillment.createOrGetPickupTicket(org,redo.id,actor);
 await fulfillment.recordPickupHandoff(org,ticket.id,{items:[{orderLineItemId:line.id,quantity:2}],clientRequestId:randomUUID()},actor);
 const [fulfilled]=await new FulfillmentDashboardRepo().listLineEligibility(org,{orderIds:[redo.id]});
 expect(fulfilled.projection).toMatchObject({fulfilledQuantity:2,remainingQuantity:0});
 const [finalInvoice]=await db.select().from(invoices).where(eq(invoices.orderId,redo.id));
 expect(finalInvoice.status).toBe('draft');expect(Number(finalInvoice.total)).toBe(0);expect(Number(finalInvoice.balanceDue)).toBe(0);expect(finalInvoice.lastSentAt).toBeNull();expect(finalInvoice.issuedAt).toBeNull();
 expect(await db.select().from(orders).where(eq(orders.id,source.id))).toEqual(originalOrder);
 expect(await db.select().from(invoices).where(eq(invoices.orderId,source.id))).toEqual(originalInvoice);
 expect(await db.select().from(invoiceLineItems).where(eq(invoiceLineItems.invoiceId,originalInvoice[0].id))).toEqual(originalInvoiceLines);
 expect(await db.select().from(shipments).where(eq(shipments.orderId,source.id))).toEqual(originalShipments);
 expect(await db.select().from(shipmentItems).where(eq(shipmentItems.orderId,source.id))).toEqual(originalItems);
 expect(Number((await db.select().from(invoices).where(eq(invoices.orderId,redo.id)))[0].total)).toBe(0);
},90000);
test('concurrent retries share one persisted Redo; changed payload is rejected, multiple Redos and Redo-of-Redo retain root',async()=>{
 const source=await fixture(),body=command(source);
 const results=await Promise.all([create(source,body),create(source,body)]);expect(results.map(r=>r.status)).toEqual([201,201]);
 const redo=results[0].body.order;expect(results[1].body.order.id).toBe(redo.id);
 expect((await create(source,{...body,reason:'Shipping damage'})).status).toBe(409);
 const second=await create(source,{...body,requestKey:randomUUID()});expect(second.status).toBe(201);expect(second.body.order.id).not.toBe(redo.id);
 const third=await create(redo,command(redo));expect(third.status).toBe(201);expect(third.body.order).toMatchObject({redoRootOrderId:source.id,redoSourceOrderId:redo.id});
 const read=await request(app).get('/api/orders/'+source.id);expect(read.body.relatedRedos).toHaveLength(3);
});
test('tenant, permission, stale-source, foreign-line and unconfirmed requests fail closed',async()=>{
 const source=await fixture(),body=command(source);
 expect((await request(app).post('/api/orders/'+source.id+'/redo').set('x-test-org',otherOrg).send(body)).status).toBe(404);
 expect((await request(app).post('/api/orders/'+source.id+'/redo').set('x-test-role','employee').send(body)).status).toBe(403);
 expect((await create(source,{...body,confirmed:false})).status).toBe(400);
 expect((await create(source,{...body,expectedUpdatedAt:'2001-01-01T00:00:00.000Z'})).status).toBe(409);
 expect((await create(source,{...body,lines:[{...body.lines[0],expectedUpdatedAt:'2001-01-01T00:00:00.000Z'}]})).status).toBe(409);
 expect((await create(source,{...body,lines:[{...body.lines[0],sourceLineItemId:randomUUID()}]})).status).toBe(400);
 expect((await create(source,{...body,lines:[{...body.lines[0],quantity:11}]})).status).toBe(400);
});
test('parent and child replacement group is complete, proportional, and remapped',async()=>{
 const source=await fixture(true),body=command(source,true);
 expect((await create(source,{...body,lines:[body.lines[1]]})).status).toBe(400);
 expect((await create(source,{...body,lines:[body.lines[0]]})).status).toBe(400);
 expect((await create(source,{...body,lines:[body.lines[0],{...body.lines[1],quantity:3}]})).status).toBe(400);
 const response=await create(source,body);expect(response.status).toBe(201);const lines=response.body.order.lineItems;
 const parent=lines.find((line:any)=>line.lineItemRole==='parent'),child=lines.find((line:any)=>line.lineItemRole==='child');
 const [invoice]=await db.select().from(invoices).where(eq(invoices.orderId,response.body.order.id));
 expect(invoice.status).toBe('draft');expect(invoice.issuedAt).toBeNull();
 const invoiceRows=await db.select().from(invoiceLineItems).where(eq(invoiceLineItems.invoiceId,invoice.id));
 expect(invoiceRows.every(row=>row.lineTotalCents===0)).toBe(true);
 expect(parent.quantity).toBe(2);expect(child.quantity).toBe(4);expect(child.parentLineItemId).toBe(parent.id);expect(Number(response.body.order.total)).toBe(0);
 expect(await db.select().from(productionJobs).where(eq(productionJobs.lineItemId,parent.id))).toHaveLength(0);
});
test('new proof and Prepress requirements persist without copying completion or approval',async()=>{
 const source=await fixture(false,true),response=await create(source,command(source));expect(response.status).toBe(201);
 const line=response.body.order.lineItems[0];expect(line).toMatchObject({requiresProofApproval:true,requiresPrepress:true,approvedProofVersionId:null,workflowState:'awaiting_proof_approval'});
 const [job]=await db.select().from(productionJobs).where(eq(productionJobs.lineItemId,line.id));expect(job.stationKey).toBe('prepress');expect(job.completedAt).toBeNull();
});
test.each(['no_customer_charge','charge_customer'] as const)('%s late audit failure rolls order, number, invoice, routing and lineage back atomically',async disposition=>{
 const source=await fixture(),body=disposition==='charge_customer'?(await paidCommand(source,[3500])).body:command(source);
 const before=await db.select().from(orders).where(eq(orders.organizationId,org));
 const beforeInvoices=await db.select().from(invoices).where(eq(invoices.organizationId,org));
 const beforeJobs=await db.select().from(productionJobs).where(eq(productionJobs.organizationId,org));
 const beforeAudits=await db.select().from(auditLogs).where(eq(auditLogs.organizationId,org));
 // Synthetic trigger fails the final audit, after creation, invoice, and routing.
 const triggerName='synthetic_redo_rollback_'+randomUUID().replaceAll('-','');
 const ddl='CREATE FUNCTION '+triggerName+'() RETURNS trigger LANGUAGE plpgsql AS $body$ BEGIN IF NEW.action_type=\'redo_order_created\' AND NEW.metadata->>\'sourceOrderId\'=\''+source.id+'\' THEN RAISE EXCEPTION \'synthetic final audit failure\'; END IF; RETURN NEW; END $body$; CREATE TRIGGER '+triggerName+' BEFORE INSERT ON order_audit_log FOR EACH ROW EXECUTE FUNCTION '+triggerName+'();';
 await db.execute(sql.raw(ddl));
 try {
   await expect(duplicateOrder({organizationId:org,sourceOrderId:source.id,actorUserId:actor,actorOrgRole:'admin',redo:body as CreateRedoOrderRequest})).rejects.toThrow('synthetic final audit failure');
 } finally { await db.execute(sql.raw('DROP TRIGGER '+triggerName+' ON order_audit_log; DROP FUNCTION '+triggerName+'();')); }
 expect(await db.select().from(productionJobs).where(eq(productionJobs.organizationId,org))).toEqual(beforeJobs);
 expect(await db.select().from(auditLogs).where(eq(auditLogs.organizationId,org))).toEqual(beforeAudits);
 expect(await db.select().from(orders).where(eq(orders.organizationId,org))).toEqual(before);
 expect(await db.select().from(invoices).where(eq(invoices.organizationId,org))).toEqual(beforeInvoices);
 expect(await db.select().from(orders).where(eq(orders.redoRequestKey,body.requestKey))).toHaveLength(0);
 const retry=await create(source,body);expect(retry.status).toBe(201);
});
test('database rejects ambiguous/cross-tenant lineage, positive charges and moving source lines',async()=>{
 const source=await fixture(),response=await create(source,command(source));expect(response.status).toBe(201);const redo=response.body.order;
 await expect(db.insert(orders).values({organizationId:otherOrg,orderNumber:'INVALID-'+randomUUID(),createdByUserId:actor,redoRootOrderId:source.id,redoSourceOrderId:source.id,redoReason:'Print quality',redoExplanation:'Test invalid tenant',redoDisposition:'no_customer_charge',redoRequestKey:randomUUID(),redoRequestFingerprint:'invalid',promisedDate:redo.promisedDate})).rejects.toThrow();
 await expect(db.update(orders).set({redoRootOrderId:redo.id}).where(eq(orders.id,redo.id))).rejects.toThrow();
 await expect(db.update(orders).set({organizationId:otherOrg}).where(eq(orders.id,redo.id))).rejects.toThrow();
 await expect(db.update(orders).set({organizationId:otherOrg}).where(eq(orders.id,source.id))).rejects.toThrow();
 await expect(db.update(orders).set({total:'20',shippingCents:2000}).where(eq(orders.id,redo.id))).rejects.toThrow();
 await expect(db.update(orderLineItems).set({totalPrice:'10'}).where(eq(orderLineItems.id,redo.lineItems[0].id))).rejects.toThrow();
 await expect(db.update(orderLineItems).set({redoSourceLineItemId:source.lineItems[1].id}).where(eq(orderLineItems.id,redo.lineItems[0].id))).rejects.toThrow();
});

test('missing production configuration preserves a visible promised Redo with an actionable pending line',async()=>{
 const source=await fixture(),body=command(source);
 await db.delete(stations).where(and(eq(stations.organizationId,org),eq(stations.key,'roll')));
 try {
   const response=await create(source,body);expect(response.status).toBe(201);const redo=response.body.order;
   expect(redo.lineItems[0].workflowState).toBe('new');expect(redo.lineItems[0].productionNotes).toContain('Configure production station roll');
   expect(Number(redo.total)).toBe(0);expect(redo.promisedDate.slice(0,10)).toBe(body.promisedDate);
   const list=await repo.getAllOrdersPaginated(org,{page:1,pageSize:100,includeThumbnails:false});expect(list.items.some(row=>row.id===redo.id)).toBe(true);
   expect(await db.select().from(productionJobs).where(eq(productionJobs.orderId,redo.id))).toHaveLength(0);
 } finally {await db.insert(stations).values({id:randomUUID(),organizationId:org,key:'roll',name:'roll',active:true});}
});

test('unknown saved sheet capacity requires fresh Prepress planning instead of copying historical sheet consumption',async()=>{
 const source=await fixture();
 await db.update(orderLineItems).set({nestingConfigSnapshot:{sheetWidth:48,sheetHeight:96,totalSheets:5},updatedAt:new Date()}).where(eq(orderLineItems.id,source.lineItems[0].id));
 const fresh=(await repo.getOrderById(org,source.id))!,response=await create(fresh,command(fresh));expect(response.status).toBe(201);
 const line=response.body.order.lineItems[0];expect(line.nestingConfigSnapshot.totalSheets).toBeUndefined();expect(line.requiresPrepress).toBe(true);expect(line.workflowState).toBe('ready_for_prepress');expect(line.productionNotes).toContain('fresh sheet layout');
 const jobs=await db.select().from(productionJobs).where(eq(productionJobs.lineItemId,line.id));expect(jobs).toHaveLength(1);expect(jobs[0].stationKey).toBe('prepress');
 expect(await db.select().from(orderMaterialUsage).where(eq(orderMaterialUsage.orderId,response.body.order.id))).toHaveLength(0);
});

test('detail API returns exact ISO Order concurrency token, accepts a valid date, and rejects a one-microsecond source change',async()=>{
 const source=await fixture();
 await db.execute(sql`update orders set updated_at='2026-10-29 12:34:56.123456'::timestamp where id=${source.id}`);
 const read=await request(app).get('/api/orders/'+source.id);expect(read.status).toBe(200);expect(read.body.updatedAt).toBe('2026-10-29T12:34:56.123456Z');expect(read.body.lineItems[0].updatedAt).toMatch(/Z$/);
 const payload={...command(read.body),expectedUpdatedAt:read.body.updatedAt,promisedDate:'2026-10-30'};
 const response=await create(read.body,payload);expect(response.status).toBe(201);
 await db.execute(sql`update orders set updated_at='2026-10-29 12:34:56.123457'::timestamp where id=${source.id}`);
 const stale=await create(read.body,{...payload,requestKey:randomUUID()});expect(stale.status).toBe(409);expect(stale.body.code).toBe('STALE_SOURCE');
});

async function paidCommand(source:any, amounts:Array<number|undefined>, shipping={decision:'free',amountCents:0}, group=false) {
 const {confirmed,...base}=command(source,group);
 const details={...base,disposition:'charge_customer',shipping,lines:base.lines.map((line,index)=>({...line,...(amounts[index]!==undefined?{priceOverrideTotalCents:amounts[index]}:{})}))};
 const response=await request(app).post('/api/orders/'+source.id+'/redo/preview').send(details);
 expect({status:response.status,message:response.body.message}).toEqual({status:200,message:undefined});
 return {details,preview:response.body.preview,body:{...details,confirmed:true,pricingReview:response.body.preview.reviewKey}};
}
test.each<[string,number,number]>([['full',20900,10],['partial',3500,2]])('%s customer-charge Redo has explicit pricing, correct tax, its own unsent draft and immutable original invoice/payment',async(_label,amount,quantity)=>{
 await db.update(organizations).set({defaultTaxRate:'0.07',taxEnabled:true}).where(eq(organizations.id,org));
 await db.update(customers).set({isTaxExempt:false,taxRateOverride:null}).where(eq(customers.id,customer));
 const source=await fixture();
 const [originalInvoice]=await db.select().from(invoices).where(eq(invoices.orderId,source.id));
 await db.insert(payments).values({organizationId:org,invoiceId:originalInvoice.id,provider:'manual',status:'succeeded',method:'check',amount:source.total,amountCents:Math.round(Number(source.total)*100),createdByUserId:actor,note:'Synthetic historical payment; no gateway'});
 const originalPayments=await db.select().from(payments).where(eq(payments.invoiceId,originalInvoice.id));
 const originalLines=await db.select().from(invoiceLineItems).where(eq(invoiceLineItems.invoiceId,originalInvoice.id));
 try {
   const {confirmed,...base}=command(source);
   const details={...base,disposition:'charge_customer',shipping:{decision:'free',amountCents:0},lines:[{...base.lines[0],quantity,priceOverrideTotalCents:amount}]};
   const before=await db.select().from(orders).where(eq(orders.organizationId,org));
   const reviewed=await request(app).post('/api/orders/'+source.id+'/redo/preview').send(details);expect(reviewed.status).toBe(200);
   expect(await db.select().from(orders).where(eq(orders.organizationId,org))).toEqual(before);
   const expectedTax=Math.round(amount*0.07),preview=reviewed.body.preview;
   expect(preview).toMatchObject({subtotalCents:amount,taxCents:expectedTax,shippingCents:0,totalCents:amount+expectedTax});
   const body={...details,confirmed:true,pricingReview:preview.reviewKey};
   const responses=await Promise.all([create(source,body),create(source,body)]);expect(responses.map(r=>r.status)).toEqual([201,201]);
   const redo=responses[0].body.order;expect(responses[1].body.order.id).toBe(redo.id);expect(redo.redoDisposition).toBe('charge_customer');expect(redo.shippingCents).toBe(0);
   expect(Math.round(Number(redo.total)*100)).toBe(amount+expectedTax);expect(redo.lineItems[0]).toMatchObject({quantity,overridePriceCents:amount,redoSourceLineItemId:source.lineItems[0].id});expect(redo.lineItems[0].specsJson.priceOverride).toMatchObject({mode:'override_total_after_margin',valueCents:amount});
   const [invoice]=await db.select().from(invoices).where(eq(invoices.orderId,redo.id));expect(invoice).toMatchObject({status:'draft',issuedAt:null,lastSentAt:null,totalCents:amount+expectedTax,shippingCents:0});expect(Number(invoice.balanceDue)).toBe((amount+expectedTax)/100);expect(Number(invoice.amountPaid)).toBe(0);
   expect(await db.select().from(payments).where(eq(payments.invoiceId,invoice.id))).toHaveLength(0);
   const {recalculateEditableOrderFinancialsInTransaction}=await import('../services/orders/orderTaxCalculationService');
   await db.transaction(tx=>recalculateEditableOrderFinancialsInTransaction(tx,{organizationId:org,orderId:redo.id,actorUserId:actor,requireInvoiceParity:true}));
   const read=await request(app).get('/api/orders/'+redo.id);expect(read.status).toBe(200);expect(Math.round(Number(read.body.total)*100)).toBe(amount+expectedTax);expect(read.body.lineItems[0].overridePriceCents).toBe(amount);
   expect(await db.select().from(invoices).where(eq(invoices.id,originalInvoice.id))).toEqual([originalInvoice]);expect(await db.select().from(invoiceLineItems).where(eq(invoiceLineItems.invoiceId,originalInvoice.id))).toEqual(originalLines);expect(await db.select().from(payments).where(eq(payments.invoiceId,originalInvoice.id))).toEqual(originalPayments);
   const [savedInvoice]=await db.select().from(invoices).where(eq(invoices.id,invoice.id));expect(savedInvoice.status).toBe('draft');expect(savedInvoice.issuedAt).toBeNull();expect(savedInvoice.lastSentAt).toBeNull();
 }finally{await db.update(organizations).set({defaultTaxRate:'0',taxEnabled:true}).where(eq(organizations.id,org));}
});
test('paid shipping is explicitly chosen and tax/configuration changes invalidate reviewed totals',async()=>{
 const source=await fixture();
 const paid=await paidCommand(source,[3500],{decision:'manual',amountCents:500});expect(paid.preview).toMatchObject({subtotalCents:3500,taxCents:0,shippingCents:500,totalCents:4000});
 const result=await create(source,paid.body);expect(result.status).toBe(201);expect(result.body.order.shippingCents).toBe(500);expect(Number(result.body.order.total)).toBe(40);
 const stale=await paidCommand(source,[3000]);
 await db.update(organizations).set({defaultTaxRate:'0.07',taxEnabled:true}).where(eq(organizations.id,org));
 try{const response=await create(source,stale.body);expect(response.status).toBe(409);expect(response.body.code).toBe('REDO_REVIEW_STALE');expect(await db.select().from(orders).where(eq(orders.redoRequestKey,stale.body.requestKey))).toHaveLength(0);}
 finally{await db.update(organizations).set({defaultTaxRate:'0'}).where(eq(organizations.id,org));}
});
test.each(['sum_children','manual_override'] as const)('paid Product group %s has no parent/child double count',async mode=>{
 const source=await fixture(true);
 await db.update(orderLineItems).set({parentPriceMode:mode,updatedAt:new Date()}).where(eq(orderLineItems.id,source.lineItems[0].id));
 const fresh=(await repo.getOrderById(org,source.id))!,price=mode==='sum_children'?4000:5500;
 const paid=await paidCommand(fresh,[mode==='sum_children'?undefined:5500,4000],undefined,true);
 expect(paid.preview.subtotalCents).toBe(price);expect(paid.preview.lines[1].includedInParent).toBe(true);
 const response=await create(fresh,paid.body);expect(response.status).toBe(201);expect(Math.round(Number(response.body.order.total)*100)).toBe(price);
 const parent=response.body.order.lineItems.find((line:any)=>line.lineItemRole==='parent');expect(parent.overridePriceCents).toBe(price);expect(parent.childCalculatedTotalCents).toBe(4000);
 const [invoice]=await db.select().from(invoices).where(eq(invoices.orderId,response.body.order.id));expect(invoice.status).toBe('draft');expect(invoice.totalCents).toBe(price);
 const rows=await db.select().from(invoiceLineItems).where(eq(invoiceLineItems.invoiceId,invoice.id));expect(rows.reduce((sum,line)=>sum+line.lineTotalCents,0)).toBe(price);
});
test('paid permissions, missing prices, unreviewed/changed prices, missing shipping and free positive charges fail closed',async()=>{
 const source=await fixture(),paid=await paidCommand(source,[3500]);
 expect((await request(app).post('/api/orders/'+source.id+'/redo/preview').set('x-test-role','employee').send(paid.details)).status).toBe(403);
 expect((await request(app).post('/api/orders/'+source.id+'/redo').set('x-test-role','employee').send(paid.body)).status).toBe(403);
 await expect(duplicateOrder({organizationId:org,sourceOrderId:source.id,actorUserId:actor,actorOrgRole:'employee',redo:paid.body as any})).rejects.toMatchObject({statusCode:403});
 expect((await create(source,{...paid.body,pricingReview:undefined})).status).toBe(400);
 expect((await create(source,{...paid.body,lines:[{...paid.body.lines[0],priceOverrideTotalCents:3600}]})).status).toBe(409);
 expect((await request(app).post('/api/orders/'+source.id+'/redo/preview').send({...paid.details,lines:[{...paid.details.lines[0],priceOverrideTotalCents:undefined}]})).status).toBe(400);
 expect((await request(app).post('/api/orders/'+source.id+'/redo/preview').send({...paid.details,shipping:undefined})).status).toBe(400);
 expect((await create(source,{...command(source),lines:[{...command(source).lines[0],priceOverrideTotalCents:1}]})).status).toBe(400);
 expect((await create(source,{...command(source),shipping:{decision:'manual',amountCents:1}})).status).toBe(400);
 const crossed=await request(app).post('/api/orders/'+source.id+'/redo/preview').set('x-test-org',otherOrg).send(paid.details);expect(crossed.status).toBe(404);
});

test('paid review uses current customer tax exemption and rejects a newly stale selected line',async()=>{
 await db.update(organizations).set({defaultTaxRate:'0.07',taxEnabled:true}).where(eq(organizations.id,org));
 await db.update(customers).set({isTaxExempt:true}).where(eq(customers.id,customer));
 try{
  const source=await fixture(),paid=await paidCommand(source,[3500]);expect(paid.preview).toMatchObject({subtotalCents:3500,taxCents:0,totalCents:3500});
  const created=await create(source,paid.body);expect(created.status).toBe(201);expect(Number(created.body.order.total)).toBe(35);
  const stale=await paidCommand(source,[2500]);await db.update(orderLineItems).set({updatedAt:new Date(Date.now()+1000)}).where(eq(orderLineItems.id,source.lineItems[0].id));
  const rejected=await create(source,stale.body);expect(rejected.status).toBe(409);expect(rejected.body.code).toBe('STALE_SOURCE');expect(await db.select().from(orders).where(eq(orders.redoRequestKey,stale.body.requestKey))).toHaveLength(0);
 }finally{await db.update(organizations).set({defaultTaxRate:'0'}).where(eq(organizations.id,org));await db.update(customers).set({isTaxExempt:false}).where(eq(customers.id,customer));}
});
