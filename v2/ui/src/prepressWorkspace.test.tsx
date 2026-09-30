import assert from "node:assert/strict";
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { PrepressWorkspace } from "./PrepressWorkspace";
import type { OperationalQueuePage, PrepressQueueItem } from "./api";

const client=new QueryClient();
const operational = {
  materials: ["Sign Vinyl"],
  sourceArtwork: [{ artworkAssignmentId: "assignment-source", artworkFileId: "file-a", filename: "prepress-source.pdf", contentType: "application/pdf", purpose: "customer_supplied" }],
  productionArtwork: [], proof: { required: false, state: "not_required" },
  productionDestination: "flatbed", readiness: { ready: false, blockers: ["prepress_incomplete"] },
} satisfies NonNullable<PrepressQueueItem["operational"]>;
client.setQueryData(["v2","scope-a","org-a","prepress","queue",1,25,"","all","all","all"],{items:[{orderId:"order-a",orderNumber:"ORD-1007",customerId:"customer-a",customerDisplayName:"3 Alarm Graphics",orderLineId:"line-a",lineDescription:"Sign Vinyl",quantity:2,requestedDueDate:"2026-08-29",routingStepKind:"prepress",coverage:{state:"configured",productionArtworkComplete:true,allRequiredPrepressUnitsComplete:false,requirements:[{requirement:{key:"front",side:"front",sourcePageIndex:0,layerKey:"ink",layerOrder:0},artworkAssignmentIds:["assignment-a"],productionArtworkCovered:true,prepressComplete:false,prepressUnits:[{prepressUnitId:"unit-a",organizationId:"org-a",orderId:"order-a",orderLineId:"line-a",artworkAssignmentId:"assignment-a",artworkFileId:"file-a",side:"front",sourcePageIndex:0,layerKey:"ink",layerOrder:0,createdAt:"2026-08-25"}]}]}}],pagination:{page:1,pageSize:25,totalCount:1,totalPages:1}} satisfies OperationalQueuePage<PrepressQueueItem>);
client.setQueryData<OperationalQueuePage<PrepressQueueItem>>(["v2","scope-a","org-a","prepress","queue",1,25,"","all","all","all"],page=>page&&({...page,items:page.items.map(item=>({...item,operational}))}));
const markup=renderToStaticMarkup(<QueryClientProvider client={client}><PrepressWorkspace organizationId="org-a" sessionScope="scope-a" canView canArtworkAssign canWork canComplete lineId="line-a" openOrder={()=>{}} openCustomer={()=>{}} openArtwork={()=>{}} /></QueryClientProvider>);
for(const text of ["Prepress Queue","ORD-1007","3 Alarm Graphics","Sign Vinyl","Qty 2","Front · Page 1 · ink 1","Open Order","Open Customer","Open Artwork","Routing has made Prepress current","No production Artwork","Workflow boundary","Artwork boundary"])assert.match(markup,new RegExp(text));
assert.match(markup,/prepress-source.pdf/);
assert.doesNotMatch(markup,/<iframe|<img/,"an unavailable canonical production-art projection must not manufacture a preview");
assert.doesNotMatch(markup,/Production Plan|Prepress Notes|Production Alerts|file-a|assignment-a|customer-a/);
assert.match(markup,/1 line items/);
assert.match(markup,/Page 1 of 1/);
assert.match(markup,/<button type="button" disabled="">Next<\/button>/);
const denied=renderToStaticMarkup(<QueryClientProvider client={client}><PrepressWorkspace organizationId="org-a" sessionScope="scope-a" canView={false} canArtworkAssign canWork canComplete lineId="line-a" /></QueryClientProvider>);
assert.match(denied,/do not have permission to view Prepress/);
assert.doesNotMatch(denied,/ORD-1007|3 Alarm Graphics|Sign Vinyl/);
const foreign=renderToStaticMarkup(<QueryClientProvider client={client}><PrepressWorkspace organizationId="org-b" sessionScope="scope-a" canView canArtworkAssign canWork canComplete lineId="line-a" /></QueryClientProvider>);
assert.match(foreign,/Loading authenticated Prepress queue/);
assert.doesNotMatch(foreign,/ORD-1007|3 Alarm Graphics|Sign Vinyl/);
const otherSession=renderToStaticMarkup(<QueryClientProvider client={client}><PrepressWorkspace organizationId="org-a" sessionScope="scope-b" canView canArtworkAssign canWork canComplete lineId="line-a" /></QueryClientProvider>);
assert.match(otherSession,/Loading authenticated Prepress queue/);
assert.doesNotMatch(otherSession,/ORD-1007|3 Alarm Graphics|Sign Vinyl/);
client.clear();
console.log("Prepress workspace visual contract tests passed.");
