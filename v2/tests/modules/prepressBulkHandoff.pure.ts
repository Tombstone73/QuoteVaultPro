import assert from "node:assert/strict";
import { PrepressApplicationService, type PrepressTransaction, type PrepressTransactionRunner } from "../../src/modules/prepress/prepressApplication.js";
import { brandedId } from "../../src/modules/shared/commercialValues.js";

const org = "org-a";
const principal = { kind:"staff" as const, organizationId:org, userId:"staff-a", authority:{membershipId:"member-a",capabilities:["prepress.complete","route.advance","production.work"] as const} };
const context = (id:string) => ({ organizationId:org, operationId:"test", principal, businessRequest:{id,payloadFingerprint:"http"} });
const unit = (id:string) => ({ prepressUnitId:brandedId<"PrepressUnitId">(id),organizationId:brandedId<"OrganizationId">(org),orderId:brandedId<"OrderId">(`order-${id}`),orderLineId:brandedId<"OrderLineId">(`line-${id}`),artworkAssignmentId:brandedId<"ArtworkAssignmentId">(`art-${id}`),artworkFileId:brandedId<"ArtworkFileId">(`file-${id}`),createdAt:"2026-09-12T00:00:00.000Z",createdPrincipalKind:"staff" as const,createdPrincipalSubject:"staff-a",startedAt:"2026-09-12T00:00:00.000Z",startedPrincipalKind:"staff" as const,startedPrincipalSubject:"staff-a",completedAt:"2026-09-12T00:00:00.000Z",completedPrincipalKind:"staff" as const,completedPrincipalSubject:"staff-a" });

const calls:{locked:string[];handoff:string[];audit:string[];succeeded:number}={locked:[],handoff:[],audit:[],succeeded:0};
const tx:Partial<PrepressTransaction>={
  reserve:async()=>({kind:"new" as const,request:{id:"request-a",resultJson:null}}),
  lockUnit:async(_org,id)=>{calls.locked.push(id);return unit(id);},
  handoffToProduction:async(input)=>{calls.handoff.push(input.prepressUnitId);return {unit:unit(input.prepressUnitId),destination:"flatbed" as const,productionWorkIds:[brandedId<"ProductionWorkId">(`work-${input.prepressUnitId}`)]};},
  attribute:async()=>undefined,
  audit:async(input)=>{calls.audit.push(input.resourceId);},
  succeed:async()=>{calls.succeeded+=1;},
};
const runner:PrepressTransactionRunner={transaction:async(action)=>action(tx as PrepressTransaction)};
const service=new PrepressApplicationService(runner);
const result=await service.sendManyToProduction(context("bulk-a"),{businessRequestId:"bulk-a",prepressUnitIds:[brandedId<"PrepressUnitId">("unit-a"),brandedId<"PrepressUnitId">("unit-b")]});
assert.equal(result.ok,true);
if(result.ok)assert.deepEqual(result.value.handoffs.map((handoff)=>handoff.unit.prepressUnitId),["unit-a","unit-b"]);
assert.deepEqual(calls.locked,["unit-a","unit-b"],"every selected unit is locked before a route advances");
assert.deepEqual(calls.handoff,["unit-a","unit-b"]);
assert.deepEqual(calls.audit,["unit-a","unit-b"],"each real handoff retains its own audit evidence");
assert.equal(calls.succeeded,1,"one business request records the bounded command result");

const replayValue={handoffs:[{unit:unit("unit-replayed"),destination:"roll" as const,productionWorkIds:[brandedId<"ProductionWorkId">("work-replayed")]}]};
const replayService=new PrepressApplicationService({transaction:async(action)=>action({...tx,reserve:async()=>({kind:"replay" as const,request:{id:"request-replay",resultJson:replayValue}})} as PrepressTransaction)});
const replay=await replayService.sendManyToProduction(context("bulk-replay"),{businessRequestId:"bulk-replay",prepressUnitIds:[brandedId<"PrepressUnitId">("unit-replayed")]});
assert.equal(replay.ok,true);if(replay.ok)assert.deepEqual(replay.value,replayValue,"a duplicate request reuses the recorded bulk outcome");

const overCap=await service.sendManyToProduction(context("bulk-cap"),{businessRequestId:"bulk-cap",prepressUnitIds:Array.from({length:51},(_,index)=>brandedId<"PrepressUnitId">(`unit-${index}`))});
assert.equal(overCap.ok,false);if(!overCap.ok)assert.equal(overCap.error.code,"VALIDATION_ERROR");

let secondHandoff=false;
const failingTx:Partial<PrepressTransaction>={...tx,lockUnit:async(_org,id)=>unit(id),handoffToProduction:async(input)=>{if(secondHandoff)throw new Error("stale selected unit");secondHandoff=true;return {unit:unit(input.prepressUnitId),destination:"flatbed" as const,productionWorkIds:[]};},audit:async()=>assert.fail("a failed all-or-nothing command must not audit a partial handoff"),succeed:async()=>assert.fail("a failed all-or-nothing command must not succeed")};
const failingService=new PrepressApplicationService({transaction:async(action)=>action(failingTx as PrepressTransaction)});
const failed=await failingService.sendManyToProduction(context("bulk-failure"),{businessRequestId:"bulk-failure",prepressUnitIds:[brandedId<"PrepressUnitId">("unit-c"),brandedId<"PrepressUnitId">("unit-d")]});
assert.equal(failed.ok,false);

console.log("Prepress bounded bulk handoff contract passed.");
