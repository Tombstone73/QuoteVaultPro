import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import type { Pool, PoolClient } from "pg";
import { productionRecoveryFixture } from "./productionRecoveryFixture.js";
import { PostgresProductionRecovery } from "../../infrastructure/production/postgresProductionRecovery.js";
import { PostgresProductionRunTransaction } from "../../infrastructure/production/postgresProductionRunTransaction.js";
import { PostgresOperationRequestRepository } from "../../infrastructure/persistence/postgresOperationRequests.js";
import { productionIntentFingerprint } from "../../src/modules/production/productionRecovery.js";
import { brandedId } from "../../src/modules/shared/commercialValues.js";
import express from "express";
import requestHttp from "supertest";
import { createProductionRouter, type ProductionHttpDependencies } from "../../src/interfaces/http/productionRoutes.js";
import { ProductionRecoveryService } from "../../src/modules/production/productionRecovery.js";
import { ProductionRunApplicationService } from "../../src/modules/production/productionRunApplication.js";
import { PostgresProductionRunTransactionRunner } from "../../infrastructure/production/postgresProductionRunTransaction.js";
import type { Capability } from "../../src/authorization/capabilities.js";
import { composeAuthenticatedProductionRuntime } from "../../infrastructure/production/authenticatedProductionRuntime.js";

const db=new PGlite();
const client={query:async(sql:string,values?:unknown[])=>{if(values===undefined){const results=await db.exec(sql);const r=results.at(-1)??{rows:[],affectedRows:0};return {...r,rowCount:r.affectedRows??r.rows.length};}const r=await db.query(sql,values);return {...r,rowCount:r.affectedRows??r.rows.length};},release(){}} as unknown as PoolClient;
const pool={connect:async()=>client} as unknown as Pool;
const actor={organizationId:"org-a",principalKind:"staff" as const,principalSubject:"actor-a",staffActorUserId:"actor-a"};
const op="production.run.output.v1" as const;
const org=brandedId<"OrganizationId">("org-a"),runId=brandedId<"ProductionRunId">("run-a");
let cases=0;
try{
  const invariant=await readFile(new URL("./productionExclusiveMembership.request.sql",import.meta.url),"utf8");
  await productionRecoveryFixture(client,invariant);
  const calls:string[]=[];let reservedRows:number|undefined;
  const observedClient={query:async(sql:string,values?:unknown[])=>{if(sql==="BEGIN"||sql==="COMMIT"||sql==="ROLLBACK")calls.push(sql);return client.query(sql,values);},release(){}} as unknown as PoolClient;
  const runner=new PostgresProductionRunTransactionRunner({connect:async()=>observedClient} as unknown as Pool);
  const duplicateService=new ProductionRunApplicationService({transaction:work=>runner.transaction(async owner=>{
    // Observe calls while forwarding validation and reservation to the actual owner.
    const observedOwner=new Proxy(owner,{get(target,key){const value=Reflect.get(target,key);if(key==="reserve"||key==="lockCandidates"||key==="create"||key==="succeed")return (...args:unknown[])=>{calls.push(key);return Reflect.apply(value,target,args);};return value;}});
    try{return await work(observedOwner);}catch(error){calls.push("rejection");reservedRows=(await client.query("SELECT count(*)::integer n FROM v2_operation_requests")).rows[0].n;throw error;}
  })});
  const businessRequestId=randomUUID();
  const duplicateResult=await duplicateService.create({organizationId:org,operationId:randomUUID(),businessRequest:{id:businessRequestId,payloadFingerprint:"pglite-duplicate-input"},principal:{kind:"staff",organizationId:org,userId:"actor-a",authority:{membershipId:"fixture-member",capabilities:["production.run.create"]}}},{businessRequestId,stationKey:"roll",members:[{productionWorkId:brandedId<"ProductionWorkId">("work-a"),quantity:5},{productionWorkId:brandedId<"ProductionWorkId">("work-a"),quantity:5}]});
  assert.equal(duplicateResult.ok,false);if(duplicateResult.ok)throw Error("Duplicate Work input unexpectedly created a Run.");
  assert.equal(duplicateResult.error.code,"VALIDATION_ERROR");assert.equal(duplicateResult.error.publicMessage,"A Production work item cannot be selected twice.");
  assert.deepEqual(calls,["BEGIN","reserve","rejection","ROLLBACK"]);assert.equal(reservedRows,1);
  const retainedCounts=(await client.query(`SELECT
    (SELECT count(*)::integer FROM v2_production_runs) runs,
    (SELECT count(*)::integer FROM v2_production_run_allocations) allocations,
    (SELECT count(*)::integer FROM v2_production_run_allocations WHERE membership_active) "activeMemberships",
    (SELECT count(*)::integer FROM v2_operation_requests) "operationReceipts",
    (SELECT count(*)::integer FROM v2_production_run_events WHERE event_kind IN ('good_output','waste_output')) "outputEvents",
    (SELECT count(*)::integer FROM v2_production_rework_cycles) "reworkCycles"`)).rows[0];
  assert.deepEqual(retainedCounts,{runs:0,allocations:0,activeMemberships:0,operationReceipts:0,outputEvents:0,reworkCycles:0});cases++;
  console.log(JSON.stringify({case:"duplicate Work input rejects before creation",engine:"PGlite",errorCode:duplicateResult.error.code,callOrder:calls,operationReceiptsBeforeRollback:reservedRows,retainedCounts,nativeExecuted:false}));
  if(!process.argv.includes("--duplicate-work-only")){
   // Separate inert database: actual canonical composition, principal issuer, HTTP and M0 owner.
   const creationDb=new PGlite();
   try{
    const transactions:string[]=[];let failReceipt=false,observedEffectsBeforeFailure=false,authenticated=true;
    const query=async(sql:string,values?:unknown[])=>{
     if(["BEGIN","COMMIT","ROLLBACK"].includes(sql))transactions.push(sql);
     if(failReceipt&&sql.includes("SET status = 'succeeded'")){
      const effects=await creationDb.query<{n:number}>("SELECT count(*)::integer n FROM v2_production_run_allocations WHERE membership_active");
      observedEffectsBeforeFailure=effects.rows[0]?.n===2;
      throw Error("Inert receipt persistence failure");
     }
     if(values===undefined){const results=await creationDb.exec(sql);const r=results.at(-1)??{rows:[],affectedRows:0};return {...r,rowCount:r.affectedRows??r.rows.length};}
     const r=await creationDb.query(sql,values);return {...r,rowCount:r.affectedRows??r.rows.length};
    };
    const creationClient={query,release:()=>transactions.push("release")} as unknown as PoolClient;
    const creationPool={query,connect:async()=>creationClient} as unknown as Pool;
    await productionRecoveryFixture(creationClient,invariant);
    // Declared authority read fixtures, not replacement authorization logic.
    await query(`ALTER TABLE organizations ADD COLUMN status varchar DEFAULT 'active', ADD COLUMN delete_state varchar DEFAULT 'active', ADD COLUMN is_archived boolean DEFAULT false;
     ALTER TABLE users ADD COLUMN is_platform_developer boolean DEFAULT false;
     CREATE TABLE user_organizations(user_id varchar,organization_id varchar,is_active boolean,role varchar);
     CREATE TABLE v2_permission_organization_state(organization_id varchar,authority_revision integer);
     CREATE TABLE v2_permission_sets(id varchar,organization_id varchar,name varchar,active boolean,revision integer,principal_kind varchar);
     CREATE TABLE v2_staff_permission_set_assignments(user_id varchar,organization_id varchar,permission_set_id varchar,active boolean);
     CREATE TABLE v2_permission_capabilities(id varchar,active boolean);
     CREATE TABLE v2_permission_set_capabilities(permission_set_id varchar,organization_id varchar,capability_id varchar);
     INSERT INTO user_organizations VALUES('actor-a','org-a',true,'employee');
     INSERT INTO v2_permission_organization_state VALUES('org-a',1),('org-b',1);
     INSERT INTO v2_permission_sets VALUES('run-create','org-a','Run create',true,1,'staff');
     INSERT INTO v2_staff_permission_set_assignments VALUES('actor-a','org-a','run-create',true);
     INSERT INTO v2_permission_capabilities VALUES('production.run.create',true),('production.view',true);
     INSERT INTO v2_permission_set_capabilities VALUES('run-create','org-a','production.run.create'),('run-create','org-a','production.view');`);
    const runtime=composeAuthenticatedProductionRuntime({pool:creationPool,trustedHostIdentity:{authenticatedIdentity:async()=>authenticated?{subjectId:"actor-a",authenticatedAt:new Date(),authenticationMethod:"session"}:null},trustedHostMiddleware:(_q,_r,next)=>next()});
    const createApp=express();createApp.use(express.json());createApp.use("/v2/organizations/:organizationId/production",runtime.trustedHostMiddleware,createProductionRouter(runtime.dependencies));
    const createPath="/v2/organizations/org-a/production/runs";
    const command={businessRequestId:"canonical-create",stationKey:"roll",members:[{productionWorkId:"work-a",quantity:10},{productionWorkId:"work-b",quantity:10}]};
    const creationCounts=async()=>(await query(`SELECT
     (SELECT count(*)::integer FROM v2_production_runs) runs,
     (SELECT count(*)::integer FROM v2_production_run_allocations) allocations,
     (SELECT count(*)::integer FROM v2_production_run_allocations WHERE membership_active) memberships,
     (SELECT count(*)::integer FROM v2_production_run_events) events,
     (SELECT count(*)::integer FROM v2_operation_requests) receipts`)).rows[0];
    const empty={runs:0,allocations:0,memberships:0,events:0,receipts:0};
    for(const approved of [undefined,false] as const){
     const disabled=approved===undefined?new PostgresProductionRunTransactionRunner(creationPool):new PostgresProductionRunTransactionRunner(creationPool,approved);
     const disabledApp=express();disabledApp.use(express.json());disabledApp.use("/v2/organizations/:organizationId/production",createProductionRouter({...runtime.dependencies,runs:new ProductionRunApplicationService(disabled)}));
     transactions.length=0;
     const denied=await requestHttp(disabledApp).post(createPath).send({...command,exclusiveCreationApproved:true});
     assert.equal(denied.status,409);assert.match(denied.body.error.message,/disabled/);
     assert.deepEqual(transactions,["BEGIN","ROLLBACK","release"]);assert.deepEqual(await creationCounts(),empty);cases++;
    }
    transactions.length=0;
    await assert.rejects(()=>new PostgresProductionRunTransactionRunner(creationPool,true).transaction(async owner=>{
     const members=await owner.lockCandidates(org,[brandedId<"ProductionWorkId">("work-a")]);
     const created=await owner.create({id:brandedId<"ProductionRunId">("runner-true"),organizationId:org,stationKey:"roll",materialFingerprint:null,layoutMetadata:{},members,quantities:new Map([["work-a",10]]),principalKind:"staff",principalSubject:"actor-a",staffActorUserId:"actor-a"});
     assert.equal(created.allocations.length,1);throw Error("Inert runner rollback");
    }),/Inert runner rollback/);
    assert.deepEqual(transactions,["BEGIN","ROLLBACK","release"]);assert.deepEqual(await creationCounts(),empty);cases++;
    authenticated=false;transactions.length=0;
    assert.equal((await requestHttp(createApp).post(createPath).send(command)).status,403);
    assert.deepEqual(transactions,[]);authenticated=true;cases++;
    const indexDefinition=(await query("SELECT pg_get_indexdef('v2_production_run_allocations_exclusive_active_uidx'::regclass) definition")).rows[0].definition;
    await query("DROP INDEX v2_production_run_allocations_exclusive_active_uidx");transactions.length=0;
    const missingIndex=await requestHttp(createApp).post(createPath).send(command);
    assert.equal(missingIndex.status,409);assert.match(missingIndex.body.error.message,/invariant is unavailable/);
    assert.deepEqual(transactions,["BEGIN","ROLLBACK","release"]);assert.deepEqual(await creationCounts(),empty);
    await query(indexDefinition);cases++;
    for(const [table,trigger] of [["v2_production_run_allocations","v2_production_run_membership_bind_trigger"],["v2_production_run_allocations","v2_production_run_membership_gate_allocations"],["v2_production_runs","v2_production_run_membership_state_trigger"],["v2_production_runs","v2_production_run_membership_gate_runs"]]){
     await query(`ALTER TABLE ${table} DISABLE TRIGGER ${trigger}`);transactions.length=0;
     const missingTrigger=await requestHttp(createApp).post(createPath).send(command);
     assert.equal(missingTrigger.status,409);assert.match(missingTrigger.body.error.message,/invariant triggers are unavailable/);
     assert.deepEqual(transactions,["BEGIN","ROLLBACK","release"]);assert.deepEqual(await creationCounts(),empty);
     await query(`ALTER TABLE ${table} ENABLE TRIGGER ${trigger}`);cases++;
    }
    failReceipt=true;transactions.length=0;
    const rolledBack=await requestHttp(createApp).post(createPath).send(command);
    assert.equal(rolledBack.status,400);assert.match(rolledBack.body.error.message,/Inert receipt persistence failure/);
    assert.equal(observedEffectsBeforeFailure,true);assert.deepEqual(transactions,["BEGIN","ROLLBACK","release"]);
    assert.deepEqual(await creationCounts(),empty);failReceipt=false;cases++;
    transactions.length=0;
    const created=await requestHttp(createApp).post(createPath).send(command);
    assert.equal(created.status,200,JSON.stringify(created.body));assert.equal(created.body.data.allocations.length,2);
    assert.deepEqual(transactions,["BEGIN","COMMIT","release"]);
    const committedCounts=await creationCounts();assert.deepEqual(committedCounts,{runs:1,allocations:2,memberships:2,events:3,receipts:1});
    const receipt=(await query("SELECT status,result_json,result_resource_id FROM v2_operation_requests WHERE business_request_id=$1",[command.businessRequestId])).rows[0];
    assert.equal(receipt.status,"succeeded");assert.equal(receipt.result_resource_id,created.body.data.productionRunId);assert.deepEqual(receipt.result_json,created.body.data);cases++;
    transactions.length=0;
    assert.deepEqual((await requestHttp(createApp).post(createPath).send(command)).body,created.body);
    assert.deepEqual(transactions,["BEGIN","COMMIT","release"]);assert.deepEqual(await creationCounts(),committedCounts);cases++;
    assert.equal((await requestHttp(createApp).post(createPath).send({...command,layoutMetadata:{changed:true}})).status,409);
    assert.deepEqual(await creationCounts(),committedCounts);cases++;
    assert.equal((await requestHttp(createApp).get(`${createPath}/${created.body.data.productionRunId}`)).body.data.productionRunId,created.body.data.productionRunId);
    assert.equal((await requestHttp(createApp).get(createPath).query({station:"roll"})).body.data[0].productionRunId,created.body.data.productionRunId);cases++;
    await query("UPDATE v2_permission_capabilities SET active=false WHERE id='production.run.create'");transactions.length=0;
    assert.equal((await requestHttp(createApp).post(createPath).send(command)).status,403,"replay must re-resolve current authority");
    assert.equal((await requestHttp(createApp).post(createPath).send({...command,businessRequestId:"denied-new"})).status,403);
    assert.deepEqual(transactions,[]);assert.deepEqual(await creationCounts(),committedCounts);cases++;
    await query("UPDATE v2_permission_capabilities SET active=true WHERE id='production.run.create'");
    assert.equal((await requestHttp(createApp).post(createPath).send(command)).status,200);cases++;
    transactions.length=0;
    assert.equal((await requestHttp(createApp).post(createPath.replace("org-a","org-b")).send(command)).status,404);
    assert.deepEqual(transactions,[]);assert.deepEqual(await creationCounts(),committedCounts);cases++;
    // Even an authorized other-tenant principal cannot select or discover org-a's work/Run.
    await query(`INSERT INTO user_organizations VALUES('actor-a','org-b',true,'employee');
     INSERT INTO v2_permission_sets VALUES('run-create-b','org-b','Run create',true,1,'staff');
     INSERT INTO v2_staff_permission_set_assignments VALUES('actor-a','org-b','run-create-b',true);
     INSERT INTO v2_permission_set_capabilities VALUES('run-create-b','org-b','production.run.create'),('run-create-b','org-b','production.view');`);
    assert.equal((await requestHttp(createApp).post(createPath.replace("org-a","org-b")).send(command)).status,404);
    assert.equal((await requestHttp(createApp).get(`${createPath.replace("org-a","org-b")}/${created.body.data.productionRunId}`)).status,404);
    assert.deepEqual(await creationCounts(),committedCounts);cases++;
   }finally{await creationDb.close();}
   const tx=new PostgresProductionRunTransaction(client,true);
  await client.query("BEGIN");
  const candidates=await tx.lockCandidates(org,[brandedId<"ProductionWorkId">("work-a")]);
  const input={id:runId,organizationId:org,stationKey:"roll" as const,materialFingerprint:null,layoutMetadata:{},members:candidates,quantities:new Map([["work-a",10]]),principalKind:"staff" as const,principalSubject:"actor-a",staffActorUserId:"actor-a"};
  const run=await tx.create(input);await client.query("COMMIT");cases++;
  assert.equal(run.allocations.length,1);
  await client.query("BEGIN");assert.deepEqual(await tx.create(input),run);await client.query("COMMIT");cases++;
  await client.query("BEGIN");await assert.rejects(()=>tx.create({...input,id:brandedId<"ProductionRunId">("run-conflict")}),/already belongs/);await client.query("ROLLBACK");cases++;
  await client.query("BEGIN");await assert.rejects(()=>tx.create({...input,members:[...candidates,...candidates]}),/unique/);await client.query("ROLLBACK");cases++;
  await client.query("BEGIN");await assert.rejects(()=>new PostgresProductionRunTransaction(client).create(input),/disabled/);await client.query("ROLLBACK");cases++;
  await client.query("BEGIN");await client.query("DROP TRIGGER v2_production_run_membership_bind_trigger ON v2_production_run_allocations");await assert.rejects(()=>tx.create(input),/invariant triggers are unavailable/);await client.query("ROLLBACK");cases++;
  await client.query("INSERT INTO v2_production_attempts(id,organization_id,production_work_id,sequence,attempt_kind,station_key) VALUES('attempt-a','org-a','work-a',1,'initial','roll')");
  await client.query("UPDATE v2_production_run_allocations SET production_attempt_id='attempt-a' WHERE production_run_id='run-a'");
  await client.query("UPDATE v2_production_runs SET state='active' WHERE id='run-a'");
  const allocationId=run.allocations[0]!.productionRunAllocationId;
  const intent={businessRequestId:"output-a",productionRunId:"run-a",productionRunAllocationId:allocationId,goodQuantityDelta:3,wasteQuantityDelta:1};
  const recovery=new PostgresProductionRecovery(pool);
  const prepared=await recovery.prepare(actor,op,intent);assert.equal(prepared.status,"pending");cases++;
  assert.deepEqual((await recovery.discover(actor,op))[0]?.intent,intent);cases++;
  const protectedPending=(await recovery.discover({...actor,principalSubject:"actor-b",staffActorUserId:"actor-b"},op))[0]!;
  assert.equal(protectedPending.intent,null);assert.equal(protectedPending.intentRedacted,true);assert.equal(protectedPending.status,"pending","key remains global, but another actor cannot enumerate the private body");cases++;
  assert.deepEqual(await recovery.discover({...actor,organizationId:"org-b"},op),[]);cases++;
  await assert.rejects(()=>recovery.prepare(actor,op,{...intent,goodQuantityDelta:4}),/different payload/);cases++;
  assert.equal((await recovery.prepare({...actor,principalSubject:"actor-b",staffActorUserId:"actor-b"},op,intent)).status,"pending");cases++;
  await assert.rejects(()=>recovery.prepare(actor,op,{...intent,businessRequestId:"blind-new"}),/unresolved output intent/);cases++;
  const requests=new PostgresOperationRequestRepository();
  await client.query("BEGIN");
  const request=await tx.reserve({...actor,principalKind:"staff",operation:op,businessRequestId:intent.businessRequestId,payloadFingerprint:productionIntentFingerprint(intent)});
  const result=await tx.output({organizationId:org,productionRunId:runId,productionRunAllocationId:allocationId,goodQuantityDelta:3,wasteQuantityDelta:1,principalKind:"staff",principalSubject:"actor-a",staffActorUserId:"actor-a"});
  await tx.succeed(org,request.requestId,result);
  await client.query("COMMIT");
  const recovered=(await recovery.discover(actor,op))[0]!;
  assert.equal(recovered.status,"succeeded");assert.deepEqual(recovered.result,JSON.parse(JSON.stringify(result)));cases++;
  assert.equal((await recovery.prepare(actor,op,intent)).status,"succeeded");
  assert.equal((await client.query("SELECT good_quantity,waste_quantity FROM v2_production_attempts WHERE id='attempt-a'")).rows[0].good_quantity,3);cases++;
  assert.equal((await client.query("SELECT count(*)::integer n FROM v2_production_run_events WHERE event_kind='good_output'")).rows[0].n,1);cases++;
  await recovery.prepare(actor,op,{...intent,businessRequestId:"rollback-output"});
  await client.query("BEGIN");await tx.output({organizationId:org,productionRunId:runId,productionRunAllocationId:allocationId,goodQuantityDelta:2,wasteQuantityDelta:0,principalKind:"staff",principalSubject:"actor-a"});await client.query("ROLLBACK");
  assert.equal((await recovery.discover(actor,op,"rollback-output"))[0]?.status,"pending");
  assert.equal((await client.query("SELECT good_quantity FROM v2_production_attempts WHERE id='attempt-a'")).rows[0].good_quantity,3);cases++;
  const rejectedIntent={...intent,businessRequestId:"rollback-output"};
  await recovery.reject(actor,op,rejectedIntent,{code:"CONFLICT",message:"Exact output was rejected without effects."});
  assert.equal((await recovery.discover(actor,op,"rollback-output"))[0]?.status,"rejected");cases++;
  await client.query("UPDATE v2_operation_requests SET payload_fingerprint='sha256:unrelated-intent' WHERE organization_id='org-a' AND operation=$1 AND business_request_id='rollback-output'",[`${op}.rejected`]);
  await assert.rejects(()=>recovery.discover(actor,op,"rollback-output"),/does not bind the original output intent/);cases++;
  await client.query("UPDATE v2_operation_requests SET payload_fingerprint=$2 WHERE organization_id='org-a' AND operation=$1 AND business_request_id='rollback-output'",[`${op}.rejected`,productionIntentFingerprint(rejectedIntent)]);
  await client.query("UPDATE v2_operation_requests SET result_resource_id='unrelated-request' WHERE organization_id='org-a' AND operation=$1 AND business_request_id='rollback-output'",[`${op}.rejected`]);
  await assert.rejects(()=>recovery.discover(actor,op,"rollback-output"),/does not bind the original output intent/);cases++;
  await client.query("UPDATE v2_operation_requests SET result_resource_id='rollback-output',result_json=NULL WHERE organization_id='org-a' AND operation=$1 AND business_request_id='rollback-output'",[`${op}.rejected`]);
  await assert.rejects(()=>recovery.discover(actor,op,"rollback-output"),/unknown outcome must remain blocked/);cases++;
  await client.query("UPDATE v2_operation_requests SET result_json=$2::jsonb WHERE organization_id='org-a' AND operation=$1 AND business_request_id='rollback-output'",[`${op}.rejected`,JSON.stringify({code:"CONFLICT",message:"Exact output was rejected without effects."})]);
  await client.query("BEGIN");await assert.rejects(()=>tx.reserve({...actor,principalKind:"staff",operation:op,businessRequestId:"rollback-output",payloadFingerprint:productionIntentFingerprint(rejectedIntent)}),/definitively rejected/);await client.query("ROLLBACK");cases++;
  assert.equal((await recovery.prepare(actor,op,{...intent,businessRequestId:"changed-after-rejection",goodQuantityDelta:1})).status,"pending");cases++;
  await recovery.reject(actor,op,intent,{code:"CONFLICT",message:"A late failure cannot override committed output."});
  assert.equal((await recovery.discover(actor,op,"output-a"))[0]?.status,"succeeded");cases++;
  await client.query("BEGIN");const historical=await requests.reserve(client,{...actor,principalKind:"staff",operation:op,businessRequestId:"historical-output",payloadFingerprint:"sha256:historical-not-reconstructable"});await requests.succeed(client,org,historical.request.id,{resourceType:"production_run",resourceId:runId,resultJson:result});await client.query("COMMIT");
  const [historicalReceipt]=await recovery.discover(actor,op,"historical-output");
  assert.equal(historicalReceipt?.status,"succeeded");assert.equal(historicalReceipt?.historicalIntentUnavailable,true);assert.equal(historicalReceipt?.intent,null);assert.deepEqual(historicalReceipt?.result,JSON.parse(JSON.stringify(result)));cases++;
  assert.deepEqual((await recovery.discover({...actor,principalSubject:"actor-b",staffActorUserId:"actor-b"},op,"historical-output"))[0]?.result,historicalReceipt?.result);cases++;
  // Exercise the authenticated route/application/actual transaction seam, not a fake output service.
  await recovery.reject(actor,op,{...intent,businessRequestId:"changed-after-rejection",goodQuantityDelta:1},{code:"CONFLICT",message:"Fixture clears its pending intent with a definitive no-effect receipt."});
  let httpActor="actor-a",capabilities:readonly Capability[]=["production.view","production.run.execute"];
  const dependencies={recovery:new ProductionRecoveryService(recovery),runs:new ProductionRunApplicationService(new PostgresProductionRunTransactionRunner(pool)),principals:{principal:async()=>({kind:"staff",organizationId:org,userId:httpActor,authority:{membershipId:"fixture-member",capabilities}})}} as unknown as ProductionHttpDependencies;
  const app=express();app.use(express.json());app.use("/v2/organizations/:organizationId/production",createProductionRouter(dependencies));
  const base="/v2/organizations/org-a/production",effectPath=`${base}/runs/run-a/allocations/${allocationId}/output`;
  const httpIntent={...intent,businessRequestId:"http-output",goodQuantityDelta:1,wasteQuantityDelta:0};
  const legacyCommitted=await requestHttp(app).post(effectPath).send(httpIntent);assert.equal(legacyCommitted.status,200,"existing output endpoint retains its M0 command contract while recording intent with owner effects");assert.equal((await recovery.discover(actor,op,"http-output"))[0]?.status,"succeeded");cases++;
  assert.equal((await requestHttp(app).post(`${base}/output-intents/${op}`).send(httpIntent)).status,200);cases++;
  const committed=await requestHttp(app).post(effectPath).send(httpIntent);assert.equal(committed.status,200);assert.equal(committed.body.data.allocations[0].goodQuantity,4);cases++;
  const replay=await requestHttp(app).post(effectPath).send(httpIntent);assert.deepEqual(replay.body.data,committed.body.data);
  assert.equal((await client.query("SELECT good_quantity FROM v2_production_attempts WHERE id='attempt-a'")).rows[0].good_quantity,4);cases++;
  const discovered=await requestHttp(app).get(`${base}/output-recovery`).query({operation:op,businessRequestId:"http-output"});assert.equal(discovered.status,200);assert.equal(discovered.body.data[0].status,"succeeded");assert.match(discovered.headers["cache-control"],/no-store/);cases++;
  await client.query("UPDATE v2_operation_requests SET result_json=jsonb_set(result_json,'{organizationId}',$3::jsonb) WHERE organization_id='org-a' AND operation=$1 AND business_request_id=$2",[op,"http-output",JSON.stringify("org-b")]);
  await assert.rejects(()=>recovery.discover(actor,op,"http-output"),/resource binding is invalid/);cases++;
  await client.query("UPDATE v2_operation_requests SET result_json=$3::jsonb WHERE organization_id='org-a' AND operation=$1 AND business_request_id=$2",[op,"http-output",JSON.stringify(committed.body.data)]);
  await client.query("UPDATE v2_operation_requests SET result_json=NULL WHERE organization_id='org-a' AND operation=$1 AND business_request_id=$2",[op,"http-output"]);
  await assert.rejects(()=>recovery.discover(actor,op,"http-output"),/must not be treated as non-commit/);cases++;
  await client.query("UPDATE v2_operation_requests SET result_json=$3::jsonb WHERE organization_id='org-a' AND operation=$1 AND business_request_id=$2",[op,"http-output",JSON.stringify(committed.body.data)]);
  httpActor="actor-b";assert.equal((await requestHttp(app).get(`${base}/output-recovery`).query({operation:op,businessRequestId:"http-output"})).body.data[0]?.status,"succeeded");
  assert.deepEqual((await requestHttp(app).post(effectPath).send(httpIntent)).body.data,committed.body.data);
  assert.equal((await client.query("SELECT count(*)::integer n FROM v2_operation_requests WHERE organization_id='org-a' AND operation=$1 AND business_request_id='http-output'",[op])).rows[0].n,1,"current actor cannot partition the M0 identity or create another owner effect");cases++;
  assert.equal((await requestHttp(app).post(effectPath).send({...httpIntent,goodQuantityDelta:2})).status,409,"changed actor does not permit changed payload under the same identity");cases++;
  httpActor="actor-a";capabilities=["production.view"];assert.equal((await requestHttp(app).get(`${base}/output-recovery`).query({operation:op})).status,403);cases++;
  capabilities=["production.view","production.run.execute"];await client.query("UPDATE v2_production_runs SET state='held' WHERE id='run-a'");
  const heldIntent={...httpIntent,businessRequestId:"held-http-output"};assert.equal((await requestHttp(app).post(`${base}/output-intents/${op}`).send(heldIntent)).status,200);
  assert.equal((await requestHttp(app).post(effectPath).send(heldIntent)).status,400);
  assert.equal((await recovery.discover(actor,op,"held-http-output"))[0]?.status,"rejected");
  await client.query("UPDATE v2_production_runs SET state='active' WHERE id='run-a'");assert.equal((await requestHttp(app).post(effectPath).send(heldIntent)).status,409);
  assert.equal((await client.query("SELECT good_quantity FROM v2_production_attempts WHERE id='attempt-a'")).rows[0].good_quantity,4);cases++;
  httpActor="actor-b";capabilities=["production.run.execute"];
  const executeOnly=await requestHttp(app).post(effectPath).send({...httpIntent,businessRequestId:"execute-only-existing-run"});assert.equal(executeOnly.status,200,"unrelated existing Run output does not acquire a new production.view or browser-prepare requirement");
  assert.equal((await client.query("SELECT good_quantity FROM v2_production_attempts WHERE id='attempt-a'")).rows[0].good_quantity,5);
  assert.equal((await requestHttp(app).get(`${base}/output-recovery`).query({operation:op})).status,403,"receipt discovery still needs fresh read and operation authority");cases++;
  const legacyHeldIntent={...httpIntent,businessRequestId:"legacy-held-retry"};
  await client.query("UPDATE v2_production_runs SET state='held' WHERE id='run-a'");assert.equal((await requestHttp(app).post(effectPath).send(legacyHeldIntent)).status,400);
  assert.deepEqual(await recovery.discover(actor,op,"legacy-held-retry"),[],"rolled-back legacy owner attempt does not fabricate a committed result");
  await client.query("UPDATE v2_production_runs SET state='active' WHERE id='run-a'");assert.equal((await requestHttp(app).post(effectPath).send(legacyHeldIntent)).status,200);
  assert.equal((await client.query("SELECT good_quantity FROM v2_production_attempts WHERE id='attempt-a'")).rows[0].good_quantity,6);cases++;
  await client.query("INSERT INTO v2_production_runs(id,organization_id,station_key,created_principal_kind,created_principal_subject) VALUES('empty-r','org-a','roll','staff','actor-a')");
  const rawInsert="INSERT INTO v2_production_run_allocations(id,organization_id,production_run_id,production_work_id,allocated_quantity,artwork_assignment_id,artwork_file_id,artwork_identity_fingerprint,artwork_object_version,position) VALUES('empty-x','org-a','empty-r','work-b',5,'art-work-b','file-work-b',$1,'version-a',0)";
  await client.query("UPDATE v2_production_runs SET state='cancelled',cancelled_at=now() WHERE id='empty-r'");await client.query(rawInsert,[`sha256:${"a".repeat(64)}`]);assert.equal((await client.query("SELECT membership_active FROM v2_production_run_allocations WHERE id='empty-x'")).rows[0].membership_active,false);cases++;
  await client.query("UPDATE v2_production_runs SET state='ready' WHERE id='empty-r'");assert.equal((await client.query("SELECT membership_active FROM v2_production_run_allocations WHERE id='empty-x'")).rows[0].membership_active,true);cases++;
  await assert.rejects(()=>client.query("UPDATE v2_production_run_allocations SET production_run_id='run-a' WHERE id='empty-x'"),/identity is immutable/);cases++;
  let lifecycleCalls=0;
  const lifecycle={reconcileOrder:async()=>{lifecycleCalls++;if(lifecycleCalls===1)throw Error("Inert post-commit lifecycle failure");},reconcileInvoice:async()=>{throw Error("Invoice reconciliation is outside this Production fixture");}};
  const repairDependencies={...dependencies,runs:new ProductionRunApplicationService(new PostgresProductionRunTransactionRunner(pool),undefined,lifecycle)};
  const repairApp=express();repairApp.use(express.json());repairApp.use("/v2/organizations/:organizationId/production",createProductionRouter(repairDependencies));
  httpActor="actor-a";capabilities=["production.view","production.run.execute"];
  const repairIntent={...httpIntent,businessRequestId:"post-commit-lifecycle-repair"};
  assert.equal((await requestHttp(repairApp).post(`${base}/output-intents/${op}`).send(repairIntent)).status,200);
  assert.equal((await requestHttp(repairApp).post(effectPath).send(repairIntent)).status,500);
  assert.equal((await recovery.discover(actor,op,repairIntent.businessRequestId))[0]?.status,"succeeded","lifecycle failure does not turn a committed physical result into non-commit");
  const beforeRepairEvents=(await client.query("SELECT count(*)::integer n FROM v2_production_run_events WHERE event_kind='good_output'")).rows[0].n;
  assert.equal((await requestHttp(repairApp).post(effectPath).send(repairIntent)).status,200);
  assert.equal(lifecycleCalls,2,"the real existing owner replay path retries reconciliation");
  assert.equal((await client.query("SELECT good_quantity FROM v2_production_attempts WHERE id='attempt-a'")).rows[0].good_quantity,7);
  assert.equal((await client.query("SELECT count(*)::integer n FROM v2_production_run_events WHERE event_kind='good_output'")).rows[0].n,beforeRepairEvents,"replay repairs lifecycle without another physical output event");cases++;
  }
  console.log(`Production recovery actual ledger/Run adapter PGlite: ${cases} cases passed; native contention is NOT proved.`);
}finally{await db.close();}
