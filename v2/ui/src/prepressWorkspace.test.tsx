import assert from "node:assert/strict";
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { PrepressWorkspace } from "./PrepressWorkspace";

const client=new QueryClient();
client.setQueryData(["v2","scope-a","org-a","prepress","queue",1,25,"","all"],{items:[{orderId:"order-a",orderNumber:"ORD-1007",customerId:"customer-a",customerDisplayName:"3 Alarm Graphics",orderLineId:"line-a",lineDescription:"Sign Vinyl",quantity:2,requestedDueDate:"2026-08-29",routingStepKind:"prepress",coverage:{state:"configured",productionArtworkComplete:true,allRequiredPrepressUnitsComplete:false,requirements:[{requirement:{key:"front",side:"front",sourcePageIndex:0,layerKey:"ink",layerOrder:0},artworkAssignmentIds:["assignment-a"],productionArtworkCovered:true,prepressComplete:false,prepressUnits:[{prepressUnitId:"unit-a",organizationId:"org-a",orderId:"order-a",orderLineId:"line-a",artworkAssignmentId:"assignment-a",artworkFileId:"file-a",side:"front",sourcePageIndex:0,layerKey:"ink",layerOrder:0,createdAt:"2026-08-25",createdPrincipalKind:"staff",createdPrincipalSubject:"staff-a"}]}]}}],pagination:{page:1,pageSize:25 as const,totalCount:1,totalPages:1}});
client.setQueryData(["v2","scope-a","org-a","artwork","order","order-a"],[{file:{id:"file-a",displayFilename:"prepress-source.pdf",contentType:"application/pdf",byteSize:1200,source:"customer_upload",createdAt:"2026-08-25"},assignment:{id:"assignment-source",artworkFileId:"file-a",orderId:"order-a",orderLineId:"line-a",purpose:"customer_supplied",side:"front",createdAt:"2026-08-25"}}]);
const markup=renderToStaticMarkup(<QueryClientProvider client={client}><PrepressWorkspace organizationId="org-a" sessionScope="scope-a" canView canArtworkAssign canWork canComplete lineId="line-a" openOrder={()=>{}} openCustomer={()=>{}} openArtwork={()=>{}} /></QueryClientProvider>);
for(const text of ["Prepress Queue","ORD-1007","3 Alarm Graphics","Sign Vinyl","Qty 2","Front · Page 1 · ink 1","Open Order","Open Customer","Open Artwork","Routing has made Prepress current","Preview unavailable","Workflow boundary","Artwork boundary"])assert.match(markup,new RegExp(text));
assert.doesNotMatch(markup,/Production Plan|Prepress Notes|Production Alerts|file-a|assignment-a|customer-a/);
console.log("Prepress workspace visual contract tests passed.");
