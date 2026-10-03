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
  productionArtwork: [
    { artworkAssignmentId: "assignment-ink", artworkFileId: "file-ink", filename: "ink-current.pdf", contentType: "application/pdf", purpose: "production", side: "front", sourcePageIndex: 0, layerKey: "ink", layerOrder: 0 },
    { artworkAssignmentId: "assignment-varnish", artworkFileId: "file-varnish", filename: "varnish-current.pdf", contentType: "application/pdf", purpose: "production", side: "front", sourcePageIndex: 0, layerKey: "varnish", layerOrder: 1 },
  ], proof: { required: false, state: "not_required" },
  productionDestination: "flatbed", readiness: { ready: false, blockers: ["prepress_incomplete"] },
} satisfies NonNullable<PrepressQueueItem["operational"]>;
client.setQueryData(["v2","scope-a","org-a","prepress","queue",1,25,"","all","all","all"],{items:[{orderId:"order-a",orderNumber:"ORD-1007",customerId:"customer-a",customerDisplayName:"3 Alarm Graphics",orderLineId:"line-a",lineDescription:"Sign Vinyl",quantity:2,requestedDueDate:"2026-08-29",routingStepKind:"prepress",coverage:{state:"configured",productionArtworkComplete:true,allRequiredPrepressUnitsComplete:false,requirements:[{requirement:{key:"front-ink",side:"front",sourcePageIndex:0,layerKey:"ink",layerOrder:0},artworkAssignmentIds:["assignment-ink"],productionArtworkCovered:true,prepressComplete:false,prepressUnits:[{prepressUnitId:"unit-a",organizationId:"org-a",orderId:"order-a",orderLineId:"line-a",artworkAssignmentId:"assignment-ink",artworkFileId:"file-ink",side:"front",sourcePageIndex:0,layerKey:"ink",layerOrder:0,createdAt:"2026-08-25"}]},{requirement:{key:"front-varnish",side:"front",sourcePageIndex:0,layerKey:"varnish",layerOrder:1},artworkAssignmentIds:["assignment-varnish"],productionArtworkCovered:true,prepressComplete:false,prepressUnits:[]} ]}}],pagination:{page:1,pageSize:25,totalCount:1,totalPages:1}} satisfies OperationalQueuePage<PrepressQueueItem>);
client.setQueryData<OperationalQueuePage<PrepressQueueItem>>(["v2","scope-a","org-a","prepress","queue",1,25,"","all","all","all"],page=>page&&({...page,items:page.items.map(item=>({...item,operational}))}));
const markup=renderToStaticMarkup(<QueryClientProvider client={client}><PrepressWorkspace organizationId="org-a" sessionScope="scope-a" canView canArtworkAssign canWork canComplete lineId="line-a" openOrder={()=>{}} openCustomer={()=>{}} openArtwork={()=>{}} /></QueryClientProvider>);
for(const text of ["Prepress Queue","ORD-1007","3 Alarm Graphics","Sign Vinyl","Qty 2","Front · Page 1 · ink 1","Front · Page 1 · varnish 2","Open Order","Open Customer","Open Artwork","Routing has made Prepress current","Workflow boundary","Artwork boundary"])assert.match(markup,new RegExp(text));
assert.match(markup,/prepress-source.pdf/);
assert.match(markup,/ink-current\.pdf/,"the preview follows the exact covered production assignment");
assert.doesNotMatch(markup,/varnish-current\.pdf/,"same-side/page art from another layer must not be used as the preview or predecessor");
assert.match(markup,/<iframe/);
assert.doesNotMatch(markup,/Production Plan|Prepress Notes|Production Alerts|assignment-varnish|customer-a/);
assert.match(markup,/1 line items/);
assert.match(markup,/Page 1 of 1/);
assert.match(markup,/<button type="button" disabled="">Next<\/button>/);
const originalPage=client.getQueryData<OperationalQueuePage<PrepressQueueItem>>(["v2","scope-a","org-a","prepress","queue",1,25,"","all","all","all"])!;
const originalItem=originalPage.items[0]!;
if(originalItem.coverage.state!=="configured")throw new Error("Expected configured production requirements in the Prepress fixture.");
const renderArtworkCase=(artworkAssignmentIds:readonly string[],productionArtwork:NonNullable<PrepressQueueItem["operational"]>["productionArtwork"])=>{
  const requirements=originalItem.coverage.state==="configured"?originalItem.coverage.requirements:[];
  const first=requirements[0]!;
  client.setQueryData<OperationalQueuePage<PrepressQueueItem>>(["v2","scope-a","org-a","prepress","queue",1,25,"","all","all","all"],{...originalPage,items:[{...originalItem,coverage:{...originalItem.coverage,requirements:[{...first,artworkAssignmentIds},...requirements.slice(1)]},operational:{...operational,productionArtwork}}]});
  return renderToStaticMarkup(<QueryClientProvider client={client}><PrepressWorkspace organizationId="org-a" sessionScope="scope-a" canView canArtworkAssign canArtworkAdopt canWork canComplete lineId="line-a" /></QueryClientProvider>);
};
const ambiguous=renderArtworkCase(["assignment-ink","assignment-ink-duplicate"],[operational.productionArtwork[0]!,{...operational.productionArtwork[0]!,artworkAssignmentId:"assignment-ink-duplicate",artworkFileId:"file-ink-duplicate",filename:"ink-duplicate.pdf"}]);
assert.match(ambiguous,/Multiple current Production Artwork assignments match this requirement/);
assert.doesNotMatch(ambiguous,/<iframe/,"ambiguous layer candidates must not choose a preview");
const missing=renderArtworkCase(["assignment-ink"],[operational.productionArtwork[1]!]);
assert.match(missing,/covered Production Artwork assignment is missing from the current Artwork projection/);
assert.doesNotMatch(missing,/<iframe/,"missing exact assignment must fail closed instead of falling back to side/page");
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
