import { afterAll, beforeAll, expect, test } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import express from 'express';
import request from 'supertest';
import { db, pool } from '../db';
import { organizations, users, customers, products, orders, orderLineItems, productionJobs, productionRuns, productionRunMembers, productionEvents, auditLogs, stations, productionStationSteps, prepressSessions, lineItemFiles } from '@shared/schema';
import { recordProductionRunOutcome, transitionProductionRun } from '../services/productionRunService';
import { completeProductionJobWorkflow } from '../routes/productionJobs.routes';

const org=randomUUID(), otherOrg=randomUUID(), actor=randomUUID();
let customer:string, product:string, runNumber=0;
const app=express();app.use(express.json());
beforeAll(async()=>{
  await db.insert(organizations).values([org,otherOrg].map(id=>({id,name:'Synthetic production integrity',slug:id,settings:{preferences:{proofing:{policy:'manual_requested_only' as const}}}})));
  await db.insert(users).values({id:actor,email:`${actor}@example.invalid`,role:'admin'});
  [{id:customer}]=await db.insert(customers).values({organizationId:org,companyName:'Synthetic production buyer',creditLimit:'100000',creditLimitConfiguredAt:new Date()}).returning();
  [{id:product}]=await db.insert(products).values({organizationId:org,name:'Synthetic physical product',description:'QA only',requiresProductionJob:true,requiresProofApproval:false,isActive:true}).returning();
  await db.insert(stations).values(['roll','prepress','design','fulfillment'].map(key=>({id:randomUUID(),organizationId:org,key,name:key,active:true})));
  await db.insert(productionStationSteps).values({organizationId:org,stationKey:'roll',key:'queued',label:'Queued',sortOrder:0,active:true,triggers:[{type:'on_complete_route',config:{stationKey:'fulfillment',stepKey:'fulfillment'}}]});
  const auth=(req:any,_res:any,next:any)=>{req.organizationId=org;req.orgRole='admin';req.user={id:actor,role:'admin'};next();};
  const {registerPrepressQueueRoutes}=await import('../routes/prepress.routes');
  registerPrepressQueueRoutes(app,{isAuthenticated:auth,tenantContext:auth,isAdminOrOwner:auth,assertInternalUser:()=>true});
},120000);
afterAll(async()=>{await pool.end();});

async function fixture(sibling=false,station='roll') {
  const [order]=await db.insert(orders).values({organizationId:org,customerId:customer,createdByUserId:actor,orderNumber:`QA-${randomUUID()}`,state:'open',status:'in_production'}).returning();
  const [line]=await db.insert(orderLineItems).values({orderId:order.id,productId:product,description:'Synthetic production',quantity:100,unitPrice:'1',totalPrice:'100',workflowState:'in_production',status:'in_production',requiresPrepress:false,requiresDesign:false,requiresProofApproval:false,productType:'wide_roll'}).returning();
  const [job]=await db.insert(productionJobs).values({organizationId:org,orderId:order.id,lineItemId:line.id,stationKey:station,stepKey:station==='roll'?'queued':station,status:'in_progress',startedAt:new Date()}).returning();
  const [run]=await db.insert(productionRuns).values({organizationId:org,runNumber:++runNumber,stationKey:station,status:'in_production',startedAt:new Date(),createdByUserId:actor,productionFileStrategy:'rip_managed'}).returning();
  const [member]=await db.insert(productionRunMembers).values({organizationId:org,productionRunId:run.id,productionJobId:job.id,orderLineItemId:line.id,allocatedQuantity:100,remainingQuantity:100}).returning();
  let siblingId:string|undefined;
  if(sibling){const [row]=await db.insert(orderLineItems).values({orderId:order.id,productId:product,description:'Unfinished physical sibling without owner',quantity:1,unitPrice:'1',totalPrice:'1',workflowState:'ready_for_production',status:'in_production'}).returning();siblingId=row.id;}
  return {order,line,job,run,member,siblingId};
}
type Fixture=Awaited<ReturnType<typeof fixture>>;
const outcome=(f:Fixture,successfulQuantity:number,key=randomUUID(),organizationId=org)=>recordProductionRunOutcome({organizationId,runId:f.run.id,actorUserId:actor,idempotencyKey:key,members:[{memberId:f.member.id,successfulQuantity}]});
const savedMember=async(f:Fixture)=>(await db.select().from(productionRunMembers).where(eq(productionRunMembers.id,f.member.id)))[0];
const events=async(f:Fixture)=>(await db.select().from(productionEvents).where(eq(productionEvents.productionJobId,f.job.id))).filter(row=>(row.payload as any)?.eventType==='production_run_member_outcome_recorded');

/** Real row-lock gate: old code reads both stale member snapshots before writes;
 * fixed code waits on the run BEFORE taking either snapshot. No service mocks. */
async function concurrent(f:Fixture,first:()=>Promise<unknown>,second:()=>Promise<unknown>){
  const gate=await pool.connect();const tasks:Promise<PromiseSettledResult<unknown>>[]=[];
  const launch=(fn:()=>Promise<unknown>)=>tasks.push(fn().then(value=>({status:'fulfilled' as const,value}),reason=>({status:'rejected' as const,reason})));
  async function waitForBlocked(count:number){
    const until=Date.now()+6000;
    while(Date.now()<until){const result=await pool.query("select count(*)::int as n from pg_stat_activity where datname=current_database() and wait_event_type='Lock' and pid<>pg_backend_pid() and query like '%production_%'");if(result.rows[0].n>=count)return;await new Promise(resolve=>setTimeout(resolve,20));}
    throw new Error(`Expected ${count} real PostgreSQL lock waiters`);
  }
  await gate.query('BEGIN');
  try{
    await gate.query('select id from production_runs where id=$1 for update',[f.run.id]);
    launch(first);await waitForBlocked(1);launch(second);await waitForBlocked(2);
  }finally{await gate.query('COMMIT');gate.release();}
  return Promise.all(tasks);
}

test('concurrent 50 then 20 outcomes cannot overwrite confirmed 50 pieces',async()=>{
  const f=await fixture();const results=await concurrent(f,()=>outcome(f,50),()=>outcome(f,20));
  expect((await savedMember(f)).completedQuantity).toBe(50);
  expect(results.map(r=>r.status)).toEqual(['fulfilled','rejected']);
  expect((results[1] as PromiseRejectedResult).reason.code).toBe('PRODUCTION_RUN_OUTCOME_CONFIRMED');
  expect(await savedMember(f)).toMatchObject({successfulQuantity:50,completedQuantity:50,remainingQuantity:50});expect(await events(f)).toHaveLength(1);
});
test('concurrent duplicate retries emit one outcome and one audit record',async()=>{
  const f=await fixture(),key=randomUUID();const results=await concurrent(f,()=>outcome(f,50,key),()=>outcome(f,50,key));
  expect(results.every(r=>r.status==='fulfilled')).toBe(true);expect(await events(f)).toHaveLength(1);
  expect(await db.select().from(auditLogs).where(and(eq(auditLogs.entityId,f.run.id),eq(auditLogs.organizationId,org)))).toHaveLength(1);
});
test.each(['design','prepress'])('generic %s completion rejects before changing ownership, timers, evidence or history',async station=>{
  const f=await fixture(false,station);await db.update(orderLineItems).set({workflowState:station==='design'?'in_design':'in_prepress'}).where(eq(orderLineItems.id,f.line.id));
  await expect(db.transaction(tx=>completeProductionJobWorkflow(tx,{organizationId:org,userId:actor,jobId:f.job.id,skipProduction:false}))).rejects.toMatchObject({statusCode:409,code:'PRODUCTION_MANAGED_COMPLETION_REQUIRED'});
  expect((await db.select().from(productionJobs).where(eq(productionJobs.id,f.job.id)))[0]).toMatchObject({status:'in_progress',completedAt:null,totalSeconds:0});
  expect(await db.select().from(productionEvents).where(eq(productionEvents.productionJobId,f.job.id))).toHaveLength(0);
});
test('completed run leaves unfinished physical sibling actionable instead of marking Order shipment-ready',async()=>{
  const f=await fixture(true);await outcome(f,100);
  expect((await db.select().from(orders).where(eq(orders.id,f.order.id)))[0]).toMatchObject({state:'open',status:'in_production',productionCompletedAt:null});
  expect((await db.select().from(orderLineItems).where(eq(orderLineItems.id,f.line.id)))[0]).toMatchObject({workflowState:'completed',status:'complete'});
  const successors=await db.select().from(productionJobs).where(and(eq(productionJobs.lineItemId,f.line.id),eq(productionJobs.stationKey,'fulfillment')));expect(successors).toHaveLength(1);
  expect((await db.select().from(orderLineItems).where(eq(orderLineItems.id,f.siblingId!)))[0].workflowState).toBe('ready_for_production');
});
test('fully completed Order hands off once; duplicate completion never duplicates the Fulfillment owner',async()=>{
  const f=await fixture(),key=randomUUID();await outcome(f,100,key);await outcome(f,100,key);
  expect((await db.select().from(orders).where(eq(orders.id,f.order.id)))[0]).toMatchObject({state:'production_complete',status:'ready_for_shipment',routingTarget:'fulfillment'});
  expect(await db.select().from(productionJobs).where(and(eq(productionJobs.lineItemId,f.line.id),eq(productionJobs.stationKey,'fulfillment')))).toHaveLength(1);expect(await events(f)).toHaveLength(1);
});
test('invalid route rolls back member quantities, job completion, ownership and all side effects',async()=>{
  const f=await fixture(false,'unconfigured_qa');await expect(outcome(f,100)).rejects.toMatchObject({code:'PRODUCTION_RUN_COMPLETION_ROUTE_MISSING'});
  expect(await savedMember(f)).toMatchObject({completedQuantity:0,successfulQuantity:0,remainingQuantity:100,lastOutcomeIdempotencyKey:null});
  expect((await db.select().from(productionJobs).where(eq(productionJobs.id,f.job.id)))[0].status).toBe('in_progress');expect(await events(f)).toHaveLength(0);
});
test('quantity bounds, confirmed damage and tenant boundaries remain enforced',async()=>{
  const f=await fixture();await expect(outcome(f,101)).rejects.toMatchObject({code:'PRODUCTION_RUN_OUTCOME_INVALID'});
  await expect(outcome(f,20,randomUUID(),otherOrg)).rejects.toMatchObject({code:'PRODUCTION_RUN_NOT_FOUND'});
  await recordProductionRunOutcome({organizationId:org,runId:f.run.id,actorUserId:actor,members:[{memberId:f.member.id,successfulQuantity:30,damagedQuantity:10}]});
  await expect(outcome(f,40)).rejects.toMatchObject({code:'PRODUCTION_RUN_OUTCOME_CONFIRMED'});expect(await savedMember(f)).toMatchObject({successfulQuantity:30,damagedQuantity:10});
});


test('canonical Prepress Send to Print still hands off ownership, final-file identity and history',async()=>{
  const f=await fixture(false,'prepress');
  await db.delete(productionRunMembers).where(eq(productionRunMembers.id,f.member.id));await db.delete(productionRuns).where(eq(productionRuns.id,f.run.id));
  await db.update(orderLineItems).set({workflowState:'in_prepress',requiresPrepress:true}).where(eq(orderLineItems.id,f.line.id));
  const [session]=await db.insert(prepressSessions).values({organizationId:org,orderId:f.order.id,lineItemId:f.line.id,status:'complete',startedByUserId:actor,lockOwnerUserId:actor,completedByUserId:actor,completedAt:new Date()}).returning();
  const [file]=await db.insert(lineItemFiles).values({organizationId:org,orderId:f.order.id,lineItemId:f.line.id,prepressSessionId:session.id,role:'final',status:'active',storagePath:'synthetic/never-read.pdf',originalFilename:'synthetic-final.pdf',mimeType:'application/pdf',sizeBytes:1,createdByUserId:actor}).returning();
  const result=await request(app).post(`/api/prepress/line-item/${f.line.id}/send-to-print`).send({});
  expect(result.body.error??result.status).toBe(200);
  const jobs=await db.select().from(productionJobs).where(eq(productionJobs.lineItemId,f.line.id));
  expect(jobs.find(job=>job.id===f.job.id)?.status).toBe('done');
  expect(jobs.filter(job=>!['done','void','canceled','cancelled'].includes(job.status))).toEqual([expect.objectContaining({id:result.body.productionJobId,stationKey:'roll',status:'queued'})]);
  expect((await db.select().from(lineItemFiles).where(eq(lineItemFiles.id,file.id)))[0]).toMatchObject({lineItemId:f.line.id,prepressSessionId:session.id,status:'active'});
  expect((await db.select().from(orderLineItems).where(eq(orderLineItems.id,f.line.id)))[0].workflowState).toBe('ready_for_production');
});
test('legacy confirmed completion cannot regress when successfulQuantity was not initialized',async()=>{
  const f=await fixture();await db.update(productionRunMembers).set({completedQuantity:50,successfulQuantity:0,remainingQuantity:50}).where(eq(productionRunMembers.id,f.member.id));
  await expect(outcome(f,20)).rejects.toMatchObject({code:'PRODUCTION_RUN_OUTCOME_CONFIRMED'});expect((await savedMember(f)).completedQuantity).toBe(50);
});
test('concurrent increasing outcomes remain valid and preserve the highest confirmed quantity',async()=>{
  const f=await fixture();const results=await concurrent(f,()=>outcome(f,20),()=>outcome(f,50));
  expect(results.every(result=>result.status==='fulfilled')).toBe(true);expect(await savedMember(f)).toMatchObject({completedQuantity:50,successfulQuantity:50,remainingQuantity:50});expect(await events(f)).toHaveLength(2);
});
test('completed physical sibling permits normal handoff while active sibling remains protected',async()=>{
  const completed=await fixture(true);await db.update(orderLineItems).set({workflowState:'completed',status:'complete'}).where(eq(orderLineItems.id,completed.siblingId!));
  await outcome(completed,100);expect((await db.select().from(orders).where(eq(orders.id,completed.order.id)))[0].status).toBe('ready_for_shipment');
  const active=await fixture(true);await db.insert(productionJobs).values({organizationId:org,orderId:active.order.id,lineItemId:active.siblingId!,stationKey:'roll',stepKey:'queued',status:'queued'});
  await outcome(active,100);expect((await db.select().from(orders).where(eq(orders.id,active.order.id)))[0].status).toBe('in_production');
});
test('Complete as Planned retries preserve the same single canonical Fulfillment handoff',async()=>{
  const f=await fixture();await transitionProductionRun({organizationId:org,actorUserId:actor,runId:f.run.id,action:'complete'});
  await transitionProductionRun({organizationId:org,actorUserId:actor,runId:f.run.id,action:'complete'});
  expect(await savedMember(f)).toMatchObject({completedQuantity:100,outcomeStatus:'completed'});expect(await events(f)).toHaveLength(1);
  expect(await db.select().from(productionJobs).where(and(eq(productionJobs.lineItemId,f.line.id),eq(productionJobs.stationKey,'fulfillment')))).toHaveLength(1);
});


test('legacy Prepress step ownership and Proofing cannot bypass canonical handoff through generic completion',async()=>{
  for(const station of ['roll','proofing']){
    const f=await fixture(false,station);if(station==='roll')await db.update(productionJobs).set({stepKey:'prepress'}).where(eq(productionJobs.id,f.job.id));
    await expect(db.transaction(tx=>completeProductionJobWorkflow(tx,{organizationId:org,userId:actor,jobId:f.job.id,skipProduction:true}))).rejects.toMatchObject({code:'PRODUCTION_MANAGED_COMPLETION_REQUIRED'});
    expect((await db.select().from(productionJobs).where(eq(productionJobs.id,f.job.id)))[0]).toMatchObject({status:'in_progress',completedAt:null});
  }
});
test('generic completion cannot act on another tenant job or change its history',async()=>{
  const f=await fixture();await expect(db.transaction(tx=>completeProductionJobWorkflow(tx,{organizationId:otherOrg,userId:actor,jobId:f.job.id,skipProduction:true}))).rejects.toMatchObject({statusCode:404});
  expect((await db.select().from(productionJobs).where(eq(productionJobs.id,f.job.id)))[0].status).toBe('in_progress');expect(await events(f)).toHaveLength(0);
});
