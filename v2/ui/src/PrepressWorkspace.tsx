import { OperationalQueuePager } from "./OperationalQueuePager";
import React, { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiResponseStatus, artworkApi, newBusinessRequestId, prepressApi, type ApiError, type PrepressQueueDestination, type PrepressQueueItem, type PrepressQueueReadiness, type PrepressQueueRequirementState, type ProductionRequirementCoverage } from "./api";
import { ArtworkAutoUploadDropzone } from "./ArtworkAutoUploadDropzone";
import { resolvePrepressProductionArtwork } from "../../src/modules/prepress/contracts";

const PREPRESS_BULK_HANDOFF_MAX=50;
type HandoffIntent = Readonly<{ scopeKey:string; businessRequestId:string; unitIds:readonly string[]; bulk:boolean }>;
type ProductionHandoff = Readonly<{ destination:"flatbed"|"roll"; productionWorkIds:readonly string[] }>;
const sameHandoff = (left:HandoffIntent|undefined,right:HandoffIntent):boolean => Boolean(left&&left.scopeKey===right.scopeKey&&left.businessRequestId===right.businessRequestId&&left.bulk===right.bulk&&JSON.stringify(left.unitIds)===JSON.stringify(right.unitIds));
const readHandoff = (scopeKey:string):HandoffIntent|undefined => {
  try {
    const value=JSON.parse(window.sessionStorage.getItem(scopeKey)??"null");
    if(value?.scopeKey===scopeKey&&typeof value.businessRequestId==="string"&&value.businessRequestId.trim()&&typeof value.bulk==="boolean"&&Array.isArray(value.unitIds)&&value.unitIds.length>0&&value.unitIds.length<=PREPRESS_BULK_HANDOFF_MAX&&value.unitIds.every((id:unknown)=>typeof id==="string"&&id.trim())&&new Set(value.unitIds).size===value.unitIds.length&&(value.bulk||value.unitIds.length===1))return value;
  } catch { /* Unavailable storage never authorizes a new handoff. */ }
};
const blockerMessage = (blocker:string) => ({production_requirements_unconfigured:"Sales/Product owner: this line has no frozen production requirements. Open the Order to review configuration.",production_artwork_missing:"Artwork owner: explicitly assign production art to every frozen requirement.",prepress_units_incomplete:"Prepress owner: complete preparation for every required unit.",proof_approval_required:"Proofing owner: the latest required proof must be approved.",production_route_missing:"Routing owner: a frozen Production route step is required.",production_destination_unconfigured:"Routing owner: a frozen Production destination is required."}[blocker]??`Owner readiness blocker: ${blocker.replaceAll("_"," ")}. Review the Order and its current owner evidence.`);
const keys = { queue: (scope:string, org:string, page:number, pageSize:number, search:string, requirementState:PrepressQueueRequirementState,destination:PrepressQueueDestination,readiness:PrepressQueueReadiness) => ["v2", scope, org, "prepress", "queue", page, pageSize, search, requirementState,destination,readiness] as const, unit: (scope:string, org:string, unit:string) => ["v2", scope, org, "prepress", "unit", unit] as const };
const label = (r:ProductionRequirementCoverage["requirement"]) => `${r.side?`${r.side[0]!.toUpperCase()}${r.side.slice(1)}`:r.key}${r.sourcePageIndex===undefined?"":` · Page ${r.sourcePageIndex+1}`}${r.layerKey?` · ${r.layerKey} ${r.layerOrder!+1}`:""}`;
const state = (coverage:ProductionRequirementCoverage,item:PrepressQueueItem) => coverage.prepressUnits.some((unit)=>unit.reworkCycleId&&!unit.completedAt) ? "Rework in Prepress" : !coverage.productionArtworkCovered ? "Needs Production Art" : coverage.prepressComplete ? "Prepress Complete" : coverage.prepressUnits.some((unit)=>unit.startedAt) ? "In Prepress" : item.routingStepKind!=="prepress" ? `Waiting on ${item.routingStepKind??"Routing"}` : "Ready for Prepress";
const statusClass = (value:string) => value==="Prepress Complete" ? "ok" : value==="In Prepress" ? "active" : value==="Ready for Prepress" ? "ready" : value.startsWith("Needs") ? "warn" : "neutral";
const prerequisite = (item:PrepressQueueItem) => item.routingStepKind==="proofing" ? "Routing is still at Proofing; Prepress cannot start." : item.routingStepKind==="prepress" ? "Routing has made Prepress current. Proofing remains owned by Proofing." : `Routing is currently at ${item.routingStepKind??"an unavailable step"}.`;
const artworkSelectionMessage = (kind:ReturnType<typeof resolvePrepressProductionArtwork>["kind"]) => kind==="ambiguous" ? "Multiple current Production Artwork assignments match this requirement. Refresh or resolve the Artwork identity before using a preview or replacement." : kind==="missing" ? "The covered Production Artwork assignment is missing from the current Artwork projection. Refresh before continuing." : kind==="identity_mismatch" ? "The Production Artwork projection does not match the required side, page, and layer. Refresh before continuing." : undefined;

/** Approved three-rail Prepress hierarchy, backed only by canonical owner projections. */
export const PrepressWorkspace=({organizationId,sessionScope,canView,canArtworkAssign,canArtworkAdopt=false,canWork,canComplete,canRouteAdvance=false,canProductionWork=false,lineId,prepressUnitId,onSelectLine,openOrder,openCustomer,openArtwork,onProductionReady}:{organizationId:string;sessionScope:string;canView:boolean;canArtworkAssign:boolean;canArtworkAdopt?:boolean;canWork:boolean;canComplete:boolean;canRouteAdvance?:boolean;canProductionWork?:boolean;lineId?:string;prepressUnitId?:string;onSelectLine?:(lineId:string)=>void;openOrder?:(orderId:string)=>void;openCustomer?:(customerId:string)=>void;openArtwork?:(artworkFileId:string)=>void;onProductionReady?:(handoffs:readonly ProductionHandoff[])=>void})=>{
  const queryClient=useQueryClient();
  const scopeKey=`ph.v2.prepress-handoff:${encodeURIComponent(sessionScope)}:${encodeURIComponent(organizationId)}`;
  const contextRef=useRef(scopeKey);contextRef.current=scopeKey;
  const mounted=useRef(true);useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  const [pendingHandoff,setPendingHandoff]=useState<HandoffIntent|undefined>(()=>readHandoff(scopeKey));
  const [rollback,setRollback]=useState<Readonly<{intent:HandoffIntent;code:"CONFLICT"|"STALE_STATE"}>|undefined>();
  const handoffRef=useRef(pendingHandoff);
  useEffect(()=>{const saved=readHandoff(scopeKey);handoffRef.current=saved;setPendingHandoff(saved);setRollback(undefined);},[scopeKey]);
  const pending=pendingHandoff?.scopeKey===scopeKey?pendingHandoff:undefined;
  const canSend=canView&&canComplete&&canRouteAdvance&&canProductionWork&&Boolean(organizationId&&sessionScope);
  const [requirementState,setRequirementState]=useState<PrepressQueueRequirementState>(lineId||prepressUnitId?"all":"configured");
  const [destination,setDestination]=useState<PrepressQueueDestination>("all");
  const [readiness,setReadiness]=useState<PrepressQueueReadiness>("all");
  const [page,setPage]=useState(1); const [pageSize,setPageSize]=useState<25|50|100>(25);
  const [selectedLineId,setSelectedLineId]=useState(lineId??""); const [selectedRequirement,setSelectedRequirement]=useState(""); const [query,setQuery]=useState("");
  const [selectedUnitIds,setSelectedUnitIds]=useState<ReadonlySet<string>>(new Set());
  const selectVisibleRef=useRef<HTMLInputElement>(null);
  const queue=useQuery({queryKey:keys.queue(sessionScope,organizationId,page,pageSize,query,requirementState,destination,readiness),queryFn:()=>prepressApi.list(organizationId,{page,pageSize,search:query,requirementState,destination,readiness}),enabled:Boolean(organizationId&&sessionScope&&canView)});
  const needsConfiguration=useQuery({queryKey:keys.queue(sessionScope,organizationId,1,25,query,"unconfigured",destination,readiness),queryFn:()=>prepressApi.list(organizationId,{page:1,pageSize:25,search:query,requirementState:"unconfigured",destination,readiness}),enabled:Boolean(organizationId&&sessionScope&&canView)});
  const unit=useQuery({queryKey:keys.unit(sessionScope,organizationId,prepressUnitId??""),queryFn:()=>prepressApi.get(organizationId,prepressUnitId!),enabled:Boolean(organizationId&&sessionScope&&canView&&prepressUnitId)});
  const filtered=queue.data?.items??[];
  useEffect(()=>{if(lineId&&lineId!==selectedLineId){setSelectedLineId(lineId);setRequirementState("all");setPage(1);}},[lineId]);
  useEffect(()=>{if(prepressUnitId){setRequirementState("all");setPage(1);}},[prepressUnitId]);
  useEffect(()=>{if(unit.data)setSelectedLineId(unit.data.orderLineId);},[unit.data]);
  const activeLineId=prepressUnitId?(unit.data?.prepressUnitId===prepressUnitId?unit.data.orderLineId:""):selectedLineId||filtered[0]?.orderLineId||"";
  const pageItem=filtered.find((entry)=>entry.orderLineId===activeLineId);
  const exactLine=useQuery({queryKey:["v2",sessionScope,organizationId,"prepress","line",activeLineId],queryFn:()=>prepressApi.getLine(organizationId,activeLineId),enabled:Boolean(organizationId&&sessionScope&&canView&&activeLineId&&!pageItem)});
  const exactItem=exactLine.data?.orderLineId===activeLineId&&(!prepressUnitId||!unit.data||exactLine.data.orderId===unit.data.orderId)?exactLine.data:undefined;
  const item=pageItem??exactItem;
  useEffect(()=>{if(!item)return;const matching=prepressUnitId?item.coverage.requirements.find((entry)=>entry.prepressUnits.some((candidate)=>candidate.prepressUnitId===prepressUnitId)):undefined;if(matching){setSelectedRequirement(matching.requirement.key);return;}if(!item.coverage.requirements.some((entry)=>entry.requirement.key===selectedRequirement))setSelectedRequirement(item.coverage.requirements[0]?.requirement.key??"");},[item,prepressUnitId,selectedRequirement]);
  const activeRequirementKey=selectedRequirement||item?.coverage.requirements[0]?.requirement.key||"";
  const requirement=item?.coverage.requirements.find((entry)=>entry.requirement.key===activeRequirementKey);
  const refresh=async()=>{await Promise.all([queryClient.invalidateQueries({queryKey:["v2",sessionScope,organizationId,"prepress","queue"]}),queryClient.invalidateQueries({queryKey:["v2",sessionScope,organizationId,"prepress","line"]})]);};
  const begin=useMutation({mutationFn:async(input:{assignmentId:string;prepressUnitId?:string})=>{const unitId=input.prepressUnitId??(await prepressApi.open(organizationId,newBusinessRequestId(),input.assignmentId)).unit.prepressUnitId;return prepressApi.start(organizationId,unitId,newBusinessRequestId());},onSuccess:refresh});
  const complete=useMutation({mutationFn:(id:string)=>prepressApi.complete(organizationId,id,newBusinessRequestId()),onSuccess:refresh});
  const handoff=useMutation({mutationFn:async(input:{unitIds:readonly string[];bulk:boolean})=>{
    if(!canSend)throw new Error("Production handoff requires Prepress completion, Routing advancement and Production work authority.");
    const saved=readHandoff(scopeKey);
    if(window.sessionStorage.getItem(scopeKey)!==null&&!saved)throw new Error("Saved handoff recovery data is invalid. Resolve the existing request before sending new work.");
    if(saved&&handoffRef.current?.scopeKey===scopeKey&&!sameHandoff(saved,handoffRef.current)){
      handoffRef.current=saved;setPendingHandoff(saved);setRollback(undefined);
      throw new Error("A newer saved handoff is pending. Retry that exact request before sending different work.");
    }
    let intent=saved??(handoffRef.current?.scopeKey===scopeKey?handoffRef.current:undefined);
    if(intent&&(intent.bulk!==input.bulk||JSON.stringify(intent.unitIds)!==JSON.stringify(input.unitIds)))throw new Error("Retry the pending exact handoff before sending different work.");
    if(!intent){
      if(!input.unitIds.length||input.unitIds.length>PREPRESS_BULK_HANDOFF_MAX)throw new Error("Select between 1 and 50 Prepress units.");
      intent={scopeKey,businessRequestId:newBusinessRequestId(),unitIds:[...input.unitIds],bulk:input.bulk};
    }
    try {window.sessionStorage.setItem(scopeKey,JSON.stringify(intent));}catch{throw new Error("Recovery storage is unavailable. Handoff was not sent; enable session storage before continuing.");}
    handoffRef.current=intent;setPendingHandoff(intent);setRollback(undefined);
    let handoffs;
    try {
      handoffs=intent.bulk?(await prepressApi.sendManyToProduction(organizationId,intent.unitIds,intent.businessRequestId)).handoffs:[await prepressApi.sendToProduction(organizationId,intent.unitIds[0]!,intent.businessRequestId)];
    } catch(cause) {
      const code=(cause as Partial<ApiError>|null)?.code;
      // Auth denials and generic validation errors do not establish whether an
      // earlier ambiguous attempt committed. Only owner rollback conflicts do.
      if(apiResponseStatus(cause)===409&&(code==="CONFLICT"||code==="STALE_STATE")&&mounted.current&&contextRef.current===scopeKey&&sameHandoff(readHandoff(scopeKey),intent))setRollback({intent,code});
      throw cause;
    }
    if(handoffs.length!==intent.unitIds.length||handoffs.some((result)=>!intent.unitIds.includes(result.unit?.prepressUnitId)||result.unit.organizationId!==organizationId||!(result.destination==="flatbed"||result.destination==="roll")||!result.productionWorkIds?.length||result.productionWorkIds.some((id)=>typeof id!=="string"||!id.trim()))||new Set(handoffs.map((result)=>result.unit.prepressUnitId)).size!==intent.unitIds.length)throw new Error("Production handoff response could not be confirmed. Retry the same saved request.");
    const cleared=sameHandoff(readHandoff(scopeKey),intent);
    if(cleared)window.sessionStorage.removeItem(scopeKey);
    return {scopeKey,handoffs,intent,cleared};
  },onSuccess:async(result)=>{
    if(!mounted.current||contextRef.current!==result.scopeKey)return;
    const saved=readHandoff(result.scopeKey);
    if(!result.cleared||saved||!sameHandoff(handoffRef.current,result.intent)){handoffRef.current=saved;setPendingHandoff(saved);setRollback(undefined);return;}
    handoffRef.current=undefined;setPendingHandoff(undefined);setRollback(undefined);setSelectedUnitIds(new Set());
    await refresh();
    if(mounted.current&&contextRef.current===result.scopeKey)onProductionReady?.(result.handoffs);
  }});
  const resolveRejectedHandoff=useMutation({mutationFn:async(intent:HandoffIntent)=>{
    if(!canSend||handoff.isPending||!rollback||!sameHandoff(rollback.intent,intent))throw new Error("Only an authorized, confirmed owner rollback can release this saved handoff.");
    if(!sameHandoff(readHandoff(scopeKey),intent))throw new Error("The saved handoff changed. Do not clear a newer request.");
    window.sessionStorage.removeItem(scopeKey);
    return intent;
  },onSuccess:async(intent)=>{
    if(!mounted.current||contextRef.current!==intent.scopeKey)return;
    const saved=readHandoff(intent.scopeKey);handoffRef.current=saved;setPendingHandoff(saved);setRollback(undefined);setSelectedUnitIds(new Set());handoff.reset();await refresh();
  }});
  const sendToProduction={...handoff,mutate:(id:string)=>handoff.mutate({unitIds:[id],bulk:false})};
  const sendManyToProduction={...handoff,mutate:(ids:readonly string[])=>handoff.mutate({unitIds:ids,bulk:true})};
  const groups=new Map<string,PrepressQueueItem[]>();for(const entry of filtered)groups.set(entry.orderId,[...(groups.get(entry.orderId)??[]),entry]);
  const productionArtwork=item?.operational?.productionArtwork??[]; const suppliedArtwork=item?.operational?.sourceArtwork??[];
  const selectedUnit=prepressUnitId?requirement?.prepressUnits.find((unit)=>unit.prepressUnitId===prepressUnitId):requirement?.prepressUnits.find((unit)=>unit.reworkCycleId)||requirement?.prepressUnits[0]; const candidates=requirement?.artworkAssignmentIds??[];
  const artworkSelection=requirement?resolvePrepressProductionArtwork(requirement,productionArtwork):undefined;
  const currentProductionArtwork=artworkSelection?.kind==="selected"?artworkSelection.artwork:undefined;
  const artworkSelectionBlocked=artworkSelection?.kind==="ambiguous"||artworkSelection?.kind==="missing"||artworkSelection?.kind==="identity_mismatch";
  const exactRequirement=Boolean(requirement&&item?.coverage.state==="configured"&&item.coverage.requirements.filter((entry)=>entry.requirement.key===requirement.requirement.key).length===1&&item.coverage.requirements.filter(({requirement:other})=>other.side===requirement.requirement.side&&other.sourcePageIndex===requirement.requirement.sourcePageIndex&&other.layerKey===requirement.requirement.layerKey&&other.layerOrder===requirement.requirement.layerOrder).length===1);
  const designateSource=useMutation({mutationFn:async(assignmentId:string)=>{
    if(!canView||!canWork||!canArtworkAssign)throw new Error("Source designation requires Prepress work and Artwork assignment authority.");
    const sources=suppliedArtwork.filter((entry)=>entry.artworkAssignmentId===assignmentId&&entry.purpose==="customer_supplied");
    if(!item||!requirement||!exactRequirement||sources.length!==1||artworkSelectionBlocked||candidates.length||currentProductionArtwork)throw new Error("An exact empty frozen production requirement and unambiguous customer source are required. Use the existing upload action for replacement.");
    const source=sources[0]!;
    const result=await artworkApi.assign(organizationId,source.artworkFileId,newBusinessRequestId(),{orderId:item.orderId,orderLineId:item.orderLineId,purpose:"production",...(requirement.requirement.side?{side:requirement.requirement.side}:{}),...(requirement.requirement.sourcePageIndex===undefined?{}:{sourcePageIndex:requirement.requirement.sourcePageIndex}),...(requirement.requirement.layerKey===undefined?{}:{layerKey:requirement.requirement.layerKey,layerOrder:requirement.requirement.layerOrder})},{requirementKey:requirement.requirement.key});
    const assigned=result.assignment;
    if(!assigned.id||result.artworkFile.id!==source.artworkFileId||assigned.artworkFileId!==source.artworkFileId||assigned.orderId!==item.orderId||assigned.orderLineId!==item.orderLineId||assigned.purpose!=="production"||assigned.side!==requirement.requirement.side||assigned.sourcePageIndex!==requirement.requirement.sourcePageIndex||assigned.layerKey!==requirement.requirement.layerKey||assigned.layerOrder!==requirement.requirement.layerOrder)throw new Error("Artwork owner response did not confirm the selected frozen requirement. Refresh before continuing.");
    return result;
  },onSuccess:refresh});
  const uploadProduction=useMutation({mutationFn:(file:File)=>{
    if(!canView||!canWork||!canArtworkAdopt)throw new Error("Production-art upload requires both Prepress work and Artwork adoption authority.");
    if(!item||!requirement)throw new Error("Select a production requirement before uploading Artwork.");
    if(!exactRequirement)throw new Error("The frozen production requirement identity is unavailable.");
    if(artworkSelectionBlocked)throw new Error(artworkSelectionMessage(artworkSelection!.kind)??"Production Artwork identity is unavailable.");
    return artworkApi.uploadProductionForPrepress(organizationId,newBusinessRequestId(),{orderId:item.orderId,orderLineId:item.orderLineId,...(requirement.requirement.side?{side:requirement.requirement.side}:{}),...(requirement.requirement.sourcePageIndex===undefined?{}:{sourcePageIndex:requirement.requirement.sourcePageIndex}),...(requirement.requirement.layerKey?{layerKey:requirement.requirement.layerKey,layerOrder:requirement.requirement.layerOrder}:{}),...(currentProductionArtwork?{supersedesArtworkAssignmentId:currentProductionArtwork.artworkAssignmentId}:{}),file});
  },onSuccess:refresh});
  const bulkUnit=(entry:PrepressQueueItem)=>entry.coverage.state!=="configured"||!entry.operational?.readiness.ready?undefined:entry.coverage.requirements.find((coverage)=>coverage.prepressComplete)?.prepressUnits.find((candidate)=>Boolean(candidate.completedAt));
  const selectableUnits=filtered.map(bulkUnit).filter((value):value is NonNullable<ReturnType<typeof bulkUnit>>=>Boolean(value)).slice(0,PREPRESS_BULK_HANDOFF_MAX);
  const allVisibleSelected=selectableUnits.length>0&&selectableUnits.every((entry)=>selectedUnitIds.has(entry.prepressUnitId));
  useEffect(()=>{if(selectVisibleRef.current)selectVisibleRef.current.indeterminate=selectedUnitIds.size>0&&!allVisibleSelected;},[selectedUnitIds,allVisibleSelected]);
  if(!organizationId)return <section className="v2-prepress"><div className="v2-proof-empty">Enter an authenticated organization in Sales before opening Prepress.</div></section>;
  if(!canView)return <section className="v2-prepress"><div className="v2-proof-empty">You do not have permission to view Prepress.</div></section>;
  const unavailable=Boolean((selectedLineId&&!pageItem&&(exactLine.isError||exactLine.isSuccess&&!exactItem))||(prepressUnitId&&(unit.isError||unit.isSuccess&&(unit.data.prepressUnitId!==prepressUnitId||Boolean(item&&item.coverage.state==="configured"&&!item.coverage.requirements.some((entry)=>entry.prepressUnits.some((candidate)=>candidate.prepressUnitId===prepressUnitId))))))); const selectLine=(next:string)=>{setSelectedLineId(next);onSelectLine?.(next);};
  const clearSelection=()=>setSelectedUnitIds(new Set());
  const selectView=(next:PrepressQueueRequirementState)=>{setRequirementState(next);setPage(1);setSelectedLineId("");setSelectedRequirement("");clearSelection();};
  const resetQueue=(update:()=>void)=>{update();setPage(1);setSelectedLineId("");setSelectedRequirement("");clearSelection();};
  return <section className="v2-prepress">
    <aside className="v2-prepress-queue">
    {pending&&<div role="status" className="v2-prepress-recovery-note">
      {rollback&&sameHandoff(rollback.intent,pending)?<><p>The owner rejected this exact atomic handoff ({rollback.code}); no handoff changes committed for this request. Refresh and correct its blockers, or release this rejected request to select other work.</p><button type="button" disabled={!canSend||handoff.isPending||resolveRejectedHandoff.isPending} onClick={()=>resolveRejectedHandoff.mutate(pending)}>Release rejected handoff and refresh</button></>:<p>A Production handoff response is unconfirmed for {pending.unitIds.length} saved unit(s). Retry the exact request; do not create another handoff.</p>}
      <button type="button" disabled={!canSend||handoff.isPending||resolveRejectedHandoff.isPending} onClick={()=>handoff.mutate({unitIds:pending.unitIds,bulk:pending.bulk})}>Retry saved Production handoff</button>{handoff.isError&&<p role="alert">{(handoff.error as Error).message}</p>}{resolveRejectedHandoff.isError&&<p role="alert">{(resolveRejectedHandoff.error as Error).message}</p>}
    </div>}
    <header><div><h2>Prepress Queue</h2><span>{queue.data?.pagination.totalCount??0} line items</span></div><input aria-label="Search Prepress queue" placeholder="Search order, customer, material…" value={query} onChange={(event)=>resetQueue(()=>setQuery(event.target.value))} /></header>
    <div className="v2-prepress-queue-views" role="group" aria-label="Prepress queue view">
      <button type="button" aria-pressed={requirementState==="configured"} onClick={()=>selectView("configured")}>Active work</button>
      <button type="button" aria-pressed={requirementState==="unconfigured"} onClick={()=>selectView("unconfigured")}>Needs configuration ({needsConfiguration.data?.pagination.totalCount??"…"})</button>
      <button type="button" aria-pressed={requirementState==="all"} onClick={()=>selectView("all")}>All routed work</button>
    </div>
    <div className="v2-prepress-queue-views" role="group" aria-label="Prepress queue filters">
      <label>Station<select aria-label="Filter Prepress station" value={destination} onChange={(event)=>resetQueue(()=>setDestination(event.target.value as PrepressQueueDestination))}><option value="all">All stations</option><option value="flatbed">Flatbed</option><option value="roll">Roll</option></select></label>
      <label>Readiness<select aria-label="Filter Prepress readiness" value={readiness} onChange={(event)=>resetQueue(()=>setReadiness(event.target.value as PrepressQueueReadiness))}><option value="all">All readiness</option><option value="ready">Ready to send</option><option value="blocked">Blocked</option></select></label>
    </div>
    {needsConfiguration.isError&&<p role="alert">The needs-configuration count is unavailable.</p>}
    {requirementState==="unconfigured"&&<p className="v2-prepress-recovery-note">These lines have no frozen production requirements and remain available for review. Open the Order to inspect its configuration and history.</p>}
    <OperationalQueuePager page={page} pageSize={pageSize} total={queue.data?.pagination.totalCount??0} totalPages={queue.data?.pagination.totalPages??0} onPage={(next)=>{setPage(next);setSelectedLineId("");clearSelection();}} onPageSize={(next)=>{setPageSize(next);setPage(1);setSelectedLineId("");clearSelection();}}/>
    {canSend&&<div className="v2-prepress-selection-bar"><label><input ref={selectVisibleRef} aria-label="Select visible ready Prepress work" type="checkbox" checked={allVisibleSelected} onChange={(event)=>{const checked=event.currentTarget.checked;setSelectedUnitIds((current)=>{const next=new Set(current);for(const unit of selectableUnits){if(checked){if(next.size<PREPRESS_BULK_HANDOFF_MAX)next.add(unit.prepressUnitId);}else next.delete(unit.prepressUnitId);}return next;});}}/> Select visible ready work</label><span>{selectedUnitIds.size} selected · limit {PREPRESS_BULK_HANDOFF_MAX}</span>{selectedUnitIds.size>0&&<><button type="button" className="v2-primary-button" disabled={Boolean(pending)||sendManyToProduction.isPending} onClick={()=>sendManyToProduction.mutate([...selectedUnitIds])}>{sendManyToProduction.isPending?"Sending…":`Send ${selectedUnitIds.size} to Production`}</button><button type="button" onClick={clearSelection}>Clear selection</button></>}</div>}
    {sendManyToProduction.isError&&<p className="v2-product-version-message" role="alert">{(sendManyToProduction.error as Error).message}</p>}
    <div className="v2-prepress-order-list">
      {[...groups.values()].map((lines)=>{const first=lines[0]!;return <section key={first.orderId} className="v2-prepress-order"><strong>{first.orderNumber}</strong><span>{first.customerDisplayName}{first.requestedDueDate?` · Due ${first.requestedDueDate.slice(0,10)}`:""}</span>{lines.map((line)=>{const selectable=bulkUnit(line);return <div key={line.orderLineId} className="v2-prepress-line-row">{canSend&&selectable&&<input aria-label={`Select ${line.lineDescription} for bulk Production handoff`} type="checkbox" checked={selectedUnitIds.has(selectable.prepressUnitId)} onChange={(event)=>{const checked=event.currentTarget.checked;setSelectedUnitIds((current)=>{const next=new Set(current);if(checked){if(next.size<PREPRESS_BULK_HANDOFF_MAX)next.add(selectable.prepressUnitId);}else next.delete(selectable.prepressUnitId);return next;});}}/>}<button className={line.orderLineId===activeLineId?"active":""} onClick={()=>selectLine(line.orderLineId)}><b>{line.lineDescription}</b><small>Qty {line.quantity}</small><span className="v2-prepress-artwork-cue" aria-label={line.operational?.productionArtwork[0]?"Production artwork attached":"No production artwork"}>{line.operational?.productionArtwork[0]?line.operational.productionArtwork[0].contentType.startsWith("image/")?"IMG":"PDF":"NO ART"}</span><div>{line.coverage.state==="unconfigured"?<em className="neutral">Requirements unconfigured</em>:line.coverage.requirements.map((coverage)=><em key={coverage.requirement.key} className={statusClass(state(coverage,line))}>{label(coverage.requirement)} · {state(coverage,line)}</em>)}</div></button></div>;})}</section>;})}
      {queue.isSuccess&&!filtered.length&&<p className="v2-proof-empty">{query?"No Prepress work matches this search.":requirementState==="unconfigured"?"No routed Prepress work needs configuration.":requirementState==="configured"?"No active Prepress work is available. Review Needs configuration for other routed lines.":"No routed Prepress work is available."}</p>}
    </div><OperationalQueuePager page={page} pageSize={pageSize} total={queue.data?.pagination.totalCount??0} totalPages={queue.data?.pagination.totalPages??0} onPage={(next)=>{setPage(next);setSelectedLineId("");clearSelection();}} onPageSize={(next)=>{setPageSize(next);setPage(1);setSelectedLineId("");clearSelection();}}/></aside>
    <main className="v2-prepress-main">{unavailable?<div className="v2-proof-empty">The selected Prepress work is unavailable in this organization.</div>:item?<><header className="v2-prepress-header"><div><span>{item.orderNumber} · {item.customerDisplayName}</span><h1>{item.lineDescription}</h1><p>{item.coverage.state==="configured"?"Required production units are frozen from the accepted configured product.":"Requirements are unconfigured. Review this line through its Order before production work can be prepared."}</p><div className="v2-prepress-context-links"><button onClick={()=>openOrder?.(item.orderId)}>Open Order</button>{item.customerId&&<button onClick={()=>openCustomer?.(item.customerId!)}>Open Customer</button>}</div></div><div className="v2-prepress-aggregate"><b>{item.coverage.state==="configured"?(item.coverage.allRequiredPrepressUnitsComplete?"All required Prepress complete":item.coverage.productionArtworkComplete?"Production Artwork covered":"Production Artwork missing"):"Requirements unconfigured"}</b><small>Routing: {item.routingStepKind??"not available"}</small></div></header>
      <div className="v2-prepress-art"><section><h2>Source / customer art</h2>{suppliedArtwork.length?suppliedArtwork.map((entry)=><article key={entry.artworkAssignmentId}><b>{entry.filename}{entry.side?` · ${entry.side}`:""}</b><small>{entry.contentType}</small><button onClick={()=>openArtwork?.(entry.artworkFileId)}>Open Artwork</button></article>):<p>No customer or reference Artwork attached.</p>}</section><section className="v2-prepress-production"><h2>Production art</h2>{item.coverage.state==="configured"?item.coverage.requirements.map((coverage)=><button key={coverage.requirement.key} className={coverage.requirement.key===activeRequirementKey?"active":""} onClick={()=>setSelectedRequirement(coverage.requirement.key)}><b>{label(coverage.requirement)}</b><span className={statusClass(state(coverage,item))}>{state(coverage,item)}</span><small>{coverage.productionArtworkCovered?`${coverage.artworkAssignmentIds.length} explicit production assignment${coverage.artworkAssignmentIds.length===1?"":"s"}`:"Production Artwork missing"}</small></button>):<p>Required production units are not configured for this line. Its existing Artwork and history remain available for review.</p>}{productionArtwork.length>0&&<p className="v2-prepress-art-summary">{productionArtwork.length} canonical production Artwork assignment{productionArtwork.length===1?"":"s"} on this line.</p>}</section></div>
      <section className="v2-prepress-viewer"><div><small>Production Art Preview</small><h2>{requirement?label(requirement.requirement):"Select a required unit"}</h2></div><div className="v2-prepress-canvas">{item.coverage.state==="unconfigured"?<><b>Requirements unconfigured</b><span>Open the Order to review this line before preparing production Artwork.</span></>:currentProductionArtwork?<><>{currentProductionArtwork.contentType.startsWith("image/")?<img alt={`Production Artwork ${currentProductionArtwork.filename}`} src={artworkApi.contentUrl(organizationId,currentProductionArtwork.artworkFileId)} />:<iframe title={`Production Artwork ${currentProductionArtwork.filename}`} src={artworkApi.contentUrl(organizationId,currentProductionArtwork.artworkFileId)} />}</><span>{currentProductionArtwork.filename} · {currentProductionArtwork.contentType}</span><button onClick={()=>openArtwork?.(currentProductionArtwork.artworkFileId)}>Open full Artwork</button></>:artworkSelectionBlocked?<><b>Production Artwork unavailable</b><span role="alert">{artworkSelectionMessage(artworkSelection!.kind)}</span></>:<><b>No production Artwork</b><span>This required unit remains visible; absence does not remove the requirement.</span></>}</div>{requirement&&<footer>{requirement.requirement.key} · {requirement.requirement.sourcePageIndex===undefined?"No page selection":`Page ${requirement.requirement.sourcePageIndex+1}`} {requirement.requirement.layerKey?`· ${requirement.requirement.layerKey} ${requirement.requirement.layerOrder!+1}`:""}</footer>}</section>
      <section className="v2-prepress-source-designation"><h2>Use an existing customer file for production</h2><p>Explicitly assign a customer-supplied file to the selected frozen side, page and layer. The original source assignment is retained; this does not approve a proof or complete Prepress.</p>
        {currentProductionArtwork||candidates.length>0?<p>Production art already exists. Source designation cannot replace it; use Replace production Artwork to preserve canonical replacement lineage.</p>:null}
        {suppliedArtwork.filter((entry)=>entry.purpose==="customer_supplied").map((entry)=><button type="button" key={entry.artworkAssignmentId} disabled={!canWork||!canArtworkAssign||!exactRequirement||suppliedArtwork.filter((candidate)=>candidate.artworkAssignmentId===entry.artworkAssignmentId).length!==1||artworkSelectionBlocked||candidates.length>0||Boolean(currentProductionArtwork)||designateSource.isPending} onClick={()=>{if(window.confirm(`Assign ${entry.filename} as production art for ${requirement?label(requirement.requirement):"the selected requirement"}? The customer source assignment will be retained. This does not approve proofing or complete Prepress.`))designateSource.mutate(entry.artworkAssignmentId);}}>Use {entry.filename} for {requirement?label(requirement.requirement):"selected requirement"}</button>)}
        {(!canWork||!canArtworkAssign)&&<p>Source designation requires both Prepress work and Artwork assignment authority.</p>}
        {designateSource.isError&&<p role="alert">{(designateSource.error as Error).message}</p>}
        {designateSource.isSuccess&&<p role="status">Production assignment recorded. The customer source remains attached.</p>}
      </section>
      <section className="v2-prepress-lower"><article><h2>Workflow boundary</h2><p>Prepress records preparation evidence only. Routing evaluates progression; Production owns execution.</p></article><article><h2>Artwork boundary</h2><p>Production Artwork remains Artwork-owned. This workspace uses canonical assignments and required side/page/layer facts.</p></article></section>
    </>:<div className="v2-proof-empty">{queue.isError?"The Prepress queue is unavailable.":queue.isSuccess?"Select a line to review Prepress work.":"Loading authenticated Prepress queue…"}</div>}</main>
    <aside className="v2-prepress-rail">{item&&!unavailable&&<>
      <section><small>Order line context</small><h2>{item.lineDescription}</h2><dl><div><dt>Order</dt><dd>{item.orderNumber}</dd></div><div><dt>Quantity</dt><dd>{item.quantity}</dd></div><div><dt>Customer</dt><dd>{item.customerDisplayName}</dd></div><div><dt>Due</dt><dd>{item.requestedDueDate?.slice(0,10)??"Not recorded"}</dd></div><div><dt>Material</dt><dd>{item.operational?.materials.length?item.operational.materials.join(", "):"Not configured"}</dd></div><div><dt>Destination</dt><dd>{item.operational?.productionDestination??"Unconfigured"}</dd></div><div><dt>Proof</dt><dd>{item.operational?.proof.state??"Not reported"}</dd></div></dl></section>
      <section><small>Routing prerequisite</small><p>{prerequisite(item)}</p></section>
      <section><small>Selected production unit</small><h2>{requirement?label(requirement.requirement):"No unit selected"}</h2>{requirement&&<dl><div><dt>Artwork</dt><dd>{requirement.productionArtworkCovered?"Covered":"Missing"}</dd></div><div><dt>Prepress</dt><dd>{state(requirement,item)}</dd></div><div><dt>Completion</dt><dd>{requirement.prepressComplete?"Recorded":"Not complete"}</dd></div></dl>}</section>
      {requirement&&<section className="v2-prepress-actions"><p>Readiness: {item.operational?.readiness.ready?"Ready to send":"Blocked"}</p>{item.operational?.readiness.blockers.map((blocker)=><p key={blocker} className="v2-product-version-message">{blockerMessage(blocker)}</p>)}
        <ArtworkAutoUploadDropzone label={currentProductionArtwork?"Replace production Artwork":"Upload production Artwork"} disabled={!canWork||!canArtworkAdopt||!exactRequirement||artworkSelectionBlocked} fileName={undefined} isUploading={uploadProduction.isPending} isSuccess={uploadProduction.isSuccess} error={uploadProduction.error} onFileSelected={(file)=>uploadProduction.mutate(file)} onRetry={undefined} />
        {(!canWork||!canArtworkAdopt)&&<p>Production-art upload requires both Prepress work and Artwork adoption authority.</p>}
        {candidates.length!==1?<p>Production Artwork needs one current canonical assignment for this unit before Prepress can start.</p>:!selectedUnit?<button className="v2-primary-button" disabled={!canWork||begin.isPending||item.routingStepKind!=="prepress"} onClick={()=>begin.mutate({assignmentId:candidates[0]!})}>Start Prepress</button>:!selectedUnit.startedAt?<button className="v2-primary-button" disabled={!canWork||begin.isPending} onClick={()=>begin.mutate({assignmentId:candidates[0]!,prepressUnitId:selectedUnit.prepressUnitId})}>Start Prepress</button>:!selectedUnit.completedAt?<button className="v2-primary-button" disabled={!canComplete||complete.isPending} onClick={()=>complete.mutate(selectedUnit.prepressUnitId)}>Complete Prepress</button>:<button className="v2-primary-button" disabled={!canSend||Boolean(pending)||!item.operational?.readiness.ready||sendToProduction.isPending} onClick={()=>sendToProduction.mutate(selectedUnit.prepressUnitId)}>{sendToProduction.isPending?"Sending…":`Send to ${item.operational?.productionDestination??"Production"}`}</button>}
        {begin.isError&&<p role="alert">{(begin.error as Error).message}</p>}{complete.isError&&<p role="alert">{(complete.error as Error).message}</p>}{sendToProduction.isError&&<p role="alert">{(sendToProduction.error as Error).message}</p>}
      </section>}
    </>}</aside>
  </section>;
};
