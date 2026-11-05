import { afterAll, beforeAll, expect, test } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import express from 'express';
import request from 'supertest';
import { db, pool } from '../db';
import { organizations, users, userOrganizations, customers, products, orders, orderLineItems, productionJobs, productionRuns, productionRunMembers, stations, productionStationSteps, invoices, payments, auditLogs, productionEvents, fulfillmentAdministrativeReconciliations } from '@shared/schema';
import { registerOrderRoutes } from '../routes/orders.routes';

const org=randomUUID(), otherOrg=randomUUID(), actor=randomUUID(), stationId=randomUUID();
const poolSettings=(pool as typeof pool & {options:{max:number}}).options;
let customer:string, product:string;
const app=express();app.use(express.json());
const auth=(req:any,_res:any,next:any)=>{req.organizationId=req.headers['x-tenant']||org;req.orgRole=req.headers['x-role']||'admin';req.user={id:actor,role:req.orgRole};next();};
const admin=(req:any,res:any,next:any)=>['admin','owner'].includes(req.orgRole)?next():res.status(403).json({message:'Admin or owner required'});
let measuredQueries=0, measuring=false;
beforeAll(async()=>{
  const logger={logQuery:()=>{if(measuring)measuredQueries++;}};
  (db as any)._.session.logger=logger; (db as any)._.session.options.logger=logger;
  await db.insert(organizations).values([org,otherOrg].map(id=>({id,name:'Isolated Close Job QA',slug:id,settings:{preferences:{proofing:{policy:'manual_requested_only' as const}}}})));
  await db.insert(users).values({id:actor,email:`${actor}@example.invalid`,role:'admin'});
  await db.insert(userOrganizations).values({userId:actor,organizationId:org,role:'admin'});
  [{id:customer}]=await db.insert(customers).values({organizationId:org,companyName:'Synthetic only',creditLimit:'100000',creditLimitConfiguredAt:new Date()}).returning();
  [{id:product}]=await db.insert(products).values({organizationId:org,name:'QA flatbed',description:'Synthetic',requiresProductionJob:true,requiresProofApproval:false,isActive:true}).returning();
  await db.insert(stations).values([{id:stationId,organizationId:org,key:'flatbed',name:'Flatbed',active:true},{id:randomUUID(),organizationId:org,key:'fulfillment',name:'Fulfillment',active:true}]);
  await db.insert(productionStationSteps).values({organizationId:org,stationKey:'flatbed',key:'queued',label:'Queued',sortOrder:0,active:true,triggers:[{type:'on_complete_route',config:{stationKey:'fulfillment',stepKey:'fulfillment'}}]});
  await registerOrderRoutes(app,{isAuthenticated:auth,tenantContext:auth,isAdmin:admin,isAdminOrOwner:admin});
},120000);
afterAll(async()=>{await pool.end();});
async function fixture(history=false, ownerCount=1) {
  const [order]=await db.insert(orders).values({organizationId:org,customerId:customer,createdByUserId:actor,orderNumber:`QA-${randomUUID()}`,state:'open',status:'in_production',shippingMethod:'ship'}).returning();
  const lines=await db.insert(orderLineItems).values(Array.from({length:3},(_,i)=>({orderId:order.id,productId:product,description:`Synthetic component ${i}`,quantity:10,unitPrice:'1',totalPrice:'10',workflowState:i===0?'in_production':'ready_for_production',status:'in_production',requiresDesign:false,requiresProofApproval:false,requiresPrepress:false,productType:'flatbed'}))).returning();
  const [job]=await db.insert(productionJobs).values({organizationId:org,orderId:order.id,lineItemId:lines[0]!.id,stationKey:'flatbed',stepKey:'queued',status:'in_progress',startedAt:new Date()}).returning();
  for(const line of lines.slice(1,ownerCount)) await db.insert(productionJobs).values({organizationId:org,orderId:order.id,lineItemId:line.id,stationKey:'flatbed',stepKey:'queued',status:'in_progress',startedAt:new Date()});
  if(history) await db.insert(productionJobs).values({organizationId:org,orderId:order.id,lineItemId:lines[1]!.id,stationKey:'flatbed',stepKey:'queued',status:'done',completedAt:new Date()});
  // This existing database column is intentionally accessed through canonical
  // routing SQL in production; it is not mapped on the legacy Drizzle model.
  await pool.query('update production_jobs set station_id=$1 where organization_id=$2 and order_id=$3',[stationId,org,order.id]);
  const [invoice]=await db.insert(invoices).values({organizationId:org,orderId:order.id,customerId:customer,createdByUserId:actor,invoiceNumber:Math.floor(Math.random()*100000000),status:'paid',total:'30',totalCents:3000,balanceDue:'0',amountPaid:'30'}).returning();
  return {order,lines,job,invoice};
}
const complete=(id:string)=>request(app).post(`/api/orders/${id}/complete-production`).send({confirmBypass:true,confirmProductionBootstrap:true,closeJobOverride:true,reconciliationReason:'historical_backlog_cleanup'});

test('one active owner and two missing owners complete via canonical bootstrap without financial changes',async()=>{
  const f=await fixture(); const started=Date.now(); const result=await complete(f.order.id);
  console.info('[Close Job synthetic result]',{durationMs:Date.now()-started,status:result.status,code:result.body.code,completedJobCount:result.body.completedJobCount});
  expect(result.status).toBe(200);
  expect((await db.select().from(orders).where(eq(orders.id,f.order.id)))[0]).toMatchObject({state:'production_complete',status:'ready_for_shipment'});
  expect((await db.select().from(invoices).where(eq(invoices.id,f.invoice.id)))[0]).toEqual(f.invoice);
});

test('terminal station history rejects bootstrap once with actionable review guidance',async()=>{
  const f=await fixture(true); const started=Date.now(); const result=await complete(f.order.id);
  console.info('[Close Job history result]',{durationMs:Date.now()-started,status:result.status,code:result.body.code});
  expect(result.status).toBe(409);expect(result.body.code).toBe('PRODUCTION_BOOTSTRAP_REVIEW_REQUIRED');
  expect((await db.select().from(orders).where(eq(orders.id,f.order.id)))[0]).toEqual(f.order);
  expect((await db.select().from(invoices).where(eq(invoices.id,f.invoice.id)))[0]).toEqual(f.invoice);
});

test('parent-line lock inversion does not deadlock concurrent canonical production updates',async()=>{
  const f=await fixture(), gate=await pool.connect();
  let pending:Promise<request.Response>|undefined, gateFailure:unknown;
  await gate.query('BEGIN'); await gate.query("SET LOCAL statement_timeout='6s'");
  try {
    await gate.query('select id from order_line_items where id=$1 for update',[f.lines[0]!.id]);
    pending=complete(f.order.id).then(result=>result);
    const until=Date.now()+6000; let blocked=false;
    while(Date.now()<until){
      const waiters=await pool.query("select pid from pg_stat_activity where datname=current_database() and wait_event_type='Lock' and query like '%order_line_items%' and pid<>pg_backend_pid()");
      if(waiters.rowCount){blocked=true;break;} await new Promise(resolve=>setTimeout(resolve,20));
    }
    expect(blocked).toBe(true);
    // Normal production holds its line before updating the parent projection.
    await gate.query('update orders set updated_at=updated_at where id=$1',[f.order.id]);
    await gate.query('COMMIT');
  } catch(error){gateFailure=error;await gate.query('ROLLBACK');}
  finally {gate.release();}
  const result=await pending!;
  console.info('[Close Job lock reproduction]',{gateCode:(gateFailure as {code?:string})?.code,status:result.status,code:result.body.code});
  expect(gateFailure).toBeUndefined(); expect(result.status).toBe(200);
},15000);

test.each([3,1])('performance baseline: %i existing owners, remaining lines bootstrap',async ownerCount=>{
  const samples:Array<{durationMs:number;queries:number}>=[];
  for(let i=0;i<3;i++){
    const f=await fixture(false,ownerCount); measuredQueries=0;measuring=true;const started=performance.now();
    let result:request.Response;
    try {result=await complete(f.order.id);}finally{measuring=false;}
    samples.push({durationMs:Math.round(performance.now()-started),queries:measuredQueries});
    expect(result.status).toBe(200);
    expect(measuredQueries).toBeLessThan(ownerCount===3?131:191);
  }
  console.info('[Close Job performance]',{ownerCount,bootstrapLines:3-ownerCount,samples});
});

test('override does not require another pool connection while holding its transaction connection',async()=>{
  const f=await fixture(), priorMax=poolSettings.max;
  poolSettings.max=Math.max(pool.totalCount,2);
  const reserved=[]; let completed=false, pending:Promise<request.Response>|undefined, completedWhileReserved=false, waiting=0;
  try {
    for(let i=0;i<poolSettings.max-1;i++)reserved.push(await pool.connect());
    pending=complete(f.order.id).then(result=>{completed=true;return result;});
    const until=Date.now()+2500;
    while(!completed && Date.now()<until){waiting=Math.max(waiting,pool.waitingCount);await new Promise(resolve=>setTimeout(resolve,10));}
    completedWhileReserved=completed;
  } finally {for(const client of reserved)client.release();poolSettings.max=priorMax;}
  const result=await pending!;
  console.info('[Close Job pool contention]',{completedWhileReserved,peakWaitingConnections:waiting,status:result.status});
  expect(result.status).toBe(200); expect(completedWhileReserved).toBe(true);
},15000);

test('all lines without owners and mixed complete lines retain quantities and bootstrap acknowledgement',async()=>{
  const f=await fixture();await db.delete(productionJobs).where(eq(productionJobs.id,f.job.id));
  await db.update(orderLineItems).set({workflowState:'completed',status:'complete'}).where(eq(orderLineItems.id,f.lines[2]!.id));
  const before=await request(app).get(`/api/orders/${f.order.id}/historical-fulfillment-reconciliation`);
  expect(before.body.data).toMatchObject({productionBootstrapLineCount:2,remainingProductionQuantity:20});
  const missing=await request(app).post(`/api/orders/${f.order.id}/complete-production`).send({confirmBypass:true,closeJobOverride:true});
  expect(missing.status).toBe(409);expect((await db.select().from(orders).where(eq(orders.id,f.order.id)))[0]).toEqual(f.order);
  const result=await complete(f.order.id);expect(result.status).toBe(200);expect(result.body.completedJobCount).toBe(2);
  expect(await db.select().from(productionJobs).where(eq(productionJobs.lineItemId,f.lines[2]!.id))).toHaveLength(0);
});

test('concurrent duplicate override requests commit one completion per physical line',async()=>{
  const f=await fixture();const results=await Promise.all([complete(f.order.id),complete(f.order.id)]);
  expect(results.map(result=>result.status)).toEqual([200,200]);
  const jobs=await db.select().from(productionJobs).where(eq(productionJobs.orderId,f.order.id));
  expect(jobs.filter(job=>job.status==='done')).toHaveLength(3);expect(jobs.filter(job=>job.stationKey==='fulfillment')).toHaveLength(3);
  expect(results.filter(result=>result.body.alreadyCompleted)).toHaveLength(1);
});

test('Combined Run ownership blocks before mutation and preserves run quantities',async()=>{
  const f=await fixture();const [run]=await db.insert(productionRuns).values({organizationId:org,runNumber:Math.floor(Math.random()*100000000),stationKey:'flatbed',status:'in_production',startedAt:new Date(),createdByUserId:actor}).returning();
  const [member]=await db.insert(productionRunMembers).values({organizationId:org,productionRunId:run.id,productionJobId:f.job.id,orderLineItemId:f.lines[0]!.id,allocatedQuantity:10,remainingQuantity:10}).returning();
  const result=await complete(f.order.id);expect(result.status).toBe(409);expect(result.body.code).toBe('PRODUCTION_RUN_OUTCOME_REQUIRED');
  expect((await db.select().from(productionRunMembers).where(eq(productionRunMembers.id,member.id)))[0]).toEqual(member);
  expect((await db.select().from(orders).where(eq(orders.id,f.order.id)))[0]).toEqual(f.order);
});

test('lock contention returns a bounded retryable rollback without losing ownership or audit',async()=>{
  const f=await fixture(), gate=await pool.connect();await gate.query('BEGIN');
  try {
    await gate.query('select id from order_line_items where id=$1 for update',[f.lines[0]!.id]);
    const started=performance.now(), result=await complete(f.order.id);
    expect(result.status).toBe(409);expect(result.body).toMatchObject({code:'PRODUCTION_OVERRIDE_BUSY',retryable:true,committed:false});
    expect(performance.now()-started).toBeLessThan(6000);
    expect((await db.select().from(orders).where(eq(orders.id,f.order.id)))[0]).toEqual(f.order);
    expect((await db.select().from(productionJobs).where(eq(productionJobs.id,f.job.id)))[0]).toEqual(f.job);
    expect(await db.select().from(productionEvents).where(eq(productionEvents.orderId,f.order.id))).toHaveLength(0);
  } finally {await gate.query('ROLLBACK');gate.release();}
},10000);

test('late transaction failure rolls back every completed/bootstrap line, parent, events and audit',async()=>{
  const f=await fixture(), fn=`qa_close_failure_${randomUUID().replaceAll('-','')}`;
  await pool.query(`create function ${fn}() returns trigger language plpgsql as $$ begin if NEW.order_id='${f.order.id}' AND NEW.type='note' AND NEW.payload->>'eventType'='order_ready_for_fulfillment' then raise exception 'Synthetic final handoff failure' using errcode='23514'; end if; return NEW; end; $$`);
  await pool.query(`create trigger ${fn}_tr before insert on production_events for each row execute function ${fn}()`);
  try {
    const result=await complete(f.order.id);expect(result.status).toBe(500);expect(result.body.committed).toBe(false);expect(result.body.message).not.toContain('insert into');
    expect((await db.select().from(orders).where(eq(orders.id,f.order.id)))[0]).toEqual(f.order);
    expect(await db.select().from(orderLineItems).where(eq(orderLineItems.orderId,f.order.id))).toEqual(f.lines);
    expect(await db.select().from(productionJobs).where(eq(productionJobs.orderId,f.order.id))).toEqual([f.job]);
    expect(await db.select().from(productionEvents).where(eq(productionEvents.orderId,f.order.id))).toHaveLength(0);
    expect((await db.select().from(invoices).where(eq(invoices.id,f.invoice.id)))[0]).toEqual(f.invoice);
  } finally {await pool.query(`drop trigger ${fn}_tr on production_events`);await pool.query(`drop function ${fn}()`);}
});

test('operational completion is idempotent, preserves financial records and rejects foreign tenant/role',async()=>{
  const f=await fixture();
  expect((await request(app).post(`/api/orders/${f.order.id}/complete-production`).set('x-role','employee').send({confirmBypass:true})).status).toBe(403);
  expect((await request(app).post(`/api/orders/${f.order.id}/complete-production`).set('x-tenant',otherOrg).send({confirmBypass:true,closeJobOverride:true})).status).toBe(404);
  const financialBefore=await db.select().from(payments).where(eq(payments.organizationId,org));
  expect((await complete(f.order.id)).status).toBe(200);
  const reconcile=()=>request(app).post(`/api/orders/${f.order.id}/reconcile-historical-fulfillment`).send({reason:'historical_backlog_cleanup'});
  expect((await reconcile()).status).toBe(200);expect((await reconcile()).status).toBe(200);
  const [saved]=await db.select().from(orders).where(eq(orders.id,f.order.id));expect(saved!.fulfillmentStatus).toBe('delivered');
  expect(['closed','production_complete']).toContain(saved!.state);
  expect(await db.select().from(fulfillmentAdministrativeReconciliations).where(eq(fulfillmentAdministrativeReconciliations.orderId,f.order.id))).toHaveLength(3);
  expect((await db.select().from(invoices).where(eq(invoices.id,f.invoice.id)))[0]).toEqual(f.invoice);
  expect(await db.select().from(payments).where(eq(payments.organizationId,org))).toEqual(financialBefore);
});

test('administrative bootstrap cannot bypass canonical customer credit release',async()=>{
  const f=await fixture();
  await db.update(orders).set({total:'300000'}).where(eq(orders.id,f.order.id));
  const result=await complete(f.order.id);expect(result.status).toBe(409);expect(result.body.code).toBe('PRODUCTION_CREDIT_HOLD');
  expect((await db.select().from(productionJobs).where(eq(productionJobs.id,f.job.id)))[0]).toEqual(f.job);
  expect(await db.select().from(productionJobs).where(eq(productionJobs.orderId,f.order.id))).toHaveLength(1);
  expect((await db.select().from(invoices).where(eq(invoices.id,f.invoice.id)))[0]).toEqual(f.invoice);
});
