import assert from "node:assert/strict";
import type { OperationContext } from "../../src/application/operation.js";
import type { Capability } from "../../src/authorization/capabilities.js";
import { V2ApplicationError } from "../../src/errors/applicationError.js";
import { ProductionRecoveryService, type ProductionRecoveryPort, type ProductionOutputReceipt } from "../../src/modules/production/productionRecovery.js";

const op="production.attempt.output.v1" as const;
const intent={businessRequestId:"request-a",productionAttemptId:"attempt-a",goodQuantityDelta:7,wasteQuantityDelta:2};
const receipt:ProductionOutputReceipt={operation:op,businessRequestId:"request-a",productionWorkId:"work-a",productionAttemptId:"attempt-a",intent,submittedAt:"2026-10-03T00:00:00.000Z",status:"pending",result:null};
let calls=0;
const port:ProductionRecoveryPort={prepare:async(actor,_op,input)=>{calls++;assert.equal(actor.principalSubject,"actor-a");if(JSON.stringify(input)!==JSON.stringify(intent))throw new V2ApplicationError("IDEMPOTENCY_CONFLICT","Original intent fingerprint does not match.");return receipt;},discover:async()=>{calls++;return [receipt];},reject:async()=>{calls++;}};
const service=new ProductionRecoveryService(port);
const context=(caps:readonly Capability[]=["production.view","production.work"]):OperationContext=>({organizationId:"org-a",operationId:"recovery",principal:{kind:"staff",organizationId:"org-a",userId:"actor-a",authority:{membershipId:"member-a",capabilities:caps}},businessRequest:{id:"request-a",payloadFingerprint:"ignored"}});
let cases=0;
for(const caps of [[],["production.view"],["production.work"],["production.view","production.run.execute"]] as readonly Capability[][]){calls=0;await assert.rejects(()=>service.discover(context(caps),op),error=>(error as {code:string}).code==="FORBIDDEN");assert.equal(calls,0);cases++;}
calls=0;await assert.rejects(()=>service.discover({...context(),organizationId:"org-b"},op),error=>(error as {code:string}).code==="WRONG_TENANT");assert.equal(calls,0);cases++;
calls=0;await assert.rejects(()=>service.prepare(context(),op,{...intent,businessRequestId:"other"}),/exact Production output intent/);assert.equal(calls,0);cases++;
for(const bad of [{...intent,goodQuantityDelta:-1},{...intent,goodQuantityDelta:0,wasteQuantityDelta:0},{...intent,reason:"hidden changed command"}]){calls=0;await assert.rejects(()=>service.prepare(context(),op,bad),/exact Production output intent/);assert.equal(calls,0);cases++;}
assert.deepEqual(await service.prepare(context(),op,intent),receipt);cases++;
assert.deepEqual(await service.prepared(context(),op,intent),receipt);cases++;
await assert.rejects(()=>service.prepared(context(),op,{...intent,wasteQuantityDelta:3}),error=>(error as {code:string}).code==="IDEMPOTENCY_CONFLICT");cases++;
calls=0;await assert.rejects(()=>service.discover(context([]),op),/not authorized/);assert.equal(calls,0,"prior receipt access never caches grants");cases++;
calls=0;await assert.rejects(()=>service.discover({...context(),principal:{kind:"service",organizationId:"org-a",clientId:"foreign",capabilities:["production.view"]}},op),/not authorized/);assert.equal(calls,0);cases++;
assert.deepEqual(await service.discover({...context(),principal:{kind:"staff",organizationId:"org-a",userId:"actor-b",authority:{membershipId:"member-b",capabilities:["production.view","production.work"]}}},op),[receipt]);cases++;
console.log(`Production recovery authority/exact-intent contracts: ${cases} cases passed.`);
