import assert from "node:assert/strict";
import type { OperationContext } from "../../src/application/operation.js";
import type { Capability } from "../../src/authorization/capabilities.js";
import { V2ApplicationError } from "../../src/errors/applicationError.js";
import { ProductionRunApplicationService, type ProductionRun, type ProductionRunTransaction } from "../../src/modules/production/productionRunApplication.js";
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

const otherOrg = brandedId<"OrganizationId">("org-b");
const run: ProductionRun = {
  productionRunId: brandedId<"ProductionRunId">("run-a"), organizationId: org,
  stationKey: "flatbed", state: "draft", revision: 1, materialFingerprint: null,
  layoutMetadata: {}, allocations: [], events: [],
};
const otherRun: ProductionRun = { ...run, productionRunId: brandedId<"ProductionRunId">("run-b"), organizationId: otherOrg };
const runs = [run, otherRun];
const persistenceCalls: string[][] = [];
let readError: Error | undefined;
const readTx: ProductionRunTransaction = {
  ...tx,
  lockRun: async (organizationId, id) => {
    persistenceCalls.push(["lockRun", organizationId, id]);
    if (readError) throw readError;
    return runs.find(value => value.organizationId === organizationId && value.productionRunId === id) ?? null;
  },
  list: async organizationId => {
    persistenceCalls.push(["list", organizationId]);
    return runs.filter(value => value.organizationId === organizationId);
  },
};
const readService = new ProductionRunApplicationService({ transaction: async action => {
  persistenceCalls.push(["transaction"]);
  return action(readTx);
} });
const readContext = (capabilities: readonly Capability[], organizationId = org): OperationContext => ({
  organizationId, operationId: "read-run",
  principal: { ...principal, organizationId, authority: { ...principal.authority, capabilities } },
});

for (const organizationId of [org, otherOrg]) {
  for (const capabilities of [[], ["production.run.execute"]] as const) {
    for (const read of [() => readService.list(readContext(capabilities, organizationId)), () => readService.get(readContext(capabilities, organizationId), run.productionRunId)]) {
      persistenceCalls.length = 0;
      const denied = await read();
      assert.equal(denied.ok, false, "Run reads require production.view, not execution authority");
      if (denied.ok) throw Error("Run read unexpectedly allowed");
      assert.equal(denied.error.code, "FORBIDDEN");
      assert.equal(denied.error.publicMessage, "The principal does not have authority to view Production Runs.");
      assert.deepEqual(persistenceCalls, [], "denied Run reads must not open a transaction or access persistence");
    }
  }
}

for (const capabilities of [[], ["production.view"]] as const) {
  const wrongScope = { ...readContext(capabilities), organizationId: otherOrg };
  for (const read of [() => readService.list(wrongScope), () => readService.get(wrongScope, otherRun.productionRunId)]) {
    persistenceCalls.length = 0;
    const denied = await read();
    assert.equal(denied.ok, false);
    if (denied.ok) throw Error("Wrong-tenant Run read unexpectedly allowed");
    assert.equal(denied.error.code, "WRONG_TENANT", "tenant scope must be checked before capabilities");
    assert.equal(denied.error.publicMessage, "The requested organization is outside the principal scope.");
    assert.deepEqual(persistenceCalls, []);
  }
}

for (const expected of runs) {
  const allowedContext = readContext(["production.view"], expected.organizationId);
  persistenceCalls.length = 0;
  const listed = await readService.list(allowedContext);
  assert.deepEqual(listed, { ok: true, value: [expected] });
  assert.deepEqual(persistenceCalls, [["transaction"], ["list", expected.organizationId]]);
  persistenceCalls.length = 0;
  const detail = await readService.get(allowedContext, expected.productionRunId);
  assert.deepEqual(detail, { ok: true, value: expected });
  assert.deepEqual(persistenceCalls, [["transaction"], ["lockRun", expected.organizationId, expected.productionRunId]]);

  persistenceCalls.length = 0;
  const revoked = await readService.get(readContext([], expected.organizationId), expected.productionRunId);
  assert.equal(revoked.ok, false, "a prior successful read must not cache authority after permission revocation");
  if (revoked.ok) throw Error("Revoked Run read unexpectedly allowed");
  assert.equal(revoked.error.code, "FORBIDDEN");
  assert.deepEqual(persistenceCalls, []);

  const foreignRun = expected === run ? otherRun : run;
  for (const id of [foreignRun.productionRunId, brandedId<"ProductionRunId">("missing-run")]) {
    persistenceCalls.length = 0;
    const missing = await readService.get(allowedContext, id);
    assert.equal(missing.ok, false);
    if (missing.ok) throw Error("Foreign or missing Run unexpectedly returned");
    assert.equal(missing.error.code, "NOT_FOUND");
    assert.equal(missing.error.publicMessage, "Production Run was not found.");
    assert.deepEqual(persistenceCalls, [["transaction"], ["lockRun", expected.organizationId, id]]);
  }
}

for (const error of [new Error("private persistence failure"), new V2ApplicationError("CONFLICT", "Existing application error")]) {
  readError = error;
  persistenceCalls.length = 0;
  const failed = await readService.get(readContext(["production.view"]), run.productionRunId);
  assert.equal(failed.ok, false);
  if (failed.ok) throw Error("Failed Run read unexpectedly succeeded");
  if (error instanceof V2ApplicationError) assert.equal(failed.error, error);
  else {
    assert.equal(failed.error.code, "VALIDATION_ERROR");
    assert.equal(failed.error.publicMessage, "Production Run is unavailable.");
  }
  assert.deepEqual(persistenceCalls, [["transaction"], ["lockRun", org, run.productionRunId]]);
}
console.log("Production Run application contracts passed.");
