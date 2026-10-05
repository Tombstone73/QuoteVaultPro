import React, { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { newBusinessRequestId, productionApi, type ProductionRun, type ProductionWorkProjection } from "./api";
import { discoverProductionOutput, prepareProductionOutput, executeProductionOutput, type ProductionOutputReceipt } from "./productionRecoveryApi";

type PendingRunOutput = Readonly<{
 organizationId:string;sessionScope:string;productionRunId:string;allocationId:string;businessRequestId:string;submittedAt:string;
 input:Readonly<{goodQuantityDelta:number;wasteQuantityDelta:number}>;
}>;
type RunOutputRecoveryReason="scope-mismatch"|"other-handler"|"other-organization"|"storage-unavailable"|"malformed"|"persist-failed"|"cleanup-failed"|"owner-refresh-failed";
type RunOutputRecovery=
 |Readonly<{status:"ready";organizationId:string;sessionScope:string}>
 |Readonly<{status:"pending";organizationId:string;sessionScope:string;submission:PendingRunOutput}>
 |Readonly<{status:"blocked";organizationId:string;sessionScope:string;reason:RunOutputRecoveryReason}>;

const productionRunErrorMessage=(error:unknown):string=>{
 if(error instanceof Error)return error.message;
 if(typeof error==="object"&&error!==null&&"message" in error&&typeof (error as {message?:unknown}).message==="string")return (error as {message:string}).message;
 return "The Production Run response could not be confirmed.";
};
const isDefiniteRunOutputRejection=(error:unknown)=>typeof error==="object"&&error!==null&&"code" in error&&["CONFLICT","FORBIDDEN","NOT_FOUND","VALIDATION_ERROR"].includes(String((error as {code?:unknown}).code));
const runOutputRecoveryMessage=(reason:RunOutputRecoveryReason)=>reason==="other-organization"?"A saved Production output intent belongs to another organization. Its details are hidden; return to that owner scope before output can resume.":reason==="other-handler"?"An ordinary Production output intent is pending. Use the ordinary Production workspace to retry or reconcile; Run output is blocked.":reason==="scope-mismatch"?"A saved Production output intent belongs to another session. Its details are hidden; refresh Production state to reconcile before output can resume.":reason==="malformed"?"The saved Production output intent is missing or malformed. Refresh Production state to reconcile before output can resume.":reason==="storage-unavailable"?"Session storage could not verify the Production output intent. Refresh Production state to reconcile before output can resume.":reason==="persist-failed"?"The exact Production output request could not be saved and verified. No output request was sent; refresh Production state to reconcile.":reason==="owner-refresh-failed"?"Production owner state could not be refreshed. Output remains blocked until reconciliation succeeds.":"The saved Production output intent could not be safely cleared. Output remains blocked until reconciliation succeeds.";
const outputPresenceKey="ph.v2.production.pending-output-presence",outputIntentChangedEvent="ph.v2.production.output-intent-changed",ordinaryOutputPrefix="ph.v2.production.pending-output.",runOutputPrefix="ph.v2.production.pending-run-output.";
const notifyRunOutputIntentChanged=()=>{if(typeof window!=="undefined")window.dispatchEvent(new Event(outputIntentChangedEvent));};
type RunOutputFenceHost=typeof globalThis&{__phV2ProductionOutputFences?:Map<string,RunOutputRecoveryReason>};
const runOutputFences=((globalThis as RunOutputFenceHost).__phV2ProductionOutputFences??=new Map());
const runOutputFenceKey=(organizationId:string,sessionScope:string)=>`${organizationId}\u0000${sessionScope}`;
const runOutputFenceForOrganization=(organizationId:string)=>[...runOutputFences].find(([key])=>key.startsWith(`${organizationId}\u0000`))?.[1];
const clearRunOutputFencesForOrganization=(organizationId:string)=>{for(const key of runOutputFences.keys())if(key.startsWith(`${organizationId}\u0000`))runOutputFences.delete(key);};
const runOutputIntentKeys=()=>{const keys:string[]=[];for(let index=0;index<sessionStorage.length;index++){const key=sessionStorage.key(index);if(key?.startsWith(ordinaryOutputPrefix)||key?.startsWith(runOutputPrefix))keys.push(key);}return keys;};
const runOutputIntentOrganization=(key:string)=>{const prefix=key.startsWith(ordinaryOutputPrefix)?ordinaryOutputPrefix:key.startsWith(runOutputPrefix)?runOutputPrefix:"";return prefix?key.slice(prefix.length).split(".",1)[0]??"":"";};
const runExactKeys=(value:unknown,keys:readonly string[])=>typeof value==="object"&&value!==null&&!Array.isArray(value)&&Object.keys(value).sort().join("\u0000")===[...keys].sort().join("\u0000");
const pendingRunOutputKey=(organizationId:string,sessionScope:string)=>`${runOutputPrefix}${organizationId}.${sessionScope}`;
const parsePendingRunOutput=(raw:string,organizationId:string,sessionScope:string):PendingRunOutput|null=>{
 try{
  const value=JSON.parse(raw) as Partial<PendingRunOutput>|null;
  if(!value||!runExactKeys(value,["organizationId","sessionScope","productionRunId","allocationId","businessRequestId","submittedAt","input"]))return null;
  const input=value.input,good=input?.goodQuantityDelta,waste=input?.wasteQuantityDelta;
  if(typeof value.organizationId!=="string"||value.organizationId!==organizationId||typeof value.sessionScope!=="string"||value.sessionScope!==sessionScope||typeof value.productionRunId!=="string"||!value.productionRunId||typeof value.allocationId!=="string"||!value.allocationId||typeof value.businessRequestId!=="string"||!value.businessRequestId||typeof value.submittedAt!=="string"||!Number.isFinite(Date.parse(value.submittedAt))||new Date(value.submittedAt).toISOString()!==value.submittedAt||!runExactKeys(input,["goodQuantityDelta","wasteQuantityDelta"])||typeof good!=="number"||!Number.isSafeInteger(good)||good<0||typeof waste!=="number"||!Number.isSafeInteger(waste)||waste<0||(good===0&&waste===0))return null;
  const canonical:PendingRunOutput=Object.freeze({organizationId,sessionScope,productionRunId:value.productionRunId,allocationId:value.allocationId,businessRequestId:value.businessRequestId,submittedAt:value.submittedAt,input:Object.freeze({goodQuantityDelta:good,wasteQuantityDelta:waste})});
  return JSON.stringify(canonical)===raw?canonical:null;
 }catch{return null;}
};
const blockedRunRecovery=(organizationId:string,sessionScope:string,reason:RunOutputRecoveryReason):RunOutputRecovery=>({status:"blocked",organizationId,sessionScope,reason});
const readPendingRunOutput=(organizationId:string,sessionScope:string):RunOutputRecovery=>{
 const owner={organizationId,sessionScope},fenceKey=runOutputFenceKey(organizationId,sessionScope),fenced=runOutputFences.get(fenceKey)??runOutputFenceForOrganization(organizationId);
 if(fenced)return blockedRunRecovery(organizationId,sessionScope,fenced);
 try{
  const marker=sessionStorage.getItem(outputPresenceKey);
  if(marker!==null&&marker!==organizationId)return blockedRunRecovery(organizationId,sessionScope,"other-organization");
  const keys=runOutputIntentKeys();
  if(keys.length===0)return marker===organizationId?blockedRunRecovery(organizationId,sessionScope,"malformed"):{status:"ready",...owner};
  if(keys.length!==1)return blockedRunRecovery(organizationId,sessionScope,"malformed");
  const key=keys[0]!,intentOrganization=runOutputIntentOrganization(key);
  if(marker===null){if(!intentOrganization)return blockedRunRecovery(organizationId,sessionScope,"malformed");sessionStorage.setItem(outputPresenceKey,intentOrganization);if(sessionStorage.getItem(outputPresenceKey)!==intentOrganization)return blockedRunRecovery(organizationId,sessionScope,"storage-unavailable");}
  if(intentOrganization!==organizationId)return blockedRunRecovery(organizationId,sessionScope,"other-organization");
  if(key!==pendingRunOutputKey(organizationId,sessionScope))return blockedRunRecovery(organizationId,sessionScope,key===`${ordinaryOutputPrefix}${organizationId}.${sessionScope}`?"other-handler":"scope-mismatch");
  const raw=sessionStorage.getItem(key);if(raw===null)return blockedRunRecovery(organizationId,sessionScope,"malformed");
  const submission=parsePendingRunOutput(raw,organizationId,sessionScope);if(!submission)return blockedRunRecovery(organizationId,sessionScope,"malformed");
  return {status:"pending",...owner,submission};
 }catch{runOutputFences.set(fenceKey,"storage-unavailable");return blockedRunRecovery(organizationId,sessionScope,"storage-unavailable");}
};
const persistPendingRunOutput=(submission:PendingRunOutput):PendingRunOutput|null=>{
 const {organizationId,sessionScope}=submission,key=pendingRunOutputKey(organizationId,sessionScope),fenceKey=runOutputFenceKey(organizationId,sessionScope);
 try{
  if(readPendingRunOutput(organizationId,sessionScope).status!=="ready"||sessionStorage.getItem(outputPresenceKey)!==null||runOutputIntentKeys().length!==0)throw Error("Existing or unreadable output intent.");
  const serialized=JSON.stringify(submission);sessionStorage.setItem(outputPresenceKey,organizationId);
  if(sessionStorage.getItem(outputPresenceKey)!==organizationId)throw Error("Output presence marker readback failed.");
  sessionStorage.setItem(key,serialized);const readback=sessionStorage.getItem(key);
  if(readback!==serialized||!readback||!parsePendingRunOutput(readback,organizationId,sessionScope)||runOutputIntentKeys().length!==1||runOutputIntentKeys()[0]!==key)throw Error("Saved output request readback failed.");
  const verified=parsePendingRunOutput(readback,organizationId,sessionScope);if(!verified)throw Error("Saved output request did not parse canonically.");
  notifyRunOutputIntentChanged();return verified;
 }catch{runOutputFences.set(fenceKey,"persist-failed");notifyRunOutputIntentChanged();return null;}
};
const clearRunOutputIntentsAfterRefresh=(organizationId:string):boolean=>{
 try{
  const marker=sessionStorage.getItem(outputPresenceKey),keys=runOutputIntentKeys();if(marker!==null&&marker!==organizationId||keys.some(key=>runOutputIntentOrganization(key)!==organizationId))return false;
  for(const key of keys){sessionStorage.removeItem(key);if(sessionStorage.getItem(key)!==null)return false;}
  if(runOutputIntentKeys().length!==0)return false;
  if(marker===organizationId){sessionStorage.removeItem(outputPresenceKey);if(sessionStorage.getItem(outputPresenceKey)!==null)return false;}
  return true;
 }catch{return false;}
};
const clearConfirmedRunOutput=(submission:PendingRunOutput):boolean=>{
 try{
   const key=pendingRunOutputKey(submission.organizationId,submission.sessionScope),raw=sessionStorage.getItem(key);
   if(raw===null&&sessionStorage.getItem(outputPresenceKey)===null&&runOutputIntentKeys().length===0)return true;
  if(sessionStorage.getItem(outputPresenceKey)!==submission.organizationId||!raw||JSON.stringify(parsePendingRunOutput(raw,submission.organizationId,submission.sessionScope))!==JSON.stringify(submission))return false;
  const keys=runOutputIntentKeys();if(keys.length!==1||keys[0]!==key)return false;
  sessionStorage.removeItem(key);if(sessionStorage.getItem(key)!==null||runOutputIntentKeys().length!==0)return false;
  sessionStorage.removeItem(outputPresenceKey);return sessionStorage.getItem(outputPresenceKey)===null;
 }catch{return false;}
};
const refreshRunOwnerViews=async(organizationId:string)=>{
 const stations=["flatbed","roll"] as const;
 await Promise.all([
  ...stations.map(async station=>{const first=await productionApi.queue(organizationId,station,{page:1,pageSize:100});await Promise.all(Array.from({length:Math.max(0,first.pagination.totalPages-1)},(_,index)=>productionApi.queue(organizationId,station,{page:index+2,pageSize:100})));}),
  ...stations.map(station=>productionApi.runs(organizationId,station)),
 ]);
};

const eventLabel: Record<ProductionRun["events"][number]["kind"], string> = {
 created: "Run created", allocation_reserved: "Allocation reserved", ready: "Run ready", artwork_refreshed: "Artwork preparation refreshed", started: "Run started", attempt_linked: "Production attempt linked", good_output: "Good output recorded", waste_output: "Waste output recorded", held: "Run held", resumed: "Run resumed", member_released: "Member released", reservation_released: "Reservation released", cancelled: "Run cancelled", completed: "Run completed",
};

export function ProductionRunEventHistory({events}:{events:ProductionRun["events"]}){
 return <section className="v2-production-run-history" aria-label="Run history"><h4>Run history</h4>{!events.length?<p>No run events recorded.</p>:<ol>{events.map(event=><li key={event.productionRunEventId}><b>{eventLabel[event.kind]}</b><small>#{event.sequence} · {new Date(event.createdAt).toLocaleString()} · {event.createdPrincipalSubject}</small>{event.reason&&<span>Reason: {event.reason}</span>}{event.note&&<span>{event.note}</span>}</li>)}</ol>}</section>;
}

export function ProductionRunWorkspace({organizationId,sessionScope,station,queue,canWork,onOpenArtwork}:{organizationId:string;sessionScope:string;station:"flatbed"|"roll";queue:readonly ProductionWorkProjection[];canWork:boolean;onOpenArtwork:(fileId:string)=>void}){
  const client=useQueryClient(),key=["v2",sessionScope,organizationId,"production",station,"runs"],runs=useQuery({queryKey:key,queryFn:()=>productionApi.runs(organizationId,station),retry:false});
  const scopeKey=`${organizationId}\u0000${sessionScope}`;
  const currentScope=useRef(scopeKey);currentScope.current=scopeKey;
  const admissionEpoch=useRef(0);
  useEffect(()=>{currentScope.current=scopeKey;return()=>{currentScope.current="";admissionEpoch.current++;};},[scopeKey]);
  const durableOutput=useQuery({queryKey:["v2",sessionScope,organizationId,"production","run-output-recovery"],queryFn:({signal})=>discoverProductionOutput(organizationId,sessionScope,"production.run.output.v1",undefined,signal),enabled:canWork,retry:false});
  const [reviewedReceipt,setReviewedReceipt]=useState("");
  const [selected,setSelected]=useState<string[]>([]),[selectedScope,setSelectedScope]=useState(scopeKey),[active,setActive]=useState<ProductionRun|null>(null),[activeScope,setActiveScope]=useState<string|null>(null),[good,setGood]=useState("0"),[waste,setWaste]=useState("0"),[outputRecovery,setOutputRecovery]=useState<RunOutputRecovery>(()=>readPendingRunOutput(organizationId,sessionScope)),[outputRecoveryBusy,setOutputRecoveryBusy]=useState(false);
  const latestReceipt=canWork&&!durableOutput.isError&&activeScope===scopeKey?durableOutput.data?.find(receipt=>receipt.productionRunId===active?.productionRunId&&Boolean(active?.allocations.some(member=>member.productionRunAllocationId===receipt.productionRunAllocationId&&member.productionWorkId===receipt.productionWorkId&&(member as typeof member&{productionAttemptId?:string}).productionAttemptId===receipt.productionAttemptId))):undefined;
  const durableOutputBlocked=canWork&&(durableOutput.isPending||durableOutput.isError||Boolean(latestReceipt&&reviewedReceipt!==`${scopeKey}:${latestReceipt.businessRequestId}`));
  const recoveryScopeMatches=outputRecovery.organizationId===organizationId&&outputRecovery.sessionScope===sessionScope;
   const pendingOutput=canWork&&!durableOutput.isError&&recoveryScopeMatches&&outputRecovery.status==="pending"?outputRecovery.submission:null;
   const outputRecoveryBlocked=durableOutputBlocked||!recoveryScopeMatches||outputRecovery.status!=="ready";
  const outputFieldsHidden=!recoveryScopeMatches||outputRecovery.status==="blocked";
  const selectedForScope=selectedScope===scopeKey?selected:[];
   const displayedActive=activeScope===scopeKey&&recoveryScopeMatches&&outputRecovery.status!=="blocked"?active:null;
   useEffect(()=>{const receipt=latestReceipt;if(!receipt?.intent||receipt.intentRedacted||receipt.status!=="pending"||outputRecovery.status!=="ready"||!recoveryScopeMatches||!receipt.productionRunId||!receipt.productionRunAllocationId)return;setOutputRecovery({status:"pending",organizationId,sessionScope,submission:{organizationId,sessionScope,productionRunId:receipt.productionRunId,allocationId:receipt.productionRunAllocationId,businessRequestId:receipt.businessRequestId,submittedAt:receipt.submittedAt,input:{goodQuantityDelta:receipt.intent.goodQuantityDelta,wasteQuantityDelta:receipt.intent.wasteQuantityDelta??0}}});},[latestReceipt,organizationId,sessionScope,outputRecovery.status,recoveryScopeMatches]);
  useEffect(()=>{const refreshRecovery=()=>setOutputRecovery(readPendingRunOutput(organizationId,sessionScope));setSelected([]);setSelectedScope(scopeKey);setActive(null);setActiveScope(null);setGood("0");setWaste("0");refreshRecovery();window.addEventListener(outputIntentChangedEvent,refreshRecovery);return()=>window.removeEventListener(outputIntentChangedEvent,refreshRecovery);},[organizationId,sessionScope]);
 const selectable=useMemo(()=>queue.filter(item=>!item.unitQuantitySatisfied&&item.state==="ready"&&!item.activeAttempt),[queue]);
 const refresh=async()=>{await Promise.all([client.invalidateQueries({queryKey:key}),client.invalidateQueries({queryKey:["v2",sessionScope,organizationId,"production",station,"queue"]})]);};
  const create=useMutation({mutationFn:()=>productionApi.createRun(organizationId,newBusinessRequestId(),{stationKey:station,members:selectedForScope.map(id=>{const item=selectable.find(x=>x.work.productionWorkId===id)!;return {productionWorkId:id,quantity:item.remainingGoodQuantity};})}),onSuccess:run=>{setActive(run);setActiveScope(scopeKey);setSelected([]);refresh();}});
  const transition=useMutation({mutationFn:(transition:"ready"|"start"|"hold"|"resume"|"complete"|"cancel")=>productionApi.transitionRun(organizationId,displayedActive!.productionRunId,newBusinessRequestId(),transition,transition==="cancel"?"Operator cancelled the Run from the station workspace.":undefined),onSuccess:run=>{setActive(run);setActiveScope(scopeKey);refresh();}});
   const output=useMutation({mutationFn:async(submission:PendingRunOutput)=>{
    const submittedScope=`${submission.organizationId}\u0000${submission.sessionScope}`;
    const epoch=admissionEpoch.current;
    const assertCurrent=()=>{if(currentScope.current!==submittedScope||admissionEpoch.current!==epoch)throw Error("Production Run output admission is inactive. The original intent remains pending.");};
    assertCurrent();
    const prepared=await prepareProductionOutput(submission.organizationId,submission.sessionScope,"production.run.output.v1",{...submission.input,businessRequestId:submission.businessRequestId,productionRunId:submission.productionRunId,productionRunAllocationId:submission.allocationId},assertCurrent);
    const run=await executeProductionOutput<ProductionRun>(submission.organizationId,submission.sessionScope,"production.run.output.v1",{productionRunId:submission.productionRunId,productionRunAllocationId:submission.allocationId},submission.businessRequestId,prepared.input,assertCurrent);return {run,epoch};
   },onSuccess:async(result,submission)=>{
    if(currentScope.current!==`${submission.organizationId}\u0000${submission.sessionScope}`||result.epoch!==admissionEpoch.current)return;
    await durableOutput.refetch();
    if(currentScope.current!==`${submission.organizationId}\u0000${submission.sessionScope}`||result.epoch!==admissionEpoch.current)return;
    if(clearConfirmedRunOutput(submission)){runOutputFences.delete(runOutputFenceKey(submission.organizationId,submission.sessionScope));notifyRunOutputIntentChanged();setOutputRecovery(readPendingRunOutput(submission.organizationId,submission.sessionScope));}else{runOutputFences.set(runOutputFenceKey(submission.organizationId,submission.sessionScope),"cleanup-failed");setOutputRecovery(blockedRunRecovery(submission.organizationId,submission.sessionScope,"cleanup-failed"));}
    setActive(result.run);setActiveScope(scopeKey);setGood("0");setWaste("0");await refresh();
   },onError:async(_error,submission)=>{if(currentScope.current===`${submission.organizationId}\u0000${submission.sessionScope}`)await durableOutput.refetch();}});
   const replayCommittedReceipt=async(receipt:ProductionOutputReceipt,assertCurrent:()=>void)=>{
    if(receipt.status!=="succeeded")return;
    if(!receipt.intent||!receipt.productionRunId||!receipt.productionRunAllocationId)throw Error("The exact committed Run input is unavailable for owner repair.");
    const prepared=await prepareProductionOutput(organizationId,sessionScope,"production.run.output.v1",{...receipt.intent,productionRunId:receipt.productionRunId,productionRunAllocationId:receipt.productionRunAllocationId},assertCurrent);
    const run=await executeProductionOutput<ProductionRun>(organizationId,sessionScope,"production.run.output.v1",{productionRunId:receipt.productionRunId,productionRunAllocationId:receipt.productionRunAllocationId},receipt.businessRequestId,prepared.input,assertCurrent);
    assertCurrent();setActive(run);setActiveScope(scopeKey);
   };
   const reconcileOutputRecovery=async()=>{
    if(!recoveryScopeMatches||outputRecoveryBusy)return;
    const epoch=admissionEpoch.current;
    const assertCurrent=()=>{if(currentScope.current!==scopeKey||admissionEpoch.current!==epoch)throw Error("Run recovery admission is inactive; its intent remains recoverable.");};
   setOutputRecoveryBusy(true);
    try{
     if(!pendingOutput)throw Error("The exact original intent must be recovered before it can be cleared.");
      const [receipt]=await discoverProductionOutput(organizationId,sessionScope,"production.run.output.v1",pendingOutput.businessRequestId,undefined,assertCurrent);
      if(!receipt?.intent||receipt.status==="pending"||receipt.productionRunId!==pendingOutput.productionRunId||receipt.productionRunAllocationId!==pendingOutput.allocationId||receipt.intent.goodQuantityDelta!==pendingOutput.input.goodQuantityDelta||(receipt.intent.wasteQuantityDelta??0)!==pendingOutput.input.wasteQuantityDelta)throw Error("The original Run output result is not confirmed.");
     await replayCommittedReceipt(receipt,assertCurrent);
     await refreshRunOwnerViews(organizationId);
     assertCurrent();
    if(!clearRunOutputIntentsAfterRefresh(organizationId))throw Error("Saved output intent could not be reconciled in session storage.");
    clearRunOutputFencesForOrganization(organizationId);notifyRunOutputIntentChanged();
    const next=readPendingRunOutput(organizationId,sessionScope);setOutputRecovery(next);
    if(next.status!=="ready")return;
     output.reset();setReviewedReceipt(`${scopeKey}:${receipt.businessRequestId}`);await durableOutput.refetch();await refresh();
   }catch{if(currentScope.current===scopeKey&&admissionEpoch.current===epoch){runOutputFences.set(runOutputFenceKey(organizationId,sessionScope),"owner-refresh-failed");setOutputRecovery(blockedRunRecovery(organizationId,sessionScope,"owner-refresh-failed"));}}
   finally{if(currentScope.current===scopeKey&&admissionEpoch.current===epoch)setOutputRecoveryBusy(false);}
  };
  const outputInput=()=>({goodQuantityDelta:Number(good),wasteQuantityDelta:Number(waste)});
  const recoverOwnerReceipt=async()=>{
   if(!latestReceipt||outputRecoveryBusy)return;setOutputRecoveryBusy(true);
   const epoch=admissionEpoch.current;
   const assertCurrent=()=>{if(currentScope.current!==scopeKey||admissionEpoch.current!==epoch)throw Error("Run receipt admission is inactive; its intent remains recoverable.");};
   try{
    const [receipt]=await discoverProductionOutput(organizationId,sessionScope,"production.run.output.v1",latestReceipt.businessRequestId,undefined,assertCurrent);
    if(!receipt?.intent||!receipt.productionRunId||!receipt.productionRunAllocationId)throw Error("Historical exact Run intent is unavailable.");
    const marker=sessionStorage.getItem(outputPresenceKey),savedKeys=runOutputIntentKeys();
    let matchedSavedKey:string|undefined;
    if(marker!==null&&marker!==organizationId||savedKeys.length>1)throw Error("Another output intent remains fenced.");
    if(savedKeys.length){
     const savedKey=savedKeys[0]!,raw=sessionStorage.getItem(savedKey),scope=raw?JSON.parse(raw).sessionScope:undefined;
     const saved=raw&&typeof scope==="string"?parsePendingRunOutput(raw,organizationId,scope):null;
     if(!saved||savedKey!==pendingRunOutputKey(organizationId,saved.sessionScope)||saved.businessRequestId!==receipt.businessRequestId||saved.productionRunId!==receipt.productionRunId||saved.allocationId!==receipt.productionRunAllocationId||saved.input.goodQuantityDelta!==receipt.intent.goodQuantityDelta||saved.input.wasteQuantityDelta!==(receipt.intent.wasteQuantityDelta??0))throw Error("The stored Run intent does not match this authorized owner receipt.");
     matchedSavedKey=savedKey;
    }else if(marker!==null)throw Error("Unidentified output presence cannot be reconciled from another receipt.");
    await replayCommittedReceipt(receipt,assertCurrent);
    assertCurrent();
    if(matchedSavedKey){sessionStorage.removeItem(matchedSavedKey);if(sessionStorage.getItem(matchedSavedKey)!==null)throw Error("Exact Run intent cleanup failed.");}
    sessionStorage.removeItem(outputPresenceKey);if(sessionStorage.getItem(outputPresenceKey)!==null)throw Error("Exact Run marker cleanup failed.");
    clearRunOutputFencesForOrganization(organizationId);
    if(receipt.status==="pending"){
     const submission:PendingRunOutput={organizationId,sessionScope,productionRunId:receipt.productionRunId,allocationId:receipt.productionRunAllocationId,businessRequestId:receipt.businessRequestId,submittedAt:receipt.submittedAt,input:{goodQuantityDelta:receipt.intent.goodQuantityDelta,wasteQuantityDelta:receipt.intent.wasteQuantityDelta??0}};
     const persisted=persistPendingRunOutput(submission);if(!persisted)throw Error("Recovered Run intent persistence failed.");
     setOutputRecovery({status:"pending",organizationId,sessionScope,submission:persisted});
    }else{setOutputRecovery(readPendingRunOutput(organizationId,sessionScope));setReviewedReceipt(`${scopeKey}:${receipt.businessRequestId}`);}
    notifyRunOutputIntentChanged();await durableOutput.refetch();
   }catch{if(currentScope.current===scopeKey&&admissionEpoch.current===epoch){runOutputFences.set(runOutputFenceKey(organizationId,sessionScope),"owner-refresh-failed");setOutputRecovery(blockedRunRecovery(organizationId,sessionScope,"owner-refresh-failed"));}}
   finally{if(currentScope.current===scopeKey&&admissionEpoch.current===epoch)setOutputRecoveryBusy(false);}
  };
  const validOutput=()=>{const input=outputInput();return Number.isSafeInteger(input.goodQuantityDelta)&&input.goodQuantityDelta>=0&&Number.isSafeInteger(input.wasteQuantityDelta)&&input.wasteQuantityDelta>=0&&(input.goodQuantityDelta>0||input.wasteQuantityDelta>0);};
   const submitOutput=(allocationId:string)=>{if(durableOutputBlocked||!recoveryScopeMatches||outputRecovery.status!=="ready"||activeScope!==scopeKey||!displayedActive||!validOutput())return;const fresh=readPendingRunOutput(organizationId,sessionScope);if(fresh.status!=="ready"){setOutputRecovery(fresh);notifyRunOutputIntentChanged();return;}const submission:PendingRunOutput=Object.freeze({organizationId,sessionScope,productionRunId:displayedActive.productionRunId,allocationId,businessRequestId:newBusinessRequestId(),submittedAt:new Date().toISOString(),input:Object.freeze(outputInput())});const persisted=persistPendingRunOutput(submission);if(!persisted){setOutputRecovery(blockedRunRecovery(organizationId,sessionScope,"persist-failed"));return;}output.reset();setOutputRecovery({status:"pending",organizationId,sessionScope,submission:persisted});output.mutate(persisted);};
 const toggle=(id:string)=>setSelected(current=>current.includes(id)?current.filter(x=>x!==id):[...current,id].slice(0,50));
  return (
   <section className="v2-production-runs">
    <header>
     <div><small>{station} station</small><h2>Production Runs</h2><p>Runs reserve compatible canonical Production work; they never create fulfillment quantity.</p></div>
     <button disabled={!canWork||outputRecoveryBlocked||!selectedForScope.length||create.isPending} onClick={()=>create.mutate()}>Create Run ({selectedForScope.length})</button>
    </header>
     {recoveryScopeMatches&&create.error&&<p role="alert">{create.error.message}</p>}
     {canWork&&durableOutput.isError&&<p role="alert">Durable Production Run recovery is unavailable. No new physical output can be submitted.</p>}
     {latestReceipt&&<p>Owner receipt binding: Run {latestReceipt.productionRunId}; Allocation {latestReceipt.productionRunAllocationId??"not retained"}; Work {latestReceipt.productionWorkId??"not retained"}; Attempt {latestReceipt.productionAttemptId??"not retained"}.</p>}
      {latestReceipt&&<section aria-label="Durable Production Run output receipt"><p>Original request {latestReceipt.businessRequestId}: {latestReceipt.intent?`${latestReceipt.intent.goodQuantityDelta} good / ${latestReceipt.intent.wasteQuantityDelta??0} waste.`:latestReceipt.intentRedacted?"Submitted Run input is private to its initiating actor. Only protected status is shown; pending status is not a commitment.":latestReceipt.historicalIntentUnavailable?"Historical committed Run result recovered; exact submitted allocation/quantities were not retained and cannot be replayed.":"Exact Run input is unavailable; no commitment is inferred."} Owner recorded {latestReceipt.submittedAt}. Result: {latestReceipt.status}. {latestReceipt.rejection?.message}</p>{latestReceipt.intent&&<button type="button" disabled={outputRecoveryBusy} onClick={()=>void recoverOwnerReceipt()}>Recover this owner request</button>}{latestReceipt.status!=="pending"&&<button type="button" onClick={()=>setReviewedReceipt(`${scopeKey}:${latestReceipt.businessRequestId}`)}>I reviewed the owner output result</button>}</section>}
    {recoveryScopeMatches&&transition.error&&<p role="alert">{transition.error.message}</p>}
    {!recoveryScopeMatches&&<section role="alert" aria-label="Redacted Production Run output recovery"><p>A saved Production output intent is fenced to another scope. Its request details are hidden; physical output is blocked.</p>{outputRecovery.organizationId===organizationId&&<button disabled={!recoveryScopeMatches||outputRecoveryBusy} onClick={()=>void reconcileOutputRecovery()}>Refresh Production state to reconcile</button>}</section>}
    {recoveryScopeMatches&&outputRecovery.status==="blocked"&&<section role="alert" aria-label="Blocked Production Run output recovery"><p>{runOutputRecoveryMessage(outputRecovery.reason)} Details are hidden.</p>{outputRecovery.reason!=="other-organization"&&outputRecovery.reason!=="other-handler"&&<button disabled={outputRecoveryBusy} onClick={()=>void reconcileOutputRecovery()}>Refresh Production state to reconcile</button>}</section>}
    {pendingOutput&&<section role={output.error?"alert":"status"} aria-label="Pending Production Run output">
     <p>{output.error?`Output response was not confirmed: ${productionRunErrorMessage(output.error)}. `:"Output request is awaiting confirmation. "}Original request {pendingOutput.businessRequestId} for allocation {pendingOutput.allocationId} was submitted at {pendingOutput.submittedAt} with {pendingOutput.input.goodQuantityDelta} good and {pendingOutput.input.wasteQuantityDelta} waste.</p>
      <button type="button" disabled={outputRecoveryBusy} onClick={()=>void reconcileOutputRecovery()}>Look up original output result</button>
     <button type="button" disabled={output.isPending} onClick={()=>output.mutate(pendingOutput)}>Retry original output</button>
    </section>}
     {recoveryScopeMatches&&(outputRecovery.status!=="blocked"||outputRecovery.reason==="scope-mismatch")&&<div className="v2-production-run-grid">
     <article><h3>Available work</h3>{selectable.map(item=><label key={item.work.productionWorkId}><input type="checkbox" disabled={outputRecoveryBlocked} checked={selectedForScope.includes(item.work.productionWorkId)} onChange={()=>toggle(item.work.productionWorkId)}/><b>{item.operatorContext?.orderNumber??item.work.orderId}</b> · {item.operatorContext?.product?.displayName??"Production work"} · {item.remainingGoodQuantity} available</label>)}</article>
      <article><h3>Runs</h3>{runs.data?.map(run=><button className="v2-production-run-row" key={run.productionRunId} onClick={()=>{setActive(run);setActiveScope(scopeKey);}}><b>{run.productionRunId.slice(0,8)}</b><span>{run.state}</span><small>{run.allocations.length} members · {run.allocations.reduce((n,a)=>n+a.goodQuantity,0)}/{run.allocations.reduce((n,a)=>n+a.allocatedQuantity,0)}</small></button>)}</article>
    </div>}
    {displayedActive&&<article className="v2-production-run-detail">
     <header><div><small>Run {displayedActive.productionRunId}</small><h3>{displayedActive.state} · {displayedActive.stationKey}</h3></div><div>
      {displayedActive.state==="draft"&&<button disabled={outputRecoveryBlocked||transition.isPending} onClick={()=>transition.mutate("ready")}>Ready</button>}
      {displayedActive.state==="ready"&&<button disabled={outputRecoveryBlocked||transition.isPending} onClick={()=>transition.mutate("start")}>Start</button>}
      {displayedActive.state==="active"&&<><button disabled={outputRecoveryBlocked||transition.isPending} onClick={()=>transition.mutate("hold")}>Hold</button><button disabled={outputRecoveryBlocked||transition.isPending} onClick={()=>transition.mutate("cancel")}>Cancel / release remaining</button></>}
      {displayedActive.state==="held"&&<button disabled={outputRecoveryBlocked||transition.isPending} onClick={()=>transition.mutate("resume")}>Resume</button>}
     </div></header>
     {displayedActive.state==="active"&&<p><label>Good <input aria-label="Run good output" type="number" min="0" step="1" value={outputFieldsHidden?"":good} disabled={outputRecoveryBlocked||output.isPending} onChange={e=>setGood(e.target.value)}/></label><label>Waste <input aria-label="Run waste output" type="number" min="0" step="1" value={outputFieldsHidden?"":waste} disabled={outputRecoveryBlocked||output.isPending} onChange={e=>setWaste(e.target.value)}/></label></p>}
     <table><thead><tr><th>Work</th><th>Allocation</th><th>Good / waste</th><th>Artwork</th><th/></tr></thead><tbody>{displayedActive.allocations.map(member=><tr key={member.productionRunAllocationId}><td>{member.productionWorkId}</td><td>{member.allocatedQuantity} · remaining {member.allocatedQuantity-member.goodQuantity}</td><td>{member.goodQuantity} / {member.wasteQuantity}</td><td><button onClick={()=>onOpenArtwork(member.artworkFileId)}>Open artwork</button></td><td>{displayedActive.state==="active"&&<button disabled={!canWork||outputRecoveryBlocked||output.isPending||!validOutput()} onClick={()=>submitOutput(member.productionRunAllocationId)}>Record output</button>}</td></tr>)}</tbody></table>
     {displayedActive.state==="active"&&displayedActive.allocations.every(a=>a.goodQuantity>=a.allocatedQuantity||a.releasedAt)&&<button disabled={outputRecoveryBlocked||transition.isPending} onClick={()=>transition.mutate("complete")}>Complete Run</button>}
     <ProductionRunEventHistory events={displayedActive.events}/>
    </article>}
   </section>
  );
}
