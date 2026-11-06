import { afterAll, beforeAll, expect, test } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import express from 'express';
import request from 'supertest';
import { db, pool } from '../db';
import { organizations, users, userOrganizations, customers, products, orders, orderStatusPills, orderLineItems, productionJobs, stations, productionStationSteps, productionRuns, productionRunMembers, productionEvents, orderAuditLog, invoices, invoiceLineItems, lineItemFiles, payments } from '@shared/schema';
import { registerOrderRoutes } from '../routes/orders.routes';
import { registerProductionJobsRoutes, updateProductionJobStatusWorkflow } from '../routes/productionJobs.routes';
import { transitionToStation } from '../services/productionOwnership';
import { transitionLineItemWorkflowState } from '../services/lineItemWorkflowService';
import { transitionProductionRun } from '../services/productionRunService';
import { OrdersRepository } from '../storage/orders.repo';
import { getOrderReconciliationDiagnostic } from '../services/orderReconciliationDiagnostic';
import { assignOrderStatusPill } from '../services/orderStatusPillService';

const org=randomUUID(), foreign=randomUUID(), actor=randomUUID(), roll=randomUUID(), flatbed=randomUUID();
let customer:string, product:string;
const app=express();app.use(express.json());
const auth=(req:any,_res:any,next:()=>void)=>{req.organizationId=req.headers['x-tenant']||org;req.orgRole=req.headers['x-role']||'admin';req.actorOrgRole=req.orgRole;req.user={id:actor,role:req.orgRole,email:'synthetic@example.invalid'};next();};
const admin=(req:any,res:any,next:()=>void)=>['owner','admin'].includes(req.orgRole)?next():res.status(403).json({error:'Owner/Admin required'});
beforeAll(async()=>{
 await db.insert(organizations).values([org,foreign].map(id=>({id,name:'Disposable cancellation QA',slug:id,settings:{preferences:{proofing:{policy:'manual_requested_only' as const}}}})));
 await db.insert(users).values({id:actor,email:`${actor}@example.invalid`,role:'admin'});
 await db.insert(userOrganizations).values({userId:actor,organizationId:org,role:'admin'});
 [{id:customer}]=await db.insert(customers).values({organizationId:org,companyName:'Synthetic buyer',creditLimit:'100000',creditLimitConfiguredAt:new Date()}).returning();
 [{id:product}]=await db.insert(products).values({organizationId:org,name:'Synthetic physical product',description:'QA only',requiresProductionJob:true,requiresProofApproval:false,isActive:true}).returning();
 await db.insert(stations).values([{id:roll,organizationId:org,key:'roll',name:'Roll',active:true},{id:flatbed,organizationId:org,key:'flatbed',name:'Flatbed',active:true},{id:randomUUID(),organizationId:org,key:'prepress',name:'Prepress',active:true}]);
 await db.insert(productionStationSteps).values(['roll','flatbed'].map(stationKey=>({organizationId:org,stationKey,key:'queued',label:'Queued',sortOrder:0,active:true,triggers:[{type:'on_complete_route',config:{stationKey:'fulfillment',stepKey:'fulfillment'}}]})));
 await registerOrderRoutes(app,{isAuthenticated:auth,tenantContext:auth,isAdmin:admin,isAdminOrOwner:admin});
 registerProductionJobsRoutes(app,{isAuthenticated:auth,tenantContext:auth,isAdminOrOwner:admin,assertInternalUser:(req,res)=>{if(req.orgRole==='customer'){res.status(403).json({error:'Internal staff required'});return false;}return true;}});
},120000);
afterAll(async()=>{await pool.end();});
async function fixture(modern=true){
 const [order]=await db.insert(orders).values({organizationId:org,customerId:customer,createdByUserId:actor,orderNumber:`QA-${randomUUID()}`,state:'open',status:'in_production',shippingMethod:'ship'}).returning();
 const lines=await db.insert(orderLineItems).values(['Window Perf','Acrylic','ACM'].map((description,i)=>({orderId:order.id,productId:product,description:`Synthetic ${description}`,sortOrder:i,quantity:[2,4,2][i],unitPrice:'10',totalPrice:String([20,40,20][i]),workflowState:'in_production' as const,status:'in_production',productType:i===0?'wide_roll':'flatbed',requiresDesign:false,requiresProofApproval:false,requiresPrepress:false}))).returning();
 const jobs=await db.insert(productionJobs).values(lines.map((line,i)=>({organizationId:org,orderId:order.id,lineItemId:line.id,stationKey:i===0?'roll':'flatbed',stepKey:'queued',status:'queued'}))).returning();
 if(modern)for(let i=0;i<jobs.length;i++)await pool.query('update production_jobs set station_id=$1 where id=$2',[i===0?roll:flatbed,jobs[i].id]);
 return {order,lines,jobs};
}
type Fixture=Awaited<ReturnType<typeof fixture>>;
const cancel=(f:Fixture,i=0,tenant=org)=>request(app).patch(`/api/production/jobs/${f.jobs[i].id}/status`).set('x-tenant',tenant).send({status:'canceled',reason:'duplicate'});
const owners=(f:Fixture,i=0)=>db.select().from(productionJobs).where(eq(productionJobs.lineItemId,f.lines[i].id));
const preview=(f:Fixture)=>request(app).get(`/api/orders/${f.order.id}/historical-fulfillment-reconciliation`);

test('same-station terminal uniqueness cannot strand a retained active line: cancellation rolls back',async()=>{
 const f=await fixture();const result=await cancel(f);
 expect(result.status).toBe(409);expect(result.body.code).toBe('PRODUCTION_CANCELLATION_OWNER_REQUIRED');
 expect((await owners(f))[0].status).toBe('queued');expect(await owners(f)).toHaveLength(1);
 expect((await preview(f)).body.data).toMatchObject({remainingProductionQuantity:8,remainingFulfillmentQuantity:8,activeProductionJobCount:3,productionBootstrapLineCount:0});
});

test('legacy routing can create a distinct canonical replacement without rewriting canceled history',async()=>{
 const f=await fixture(false);const result=await cancel(f);expect(result.status).toBe(200);
 const rows=await owners(f);expect(rows).toHaveLength(2);expect(rows.find(row=>row.id===f.jobs[0].id)?.status).toBe('canceled');
 expect(rows.filter(row=>row.status==='queued')).toHaveLength(1);
 const second=await cancel(f);expect(second.status).toBe(200);expect(await owners(f)).toEqual(rows);
 expect((await preview(f)).body.data).toMatchObject({remainingProductionQuantity:8,remainingFulfillmentQuantity:8,productionBootstrapLineCount:0});
 const events=await db.select().from(productionEvents).where(eq(productionEvents.productionJobId,f.jobs[0].id));
 expect(events.some(event=>(event.payload as any)?.reason==='duplicate')).toBe(true);
});

test('failed canonical replacement rolls back cancellation, timer events, and audit',async()=>{
 const f=await fixture(false);
 await db.update(productionJobs).set({stationKey:'unconfigured_qa'}).where(eq(productionJobs.id,f.jobs[0].id));
 await db.insert(productionEvents).values({organizationId:org,productionJobId:f.jobs[0].id,orderId:f.order.id,orderLineItemId:f.lines[0].id,type:'timer_started',createdAt:new Date(Date.now()-5000)});
 expect((await cancel(f)).status).toBe(409);
 expect(await owners(f)).toHaveLength(1);expect((await owners(f))[0]).toMatchObject({status:'queued',totalSeconds:0});
 expect(await db.select().from(productionEvents).where(eq(productionEvents.productionJobId,f.jobs[0].id))).toHaveLength(1);
 expect(await db.select().from(orderAuditLog).where(eq(orderAuditLog.orderId,f.order.id))).toHaveLength(0);
});

test('replacement preserves mixed active ownership and multiple canceled history records',async()=>{
 const f=await fixture(false);
 const [history]=await db.insert(productionJobs).values({organizationId:org,orderId:f.order.id,lineItemId:f.lines[0].id,stationKey:'design',stepKey:'design',status:'canceled'}).returning();
 expect((await cancel(f)).status).toBe(200);
 const rows=await owners(f);expect(rows.filter(row=>row.status==='queued')).toHaveLength(1);
 expect(rows.filter(row=>row.status==='canceled')).toHaveLength(2);
 expect(rows.find(row=>row.id===history.id)).toEqual(history);
 expect((await preview(f)).body.data).toMatchObject({remainingProductionQuantity:8,remainingFulfillmentQuantity:8,activeProductionJobCount:3,productionBootstrapLineCount:0});
});

/** Both operations are held at the real line-row lock before either reads authority. */
async function concurrent(f:Fixture, first:()=>Promise<unknown>, second:()=>Promise<unknown>){
 const gate=await pool.connect();const pending:Array<Promise<PromiseSettledResult<unknown>>>=[];
 const launch=(fn:()=>Promise<unknown>)=>pending.push(fn().then(value=>({status:'fulfilled' as const,value}),reason=>({status:'rejected' as const,reason})));
 const wait=async(count:number)=>{
  const until=Date.now()+2000;
  while(Date.now()<until){
   const result=await pool.query("select count(*)::int as n from pg_stat_activity where datname=current_database() and wait_event_type='Lock' and query like '%order_line_items%'");
   if(result.rows[0].n>=count)return;
   await new Promise(resolve=>setTimeout(resolve,10));
  }
  throw new Error('Expected real line-lock waiters');
 };
 await gate.query('BEGIN');
 try{await gate.query('select id from order_line_items where id=$1 for update',[f.lines[0].id]);launch(first);await wait(1);launch(second);await wait(2);}
 finally{await gate.query('COMMIT');gate.release();}
 return Promise.all(pending);
}
const cancelInTransaction=(f:Fixture)=>db.transaction(tx=>updateProductionJobStatusWorkflow(tx,{organizationId:org,jobId:f.jobs[0].id,status:'canceled',userId:actor,reason:'Retain line; reroute canonically'}));

test('concurrent duplicate cancellation creates only one replacement and one cancellation audit',async()=>{
 const f=await fixture(false);const results=await concurrent(f,()=>cancelInTransaction(f),()=>cancelInTransaction(f));
 expect(results.every(row=>row.status==='fulfilled')).toBe(true);expect(await owners(f)).toHaveLength(2);
 const events=await db.select().from(productionEvents).where(eq(productionEvents.productionJobId,f.jobs[0].id));
 expect(events.filter(event=>event.type==='status_changed' && (event.payload as any)?.newStatus==='canceled')).toHaveLength(1);
});

test.each([true,false])('concurrent cancellation and reassignment preserve one owner (cancel first: %s)',async cancelFirst=>{
 const f=await fixture(false);
 const reassign=()=>db.transaction(tx=>transitionToStation(tx,{organizationId:org,orderId:f.order.id,lineItemId:f.lines[0].id,targetStationKey:'prepress',targetStepKey:'prepress',actorUserId:actor,reason:'QA correction'}));
 const results=await concurrent(f,cancelFirst?()=>cancelInTransaction(f):reassign,cancelFirst?reassign:()=>cancelInTransaction(f));
 expect(results[0].status).toBe('fulfilled');
 const rows=await owners(f);expect(rows.filter(row=>!['done','void','canceled','cancelled'].includes(row.status))).toHaveLength(1);
 expect(rows.find(row=>row.stationKey==='prepress')?.status).toBe('queued');
 expect((await preview(f)).body.data).toMatchObject({remainingProductionQuantity:8,remainingFulfillmentQuantity:8,productionBootstrapLineCount:0});
});

test('current workflow refuses routing to a terminal slot instead of committing ownerless state',async()=>{
 const f=await fixture();await db.update(productionJobs).set({status:'canceled'}).where(eq(productionJobs.id,f.jobs[0].id));
 await expect(db.transaction(tx=>transitionLineItemWorkflowState(tx,{organizationId:org,lineItemId:f.lines[0].id,toState:'in_production',actorUserId:actor}))).rejects.toMatchObject({code:'WORKFLOW_OWNER_REQUIRED'});
 expect((await owners(f))[0].status).toBe('canceled');
});

test('canonical line cancellation records canceled rather than physically completed production',async()=>{
 const f=await fixture();await db.transaction(tx=>transitionLineItemWorkflowState(tx,{organizationId:org,lineItemId:f.lines[0].id,toState:'canceled',actorUserId:actor}));
 expect((await owners(f))[0].status).toBe('canceled');
 expect((await preview(f)).body.data).toMatchObject({remainingProductionQuantity:6,remainingFulfillmentQuantity:6});
});

test('actual duplicate-line removal preserves history, synchronizes totals, and is replay-safe',async()=>{
 const f=await fixture();
 const [invoice]=await db.insert(invoices).values({organizationId:org,orderId:f.order.id,customerId:customer,createdByUserId:actor,invoiceNumber:Math.floor(Math.random()*100000000),status:'draft',total:'80',totalCents:8000,balanceDue:'80',amountPaid:'0'}).returning();
 const [artwork]=await db.insert(lineItemFiles).values({organizationId:org,orderId:f.order.id,lineItemId:f.lines[0].id,role:'original',storagePath:'synthetic/never-read.pdf',originalFilename:'synthetic-source.pdf',mimeType:'application/pdf',sizeBytes:1,createdByUserId:actor}).returning();
 const remove=()=>request(app).post(`/api/order-line-items/${f.lines[0].id}/corrective-remove`).send({reason:'Confirmed duplicate commercial line'});
 expect((await remove()).status).toBe(200);expect((await remove()).status).toBe(200);
 expect((await owners(f))[0].status).toBe('canceled');
 const [line]=await db.select().from(orderLineItems).where(eq(orderLineItems.id,f.lines[0].id));expect(line).toMatchObject({status:'canceled',workflowState:'canceled'});
 expect((await preview(f)).body.data).toMatchObject({remainingProductionQuantity:6,remainingFulfillmentQuantity:6,productionBootstrapLineCount:0});
 expect(await db.select().from(orderAuditLog).where(and(eq(orderAuditLog.orderId,f.order.id),eq(orderAuditLog.actionType,'line_item.correctively_removed_with_active_workflow')))).toHaveLength(1);
 expect((await db.select().from(orders).where(eq(orders.id,f.order.id)))[0].subtotal).toBe('60.00');
 expect((await db.select().from(invoices).where(eq(invoices.id,invoice.id)))[0]).toMatchObject({total:'60.00',totalCents:6000});
 expect((await db.select().from(invoiceLineItems).where(eq(invoiceLineItems.invoiceId,invoice.id))).map(row=>row.orderLineItemId).sort()).toEqual(f.lines.slice(1).map(row=>row.id).sort());
 expect((await db.select().from(lineItemFiles).where(eq(lineItemFiles.id,artwork.id)))[0]).toEqual(artwork);
});

test('database rejects a conflicting active owner without changing the existing line or owner',async()=>{
 const f=await fixture();
 const before=await owners(f);
 await expect(db.insert(productionJobs).values({organizationId:org,orderId:f.order.id,lineItemId:f.lines[0].id,stationKey:'design',stepKey:'design',status:'queued'})).rejects.toThrow('uq_active_job_per_line_item');
 expect(await owners(f)).toEqual(before);expect((await db.select().from(orderLineItems).where(eq(orderLineItems.id,f.lines[0].id)))[0].status).toBe('in_production');
 expect(await db.select().from(orderAuditLog).where(eq(orderAuditLog.orderId,f.order.id))).toHaveLength(0);
});

test('failure after replacement rolls back every owner and event in the caller transaction',async()=>{
 const f=await fixture(false);const before=await owners(f);
 await expect(db.transaction(async tx=>{
  await updateProductionJobStatusWorkflow(tx,{organizationId:org,jobId:f.jobs[0].id,status:'canceled',userId:actor});
  throw new Error('Synthetic transaction failure after routing');
 })).rejects.toThrow('Synthetic transaction failure');
 expect(await owners(f)).toEqual(before);
 expect(await db.select().from(productionEvents).where(eq(productionEvents.orderId,f.order.id))).toHaveLength(0);
 expect((await preview(f)).body.data).toMatchObject({remainingProductionQuantity:8,remainingFulfillmentQuantity:8,activeProductionJobCount:3,productionBootstrapLineCount:0});
});

test('authorized canonical production bypass can retire work without creating replacement',async()=>{
 const f=await fixture();await db.update(orderLineItems).set({productionBypassed:true}).where(eq(orderLineItems.id,f.lines[0].id));
 expect((await cancel(f)).status).toBe(200);
 expect(await owners(f)).toHaveLength(1);expect((await owners(f))[0].status).toBe('canceled');
 expect((await preview(f)).body.data).toMatchObject({remainingProductionQuantity:6,productionBootstrapLineCount:0});
});

test('replacement routing never bypasses the existing proof requirement',async()=>{
 const f=await fixture(false);await db.update(orderLineItems).set({requiresProofApproval:true}).where(eq(orderLineItems.id,f.lines[0].id));
 const before=await owners(f);const result=await cancel(f);expect(result.status).toBe(409);
 expect(await owners(f)).toEqual(before);
});

test('retained-line cancellation never changes Invoice or payment history',async()=>{
 const f=await fixture(false);
 const [invoice]=await db.insert(invoices).values({organizationId:org,orderId:f.order.id,customerId:customer,createdByUserId:actor,invoiceNumber:Math.floor(Math.random()*100000000),status:'paid',total:'80',totalCents:8000,balanceDue:'0',amountPaid:'80'}).returning();
 const paymentsBefore=await db.select().from(payments).where(eq(payments.organizationId,org));
 expect((await cancel(f)).status).toBe(200);
 expect((await db.select().from(invoices).where(eq(invoices.id,invoice.id)))[0]).toEqual(invoice);
 expect(await db.select().from(payments).where(eq(payments.organizationId,org))).toEqual(paymentsBefore);
});

test('existing read-only diagnostic distinguishes terminal history with replacement from missing ownership',async()=>{
 const f=await fixture(false);expect((await cancel(f)).status).toBe(200);
 const retained=await getOrderReconciliationDiagnostic({organizationId:org,orderId:f.order.id});
 expect(retained.findings).toContainEqual(expect.objectContaining({code:'TERMINAL_HISTORY_WITH_REMAINING_OBLIGATION',lineItemId:f.lines[0].id}));
 expect(retained.canonicalPreview.productionBootstrapLineCount).toBe(0);
 const rows=await owners(f);const replacement=rows.find(row=>row.status==='queued')!;
 // Synthetic historical inconsistency, never a live-data repair.
 await db.update(productionJobs).set({status:'canceled'}).where(eq(productionJobs.id,replacement.id));
 const orphan=await getOrderReconciliationDiagnostic({organizationId:org,orderId:f.order.id});
 expect(orphan.canonicalPreview).toMatchObject({productionBootstrapLineCount:1,remainingProductionQuantity:8});
 expect(orphan.mutationAvailable).toBe(false);
 expect((await owners(f)).map(row=>row.status)).toEqual(['canceled','canceled']);
});

test('permission and tenant boundaries reject cancellation and commercial removal',async()=>{
 const f=await fixture(false),url=`/api/order-line-items/${f.lines[0].id}/corrective-remove`;
 expect((await cancel(f,0,foreign)).status).toBe(404);
 expect((await request(app).patch(`/api/production/jobs/${f.jobs[0].id}/status`).set('x-role','customer').send({status:'canceled'})).status).toBe(403);
 expect((await request(app).post(url).set('x-role','employee').send({reason:'duplicate'})).status).toBe(403);
 expect((await request(app).post(url).set('x-tenant',foreign).send({reason:'duplicate'})).status).toBe(404);
 expect((await owners(f))[0].status).toBe('queued');
});

test('Combined Run owns cancellation of its members; job and line endpoints roll back',async()=>{
 const f=await fixture();const [run]=await db.insert(productionRuns).values({organizationId:org,runNumber:Math.floor(Math.random()*100000000),stationKey:'roll',status:'draft',createdByUserId:actor,productionFileStrategy:'rip_managed'}).returning();
 const [member]=await db.insert(productionRunMembers).values({organizationId:org,productionRunId:run.id,productionJobId:f.jobs[0].id,orderLineItemId:f.lines[0].id,allocatedQuantity:2,remainingQuantity:2}).returning();
 expect((await cancel(f)).status).toBe(409);
 await expect(db.transaction(tx=>transitionLineItemWorkflowState(tx,{organizationId:org,lineItemId:f.lines[0].id,toState:'canceled',actorUserId:actor}))).rejects.toMatchObject({code:'WORKFLOW_CANCELLATION_RUN_OWNED'});
 const removal=await request(app).post(`/api/order-line-items/${f.lines[0].id}/corrective-remove`).send({reason:'duplicate'});expect(removal.status).toBe(409);
 await transitionProductionRun({organizationId:org,actorUserId:actor,runId:run.id,action:'cancel',reason:'Unstarted run canceled'});
 expect((await owners(f))[0].status).toBe('queued');
 expect((await db.select().from(productionRunMembers).where(eq(productionRunMembers.id,member.id)))[0]).toEqual(member);
 expect((await preview(f)).body.data.productionBootstrapLineCount).toBe(0);
});

test('Open-state search includes Complete display labels and keeps tenant filtering and pagination',async()=>{
 const f=await fixture();
 const [pill]=await db.insert(orderStatusPills).values({organizationId:org,stateScope:'closed',key:'complete',name:'Complete',isActive:true}).returning();
 await assignOrderStatusPill({organizationId:org,orderId:f.order.id,statusPillId:pill.id,actorUserId:actor});
 expect((await preview(f)).body.data).toMatchObject({remainingProductionQuantity:8,remainingFulfillmentQuantity:8,activeProductionJobCount:3,orderState:'open',orderStatus:'in_production'});
 const repo=new OrdersRepository(db);
 const args={state:'open',search:f.order.orderNumber,page:1,pageSize:1,includeThumbnails:false} as const;
 const result=await repo.getAllOrdersPaginated(org,args);expect(result.items.map(row=>row.id)).toContain(f.order.id);expect(result.totalCount).toBe(1);
 expect((await repo.getAllOrdersPaginated(foreign,args)).items).toHaveLength(0);
 expect((await repo.getAllOrdersPaginated(org,{...args,state:'closed'})).items).toHaveLength(0);
 expect((await repo.getAllOrdersPaginated(org,{...args,state:'production_complete'})).items).toHaveLength(0);
 expect((await repo.getAllOrdersPaginated(org,{...args,state:'canceled'})).items).toHaveLength(0);
 expect((await repo.getAllOrdersPaginated(org,{...args,state:undefined})).items.map(row=>row.id)).toContain(f.order.id);
 const other=await fixture();await db.update(orders).set({orderNumber:`${f.order.orderNumber}-second`}).where(eq(orders.id,other.order.id));
 const first=await repo.getAllOrdersPaginated(org,{...args,sortBy:'orderNumber',sortDir:'asc'});
 const second=await repo.getAllOrdersPaginated(org,{...args,sortBy:'orderNumber',sortDir:'asc',page:2});
 expect(first.totalCount).toBe(2);expect(first.items).toHaveLength(1);expect(second.items).toHaveLength(1);
 expect(first.items[0].id).not.toBe(second.items[0].id);
});
