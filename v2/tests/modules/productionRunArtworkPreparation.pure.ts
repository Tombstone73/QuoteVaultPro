import assert from "node:assert/strict";
import { ProductionRunApplicationService, type ProductionRun, type ProductionRunTransaction } from "../../src/modules/production/productionRunApplication.js";
import { preparedArtworkIsCurrent } from "../../src/modules/production/productionRuns.js";
import { brandedId } from "../../src/modules/shared/commercialValues.js";

const org=brandedId<"OrganizationId">("org-art"),workA=brandedId<"ProductionWorkId">("work-a"),workB=brandedId<"ProductionWorkId">("work-b");
const principal={kind:"staff" as const,organizationId:org,userId:"operator-a",authority:{membershipId:"membership-a",capabilities:["production.run.create","production.run.execute"] as const}};
const context=(request:string)=>({organizationId:org,principal,businessRequest:{id:request,payloadFingerprint:"route"},operationId:request});
const art=(assignment:string,file:string,version:string)=>({artworkAssignmentId:assignment,artworkFileId:file,artworkIdentityFingerprint:`sha256:${version.repeat(64)}`,artworkObjectVersion:version});
let current={productionWorkId:workA,...art("assignment-a","file-a","a")};
let foreign=false,refreshes=0,saved:ProductionRun|undefined;
const requests=new Map<string,{fingerprint:string;result:ProductionRun|null}>();
const tx:ProductionRunTransaction={
  reserve:async input=>{const prior=requests.get(input.businessRequestId);if(prior){if(prior.fingerprint!==input.payloadFingerprint)throw Error("IDEMPOTENCY_CONFLICT");return {kind:"replay" as const,requestId:input.businessRequestId,resultJson:prior.result};}requests.set(input.businessRequestId,{fingerprint:input.payloadFingerprint,result:null});return {kind:"new" as const,requestId:input.businessRequestId,resultJson:null};},
  succeed:async(_org,id,result)=>{const prior=requests.get(id);if(!prior)throw Error("missing request");prior.result=result;},
  lockCandidates:async()=>[{productionWorkId:workA,stationKey:"flatbed" as const,materialFingerprint:"material:coroplast",orderedQuantity:100,recordedGoodQuantity:0,reservedByOtherRuns:0,...art("assignment-a","file-a","a")}],
  create:async input=>({productionRunId:input.id,organizationId:input.organizationId,stationKey:input.stationKey,state:"draft" as const,revision:1,materialFingerprint:input.materialFingerprint,layoutMetadata:input.layoutMetadata,allocations:input.members.map((member,index)=>({productionRunAllocationId:`allocation-${index}`,productionWorkId:member.productionWorkId,allocatedQuantity:input.quantities.get(member.productionWorkId)!,goodQuantity:0,wasteQuantity:0,...art(member.artworkAssignmentId,member.artworkFileId,member.artworkObjectVersion),artworkIdentityFingerprint:member.artworkIdentityFingerprint,position:index}))}),
  lockRun:async()=>saved??null,
  list:async()=>saved?[saved]:[],
  orderIds:async()=>[],
  transition:async input=>({...saved!,state:input.state,revision:saved!.revision+1}),
  start:async()=>{const prepared=saved!.allocations[0]!;if(foreign||prepared.productionWorkId!==current.productionWorkId||!preparedArtworkIsCurrent({artworkAssignmentId:prepared.artworkAssignmentId,artworkFileId:prepared.artworkFileId,identityFingerprint:prepared.artworkIdentityFingerprint,objectVersion:prepared.artworkObjectVersion},{artworkAssignmentId:current.artworkAssignmentId,artworkFileId:current.artworkFileId,identityFingerprint:current.artworkIdentityFingerprint,objectVersion:current.artworkObjectVersion}))throw Error("STALE_RUN_PREPARATION");return {...saved!,state:"active" as const,revision:saved!.revision+1};},
  refreshPreparation:async()=>{if(!saved||!(saved.state==="draft"||saved.state==="ready"))throw Error("Only a draft or ready Production Run can refresh preparation.");if(foreign)throw Error("Current Production Artwork is not eligible for every Run allocation.");refreshes++;return {...saved,revision:saved.revision+1,allocations:saved.allocations.map(item=>({...item,productionWorkId:current.productionWorkId,...art(current.artworkAssignmentId,current.artworkFileId,current.artworkObjectVersion),artworkIdentityFingerprint:current.artworkIdentityFingerprint}))};},
  release:async()=>saved!,
  output:async()=>saved!,
};
const service=new ProductionRunApplicationService({transaction:async action=>action(tx)});

const created=await service.create(context("create-a") as any,{businessRequestId:"create-a",stationKey:"flatbed",members:[{productionWorkId:workA,quantity:100}]});
assert(created.ok);if(!created.ok)throw Error(created.error.publicMessage);saved=created.value;
assert.deepEqual(saved.allocations[0]!.artworkFileId,"file-a","preparation snapshots canonical Artwork A");
const ready=await service.transition(context("ready-a") as any,{businessRequestId:"ready-a",productionRunId:saved.productionRunId,transition:"ready"});
assert(ready.ok);if(!ready.ok)throw Error(ready.error.publicMessage);saved=ready.value;

// Production Artwork B supersedes the prepared choice before execution.
current={productionWorkId:workB,...art("assignment-b","file-b","b")};
const staleStart=await service.transition(context("start-stale") as any,{businessRequestId:"start-stale",productionRunId:saved.productionRunId,transition:"start"});
assert.equal(staleStart.ok,false);if(!staleStart.ok)assert.equal(staleStart.error.code,"CONFLICT");
assert.equal(saved.allocations[0]!.artworkFileId,"file-a","start never silently substitutes new Artwork");

foreign=true;
const rejectedForeign=await service.refreshPreparation(context("refresh-foreign") as any,{businessRequestId:"refresh-foreign",productionRunId:saved.productionRunId});
assert.equal(rejectedForeign.ok,false,"foreign/unavailable Artwork or work is rejected before refresh");
foreign=false;

const refreshed=await service.refreshPreparation(context("refresh-b") as any,{businessRequestId:"refresh-b",productionRunId:saved.productionRunId});
assert(refreshed.ok);if(!refreshed.ok)throw Error(refreshed.error.publicMessage);saved=refreshed.value;
assert.equal(saved.allocations[0]!.artworkFileId,"file-b");
assert.equal(saved.allocations[0]!.productionWorkId,workB);
const refreshReplay=await service.refreshPreparation(context("refresh-b") as any,{businessRequestId:"refresh-b",productionRunId:saved.productionRunId});
assert(refreshReplay.ok);assert.equal(refreshes,1,"exact refresh retry must replay rather than refresh twice");

const started=await service.transition(context("start-b") as any,{businessRequestId:"start-b",productionRunId:saved.productionRunId,transition:"start"});
assert(started.ok);if(!started.ok)throw Error(started.error.publicMessage);saved=started.value;
assert.equal(saved.state,"active");
// Artwork C after start cannot mutate historical execution truth.
current={productionWorkId:brandedId<"ProductionWorkId">("work-c"),...art("assignment-c","file-c","c")};
const refreshActive=await service.refreshPreparation(context("refresh-after-start") as any,{businessRequestId:"refresh-after-start",productionRunId:saved.productionRunId});
assert.equal(refreshActive.ok,false);assert.equal(saved.allocations[0]!.artworkFileId,"file-b");

// The operation-request boundary rejects changed reuse of a request identity.
const changedRetry=await service.refreshPreparation(context("refresh-b") as any,{businessRequestId:"refresh-b",productionRunId:brandedId<"ProductionRunId">("other-run")});
assert.equal(changedRetry.ok,false);
console.log("Production Run artwork preparation contracts passed.");
