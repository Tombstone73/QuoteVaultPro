import assert from "node:assert/strict";
import React, { act } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { JSDOM } from "jsdom";
import { PrepressWorkspace } from "./PrepressWorkspace";

const queue=[{orderId:"order-a",orderNumber:"ORD-1008",customerId:"customer-a",customerDisplayName:"3 Alarm Graphics",orderLineId:"line-a",lineDescription:"Reflective Vinyl",quantity:1,routingStepKind:"proofing",coverage:{state:"configured",productionArtworkComplete:false,allRequiredPrepressUnitsComplete:false,requirements:[{requirement:{key:"front",side:"front"},artworkAssignmentIds:[],productionArtworkCovered:false,prepressComplete:false,prepressUnits:[]}]}}] as const;

const dom=new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>");
Object.assign(globalThis,{window:dom.window,document:dom.window.document,navigator:dom.window.navigator,HTMLElement:dom.window.HTMLElement,Event:dom.window.Event,IS_REACT_ACT_ENVIRONMENT:true});
const {createRoot}=await import("react-dom/client");
const client=new QueryClient({defaultOptions:{queries:{retry:false,staleTime:Infinity}}});
for(const requirementState of ["configured","unconfigured","all"]){
  const items=requirementState==="unconfigured"?[]:queue;
  client.setQueryData(["v2","scope-a","org-a","prepress","queue",1,25,"",requirementState,"all","all"],{items,pagination:{page:1,pageSize:25 as const,totalCount:items.length,totalPages:items.length?1:0}});
}
const root=createRoot(document.getElementById("root")!);
const reads:URL[]=[];
const methods:string[]=[];
const responses:Array<()=>void>=[];
const originalFetch=globalThis.fetch;
globalThis.fetch=async(input,init)=>{
  const url=new URL(String(input),"http://localhost");
  reads.push(url);methods.push(init?.method??"GET");
  assert.equal(init?.method??"GET","GET","render transitions must not invoke a mutation");
  assert.ok(url.pathname.includes("/org-b/")&&url.pathname.endsWith("/queue"),"only the uncached authorized organization may fetch");
  return new Promise<Response>(resolve=>responses.push(()=>resolve(new Response(JSON.stringify({ok:true,data:{items:[],pagination:{page:1,pageSize:25,totalCount:0,totalPages:0}}}),{status:200,headers:{"content-type":"application/json"}}))));
};
const render=async(overrides:Partial<React.ComponentProps<typeof PrepressWorkspace>>={})=>{
  await act(async()=>{root.render(<QueryClientProvider client={client}><PrepressWorkspace organizationId="org-a" sessionScope="scope-a" canView canArtworkAssign={false} canWork={false} canComplete={false} {...overrides} /></QueryClientProvider>);});
};
const text=()=>document.body.textContent??"";

try{
  await render({organizationId:"",prepressUnitId:"unit-a"});
  assert.match(text(),/Enter an authenticated organization/);
  assert.equal(reads.length,0,"no queue or unit reads without an organization");
  await render({canView:false,prepressUnitId:"unit-a"});
  assert.match(text(),/do not have permission to view Prepress/i);
  assert.equal(reads.length,0,"no queue or unit reads without view authority");
  await render({sessionScope:""});
  assert.match(text(),/Loading authenticated Prepress queue/);
  assert.equal(reads.length,0,"queries remain disabled without session scope");
  await render();
  assert.match(text(),/Prepress Queue/);
  assert.match(text(),/ORD-1008/);
  assert.equal(reads.length,0,"current complete cache keys avoid external I/O");
  await render({canView:false});
  assert.match(text(),/do not have permission to view Prepress/i);
  assert.doesNotMatch(text(),/ORD-1008|Upload production Artwork|Start Prepress/);
  await render();
  assert.match(text(),/ORD-1008/);
  await render({organizationId:""});
  assert.match(text(),/Enter an authenticated organization/);
  assert.doesNotMatch(text(),/ORD-1008/);
  await render();
  assert.match(text(),/ORD-1008/);
  await render({organizationId:"org-b",sessionScope:"scope-b"});
  assert.match(text(),/Loading authenticated Prepress queue/);
  assert.doesNotMatch(text(),/ORD-1008/);
  assert.equal(reads.length,2,"authorized loading starts only the two queue reads");
  await act(async()=>{for(const respond of responses)respond();});
  for(let i=0;i<30&&!text().includes("No routed Prepress work is available");i++)await act(async()=>{await new Promise(resolve=>setTimeout(resolve,5));});
  assert.match(text(),/No routed Prepress work is available/);
  await render({organizationId:"org-b",sessionScope:"scope-b",canView:false});
  assert.match(text(),/do not have permission to view Prepress/i);
  await render({organizationId:"org-b",sessionScope:"scope-b"});
  assert.match(text(),/No routed Prepress work is available/);
  await render();
  assert.match(text(),/ORD-1008/);
  assert.equal(reads.length,2,"revocation and restoration do not refetch fresh data");
  assert.ok(methods.every(method=>method==="GET"),"hook registration never writes");
}finally{
  await act(async()=>{root.unmount();});
  globalThis.fetch=originalFetch;
  client.clear();
  dom.window.close();
}
console.log("Prepress stable hook-order, organization, permission, scope, loading/data and side-effect safety tests passed.");
