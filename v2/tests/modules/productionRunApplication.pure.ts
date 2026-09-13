import assert from "node:assert/strict";
import { ProductionRunApplicationService, type ProductionRunTransaction } from "../../src/modules/production/productionRunApplication.js";
import { brandedId } from "../../src/modules/shared/commercialValues.js";

const org=brandedId<"OrganizationId">("org-a"), work=brandedId<"ProductionWorkId">("work-a");
const principal={kind:"staff" as const,organizationId:org,userId:"operator-a",authority:{membershipId:"membership-a",capabilities:["production.run.create","production.run.execute"] as const}};
const context=(request:string)=>({organizationId:org,principal,businessRequest:{id:request,payloadFingerprint:"route"},operationId:request});
let saved:any;
const requests=new Map<string,any>();
const lifecycleCalls:string[]=[];
const tx:ProductionRunTransaction={
 reserve:async input=>requests.has(input.businessRequestId)?({kind:"replay",requestId:input.businessRequestId,resultJson:requests.get(input.businessRequestId)}):({kind:"new",requestId:input.businessRequestId,resultJson:null}),succeed:async(_o,r,result)=>{saved=result;requests.set(r,result);},
 lockCandidates:async()=>[{productionWorkId:work,stationKey:"flatbed",materialFingerprint:"material:coroplast",orderedQuantity:100,recordedGoodQuantity:0,reservedByOtherRuns:0,artworkAssignmentId:"assignment-a",artworkFileId:"file-a",artworkIdentityFingerprint:`sha256:${"a".repeat(64)}`,artworkObjectVersion:"A"}],
 create:async input=>({productionRunId:input.id,organizationId:input.organizationId,stationKey:input.stationKey,state:"draft" as const,revision:1,materialFingerprint:input.materialFingerprint,layoutMetadata:input.layoutMetadata,allocations:input.members.map((m,i)=>({productionRunAllocationId:`allocation-${i}`,productionWorkId:m.productionWorkId,allocatedQuantity:input.quantities.get(m.productionWorkId)!,goodQuantity:0,wasteQuantity:0,artworkAssignmentId:m.artworkAssignmentId,artworkFileId:m.artworkFileId,artworkIdentityFingerprint:m.artworkIdentityFingerprint,artworkObjectVersion:m.artworkObjectVersion,position:i}))}),
 lockRun:async()=>saved??null,
 list:async()=>saved?[saved]:[],
 orderIds:async()=>[brandedId<"OrderId">("order-a")],
 transition:async input=>({...saved,state:input.state,revision:saved.revision+1}),
 start:async()=>({...saved,state:"active",revision:saved.revision+1}),
 refreshPreparation:async()=>saved,
 release:async input=>({...saved,allocations:saved.allocations.map((allocation:any)=>allocation.productionRunAllocationId===input.productionRunAllocationId?{...allocation,releasedAt:"2026-09-12T00:00:00.000Z"}:allocation)}),
 output:async input=>({...saved,allocations:saved.allocations.map((allocation:any)=>allocation.productionRunAllocationId===input.productionRunAllocationId?{...allocation,goodQuantity:allocation.goodQuantity+input.goodQuantityDelta,wasteQuantity:allocation.wasteQuantity+input.wasteQuantityDelta}:allocation)}),
};
const service=new ProductionRunApplicationService({transaction:async action=>action(tx)},undefined,{reconcileOrder:async(_org,orderId)=>{lifecycleCalls.push(orderId);},reconcileInvoice:async()=>{}});
const created=await service.create(context("create-a") as any,{businessRequestId:"create-a",stationKey:"flatbed",members:[{productionWorkId:work,quantity:60}]});
assert.equal(created.ok,true); if(!created.ok) throw Error(created.error.publicMessage); assert.equal(created.value.allocations[0]!.allocatedQuantity,60);
saved=created.value;
const ready=await service.transition(context("ready-a") as any,{businessRequestId:"ready-a",productionRunId:created.value.productionRunId,transition:"ready"});
assert.equal(ready.ok,true); if(ready.ok) saved=ready.value;
const active=await service.transition(context("active-a") as any,{businessRequestId:"active-a",productionRunId:created.value.productionRunId,transition:"start"});
assert.equal(active.ok,true);
if(active.ok)saved=active.value;
const output=await service.recordOutput(context("output-a") as any,{businessRequestId:"output-a",productionRunId:created.value.productionRunId,productionRunAllocationId:"allocation-0",goodQuantityDelta:10});
assert.equal(output.ok,true); if(output.ok) assert.equal(output.value.allocations[0]!.goodQuantity,10);
const outputReplay=await service.recordOutput(context("output-a") as any,{businessRequestId:"output-a",productionRunId:created.value.productionRunId,productionRunAllocationId:"allocation-0",goodQuantityDelta:10});
assert.equal(outputReplay.ok,true); if(outputReplay.ok) assert.equal(outputReplay.value.allocations[0]!.goodQuantity,10,"an exact retry must not duplicate good output");
assert.ok(lifecycleCalls.length>=1,"run output must invoke the canonical order reconciliation path");
const over=await service.create(context("over") as any,{businessRequestId:"over",stationKey:"flatbed",members:[{productionWorkId:work,quantity:101}]});
assert.equal(over.ok,false);
console.log("Production Run application contracts passed.");
