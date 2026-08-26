import assert from "node:assert/strict";
import React, { act } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { JSDOM } from "jsdom";
import { PrepressWorkspace, filterPrepressQueue } from "./PrepressWorkspace";

const queue=[{orderId:"order-a",orderNumber:"ORD-1008",customerId:"customer-a",customerDisplayName:"3 Alarm Graphics",orderLineId:"line-a",lineDescription:"Reflective Vinyl",quantity:1,routingStepKind:"proofing",coverage:{state:"configured",productionArtworkComplete:false,allRequiredPrepressUnitsComplete:false,requirements:[{requirement:{key:"front",side:"front"},artworkAssignmentIds:[],productionArtworkCovered:false,prepressComplete:false,prepressUnits:[]}]}}] as const;
assert.deepEqual(filterPrepressQueue(queue,"3 alarm").map((item)=>item.orderLineId),["line-a"]);
assert.deepEqual(filterPrepressQueue(queue,"unrelated"),[]);

const dom=new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>");
Object.assign(globalThis,{window:dom.window,document:dom.window.document,navigator:dom.window.navigator,HTMLElement:dom.window.HTMLElement,Event:dom.window.Event,IS_REACT_ACT_ENVIRONMENT:true});
const {createRoot}=await import("react-dom/client");
const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
client.setQueryData(["v2","scope-a","org-a","prepress","queue"],queue);
const root=createRoot(document.getElementById("root")!);
const view=(canView:boolean)=><QueryClientProvider client={client}><PrepressWorkspace organizationId="org-a" sessionScope="scope-a" canView={canView} canArtworkAssign={false} canWork={false} canComplete={false} /></QueryClientProvider>;

await act(async()=>{root.render(view(false));});
assert.match(document.body.textContent??"",/do not have permission to view Prepress/i);
await act(async()=>{root.render(view(true));});
assert.match(document.body.textContent??"",/Prepress Queue/);
assert.match(document.body.textContent??"",/ORD-1008/);
await act(async()=>{root.render(view(false));});
assert.match(document.body.textContent??"",/do not have permission to view Prepress/i);
await act(async()=>{root.unmount();});
console.log("Prepress hook-order and permission-transition tests passed.");
