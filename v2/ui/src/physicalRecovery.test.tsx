import assert from "node:assert/strict";
import React from "react";
import { JSDOM } from "jsdom";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { configureFulfillmentOwnerTransport } from "./fulfillmentOwnerApi";
import { useFulfillmentIntent } from "./ShipmentBuilder";
import { PhysicalRecoveryPanel } from "./PhysicalRecoveryPanel";
import type { PhysicalRecoveryResult } from "../../src/modules/fulfillment/physicalOperationRecovery";
import { createHash,webcrypto } from "node:crypto";
import { canonicalJson } from "../../src/modules/shared/commercialValues";
Object.defineProperty(globalThis,"crypto",{configurable:true,value:webcrypto});
const fingerprint=(input:unknown)=>`sha256:${createHash("sha256").update(canonicalJson(input)).digest("hex")}`;

const dom=new JSDOM("<!doctype html><div id='root'></div>",{url:"http://localhost"});
for(const [name,value] of Object.entries({window:dom.window,document:dom.window.document,navigator:dom.window.navigator,HTMLElement:dom.window.HTMLElement,Event:dom.window.Event,MouseEvent:dom.window.MouseEvent}))Object.defineProperty(globalThis,name,{configurable:true,value});
const container=dom.window.document.getElementById("root")!;
const durable=new Map<string,PhysicalRecoveryResult&{actor:string}>();let actor="staff-a",granted=true,handoffs=0,misboundTenant=false;
const keyOf=(org:string,operation:string,businessRequestId:string)=>JSON.stringify([org,operation,businessRequestId]);
const project=({actor:owner,...item}:PhysicalRecoveryResult&{actor:string})=>({...item,anotherActor:owner!==actor,...(owner!==actor||item.status!=="pending"?{input:undefined}:{})});
configureFulfillmentOwnerTransport(async <T,>(org:string,suffix:string,init?:RequestInit):Promise<T>=>{
  if(!granted)throw {code:"FORBIDDEN",message:"Fresh grants revoked"};
  if(suffix==="/physical-operations")return misboundTenant?[{organizationId:"foreign-owner-org",businessRequestId:"33333333-3333-4333-8333-333333333333",operation:"fulfillment.shipment-container.finalize.v1",status:"succeeded",anotherActor:true,result:{secret:"foreign-owner-secret"}}] as T:[...durable.values()].filter(item=>item.organizationId===org).map(project) as T;
  if(!init?.method){const parts=suffix.split("/"),receipt=durable.get(keyOf(org,decodeURIComponent(parts[2]),decodeURIComponent(parts[3])));if(!receipt)throw {code:"NOT_FOUND"};return project(receipt) as T;}
  const body=JSON.parse(String(init?.body));
  if(suffix.endsWith("/admit")){
    const key=keyOf(org,body.operation,body.businessRequestId),prior=durable.get(key);if(prior)return project(prior) as T;
    const result={organizationId:org,businessRequestId:body.businessRequestId,operation:body.operation,input:body.input,submittedPayloadFingerprint:fingerprint(body.input),status:"pending" as const,anotherActor:false,actor};durable.set(key,result);return result as T;
  }
  if(suffix.endsWith("/withdraw")){const operation=decodeURIComponent(suffix.split("/")[2]),key=keyOf(org,operation,body.businessRequestId),prior=durable.get(key)!;if(prior.status==="succeeded")return project(prior) as T;const result={...prior,status:"withdrawn" as const,input:undefined};durable.set(key,result);return project(result) as T;}
  throw new Error(`Unexpected owner path ${suffix}`);
});
const Harness=({scope}:{scope:string})=>{
  const intent=useFulfillmentIntent("recovery-org",scope);
  const submit=async()=>{
    const command=intent.begin({operation:"fulfillment-pickup",payload:{orderId:"order-private",method:"pickup",orderLineId:"private-line",quantity:2}});
    if(!command)return;
    await intent.admit(command);handoffs++;
    const key=keyOf("recovery-org","fulfillment.pickup.complete.v1",command.businessRequestId),receipt=durable.get(key)!;
    durable.set(key,{...receipt,status:"succeeded",input:undefined,result:{handoff:{handoffId:"exact-handoff"},allocations:[{quantity:2}]}});
    // The response is lost after commit. Do not call settle or mint another ID.
  };
  return <><button disabled={intent.state.kind!=="ready"} onClick={()=>void submit()}>Submit physical intent</button>{intent.state.kind==="pending"&&<p data-testid="pending-body">{JSON.stringify(intent.state.command.payload)}</p>}<PhysicalRecoveryPanel organizationId="recovery-org" sessionScope={scope} csrfReady/></>;
};
let root=createRoot(container);
const render=(scope:string)=>flushSync(()=>root.render(<Harness key={scope} scope={scope}/>));
const tick=async()=>{await new Promise(resolve=>setTimeout(resolve,30));};
const wait=async(predicate:()=>boolean)=>{for(let attempt=0;attempt<100&&!predicate();attempt++)await tick();assert.ok(predicate(),container.textContent??"UI proof did not settle");};
const button=(text:string)=>Array.from(container.querySelectorAll("button")).find(item=>item.textContent===text)!;
try{
  render("session-a");await tick();assert.equal(button("Submit physical intent").disabled,false);
  flushSync(()=>button("Submit physical intent").click());flushSync(()=>button("Submit physical intent").click());await tick();assert.equal(handoffs,1,"duplicate click cannot start another intent during admission");
  assert.equal(durable.size,1);assert.ok(container.querySelector('[data-testid="pending-body"]'));
  flushSync(()=>root.unmount());dom.window.sessionStorage.clear();root=createRoot(container);render("session-reauthed-a");await tick();
  assert.match(container.textContent!,/exact-handoff/);assert.match(container.textContent!,/"quantity": 2/);assert.equal(button("Submit physical intent").disabled,true,"lost-tab receipt must be acknowledged before another handoff");
  assert.match(container.querySelector("a")!.getAttribute("href")!,/recovery-org.*exact-handoff/,"recovery exposes the canonical freshly authorized handoff document route");
  assert.equal(handoffs,1,"recovery only reads exact owner results");assert.equal(container.querySelector('[data-testid="pending-body"]'),null);
  flushSync(()=>button("Acknowledge these owner results before new physical intent").click());await tick();assert.equal(button("Submit physical intent").disabled,false);
  durable.clear();const id="22222222-2222-4222-8222-222222222222";
  const pendingInput={businessRequestId:id,orderId:"order-private",allocations:[{orderLineId:"private-line",quantity:3}]};
  durable.set(keyOf("recovery-org","fulfillment.pickup.complete.v1",id),{organizationId:"recovery-org",actor:"staff-a",businessRequestId:id,operation:"fulfillment.pickup.complete.v1",status:"pending",anotherActor:false,input:pendingInput,submittedPayloadFingerprint:fingerprint(pendingInput)});
  dom.window.sessionStorage.clear();render("session-reauthed-pending");await wait(()=>Boolean(container.querySelector('[data-testid="pending-body"]')));assert.match(container.querySelector('[data-testid="pending-body"]')!.textContent!,/private-line/);assert.match(container.querySelector('[data-testid="pending-body"]')!.textContent!,/"quantity":3/);
  actor="staff-b";render("session-other-actor");await tick();assert.doesNotMatch(container.textContent!,/private-line|order-private/);assert.equal(button("Submit physical intent").disabled,true,"different actor cannot reveal or resubmit another actor's admitted body");
  assert.ok(button("Withdraw exact intent and block late execution"),"fresh authorized actor can withdraw the shared exact identity without seeing another actor's body");
  actor="staff-a";granted=false;render("session-revoked");await tick();assert.match(container.textContent!,/could not be read/);assert.doesNotMatch(container.textContent!,/private-line/);assert.equal(button("Submit physical intent").disabled,true);
  granted=true;actor="staff-b";render("session-restored");await tick();flushSync(()=>button("Withdraw exact intent and block late execution").click());await tick();assert.match(container.textContent!,/withdrawn/);assert.equal(button("Submit physical intent").disabled,true);assert.equal(handoffs,1);
  flushSync(()=>button("Acknowledge these owner results before new physical intent").click());await tick();assert.equal(button("Submit physical intent").disabled,false,"a different authorized actor acknowledges the same exact owner withdrawal identity without another actor's body");
  durable.clear();const unrelatedId="33333333-3333-4333-8333-333333333333",raw=JSON.stringify({version:1,organizationId:"recovery-org",sessionScope:"corrupt-operation-scope",businessRequestId:unrelatedId,operation:"shipment-finalize",payload:{shipmentId:"unresolved-shipment",expectedPreparedRevisionId:123},bodyCanonical:"corrupt",recovery:"retry"});
  dom.window.sessionStorage.setItem("ph.v2.fulfillment.intent.v1:recovery-org",raw);
  durable.set(keyOf("recovery-org","fulfillment.pickup.complete.v1",unrelatedId),{organizationId:"recovery-org",actor:"staff-a",businessRequestId:unrelatedId,operation:"fulfillment.pickup.complete.v1",status:"succeeded",anotherActor:true,result:{handoff:{handoffId:"unrelated-operation-result"}}});
  render("corrupt-operation-scope");await tick();flushSync(()=>button("Acknowledge these owner results before new physical intent").click());await tick();assert.equal(dom.window.sessionStorage.getItem("ph.v2.fulfillment.intent.v1:recovery-org"),raw,"a receipt for another operation with the same request ID cannot clear an unresolved marker");assert.equal(button("Submit physical intent").disabled,true);assert.match(container.textContent!,/not evidence of failure/);
  misboundTenant=true;render("wrong-receipt-tenant");await tick();assert.doesNotMatch(container.textContent!,/foreign-owner-secret/);assert.equal(button("Submit physical intent").disabled,true);assert.equal(dom.window.sessionStorage.getItem("ph.v2.fulfillment.intent.v1:recovery-org"),raw);assert.equal(handoffs,1);
  console.log("physicalRecovery: 8 mounted timeout/reload/actor/grant/duplicate/withdrawal/exact-operation/tenant scenarios PASS");
}finally{flushSync(()=>root.unmount());dom.window.close();}
