import { createHash, randomUUID } from "node:crypto";
import { requireOperationPrincipalScope, type OperationContext } from "../../application/operation.js";
import { AuthorityPolicy } from "../../authorization/authorityPolicy.js";
import { principalSubject, staffActorId } from "../../authorization/principals.js";
import { failure, success, type ApplicationResult, V2ApplicationError } from "../../errors/applicationError.js";
import { brandedId, canonicalJson, type OrderId, type OrganizationId, type ProductionRunId, type ProductionWorkId } from "../shared/commercialValues.js";
import { assertCompatibleRunMembers, canCompleteProductionRun, nextRunState, type ProductionRunState, type RunTransition } from "./productionRuns.js";
import type { ProductionStationKey } from "./contracts.js";
import type { OrderAutomaticLifecycle } from "../sales/orderAutomaticLifecycle.js";

type Actor=Readonly<{principalKind:OperationContext["principal"]["kind"];principalSubject:string;staffActorUserId?:string}>;
export type ProductionRunAllocation=Readonly<{productionRunAllocationId:string;productionWorkId:ProductionWorkId;allocatedQuantity:number;goodQuantity:number;wasteQuantity:number;artworkAssignmentId:string;artworkFileId:string;artworkIdentityFingerprint:string;artworkObjectVersion:string;productionAttemptId?:string;position:number;releasedAt?:string;terminalResolution?:"successful"|"released"|"cancelled"}>;
export type ProductionRunEvent=Readonly<{productionRunEventId:string;sequence:number;kind:"created"|"allocation_reserved"|"ready"|"artwork_refreshed"|"started"|"attempt_linked"|"good_output"|"waste_output"|"held"|"resumed"|"member_released"|"reservation_released"|"cancelled"|"completed";productionRunAllocationId?:string;productionAttemptId?:string;reason?:string;note?:string;createdAt:string;createdPrincipalKind:Actor["principalKind"];createdPrincipalSubject:string;createdStaffActorUserId?:string}>;
export type ProductionRun=Readonly<{productionRunId:ProductionRunId;organizationId:OrganizationId;stationKey:ProductionStationKey;state:ProductionRunState;revision:number;materialFingerprint:string|null;layoutMetadata:Readonly<Record<string,unknown>>;allocations:readonly ProductionRunAllocation[];events:readonly ProductionRunEvent[]}>;
export type CreateProductionRunInput=Readonly<{businessRequestId:string;stationKey:ProductionStationKey;members:readonly Readonly<{productionWorkId:ProductionWorkId;quantity:number}>[];layoutMetadata?:Readonly<Record<string,unknown>>}>;
type Candidate=Readonly<{productionWorkId:ProductionWorkId;stationKey:ProductionStationKey;materialFingerprint:string|null;orderedQuantity:number;recordedGoodQuantity:number;reservedByOtherRuns:number;artworkAssignmentId:string;artworkFileId:string;artworkIdentityFingerprint:string;artworkObjectVersion:string}>;
type Reservation=Readonly<{kind:"new"|"replay";requestId:string;resultJson:unknown|null}>;
export interface ProductionRunTransaction {
  reserve(input:Readonly<{organizationId:string;operation:string;businessRequestId:string;payloadFingerprint:string}&Actor>):Promise<Reservation>;
  succeed(organizationId:string,requestId:string,result:ProductionRun):Promise<void>;
  lockCandidates(organizationId:OrganizationId,ids:readonly ProductionWorkId[]):Promise<readonly Candidate[]>;
  create(input:Readonly<{id:ProductionRunId;organizationId:OrganizationId;stationKey:ProductionStationKey;materialFingerprint:string|null;layoutMetadata:Readonly<Record<string,unknown>>;members:readonly Candidate[];quantities:ReadonlyMap<string,number>}&Actor>):Promise<ProductionRun>;
  lockRun(organizationId:OrganizationId,id:ProductionRunId):Promise<ProductionRun|null>;
  list(organizationId:OrganizationId,station?:ProductionStationKey):Promise<readonly ProductionRun[]>;
  /** The owning Orders are read from canonical Production work, never supplied by a Run client. */
  orderIds(organizationId:OrganizationId,productionRunId:ProductionRunId):Promise<readonly OrderId[]>;
  transition(input:Readonly<{organizationId:OrganizationId;productionRunId:ProductionRunId;state:ProductionRunState;transition:RunTransition;reason?:string}&Actor>):Promise<ProductionRun>;
  start(input:Readonly<{organizationId:OrganizationId;productionRunId:ProductionRunId}&Actor>):Promise<ProductionRun>;
  refreshPreparation(input:Readonly<{organizationId:OrganizationId;productionRunId:ProductionRunId}&Actor>):Promise<ProductionRun>;
  release(input:Readonly<{organizationId:OrganizationId;productionRunId:ProductionRunId;productionRunAllocationId:string;reason:string}&Actor>):Promise<ProductionRun>;
  output(input:Readonly<{organizationId:OrganizationId;productionRunId:ProductionRunId;productionRunAllocationId:string;goodQuantityDelta:number;wasteQuantityDelta:number}&Actor>):Promise<ProductionRun>;
}
export interface ProductionRunTransactionRunner {transaction<T>(work:(tx:ProductionRunTransaction)=>Promise<T>):Promise<T>}
const actor=(c:OperationContext):Actor=>({principalKind:c.principal.kind,principalSubject:principalSubject(c.principal),...(staffActorId(c.principal)?{staffActorUserId:staffActorId(c.principal)}:{})});
const fingerprint=(input:unknown)=>`sha256:${createHash("sha256").update(canonicalJson(input)).digest("hex")}`;

/** A run orchestrates compatible work; it does not own production output. */
export class ProductionRunApplicationService {
  constructor(
    private readonly runner:ProductionRunTransactionRunner,
    private readonly authority=new AuthorityPolicy(),
    private readonly lifecycle?:OrderAutomaticLifecycle,
  ){}
  async create(c:OperationContext,input:CreateProductionRunInput):Promise<ApplicationResult<ProductionRun>> { return this.mutate(c,"production.run.create.v1",input,"production.run.create",async tx=>{
    if (!Array.isArray(input.members)||input.members.length<1||input.members.length>50) throw new V2ApplicationError("VALIDATION_ERROR","Select between one and fifty Production work items.");
    const ids=input.members.map(member=>member.productionWorkId).sort((a,b)=>a.localeCompare(b));
    if(new Set(ids).size!==ids.length) throw new V2ApplicationError("VALIDATION_ERROR","A Production work item cannot be selected twice.");
    const candidates=await tx.lockCandidates(brandedId<"OrganizationId">(c.organizationId),ids);
    if(candidates.length!==ids.length) throw new V2ApplicationError("NOT_FOUND","One or more Production work items are unavailable.");
    const quantities=new Map(input.members.map(member=>[member.productionWorkId as string,member.quantity]));
    const station=input.stationKey;
    try { assertCompatibleRunMembers(station,candidates.map(candidate=>({...candidate,requestedQuantity:quantities.get(candidate.productionWorkId)!}))); }
    catch(error){throw new V2ApplicationError("CONFLICT",error instanceof Error?error.message:"Production Run compatibility failed.");}
    return tx.create({id:brandedId<"ProductionRunId">(randomUUID()),organizationId:brandedId<"OrganizationId">(c.organizationId),stationKey:station,materialFingerprint:candidates[0]!.materialFingerprint,layoutMetadata:input.layoutMetadata??{},members:candidates,quantities,...actor(c)});
  });}
  async transition(c:OperationContext,input:Readonly<{businessRequestId:string;productionRunId:ProductionRunId;transition:RunTransition;reason?:string}>):Promise<ApplicationResult<ProductionRun>> {
    const result=await this.mutate(c,"production.run.transition.v1",input,"production.run.execute",async tx=>{
    const run=await tx.lockRun(brandedId<"OrganizationId">(c.organizationId),input.productionRunId); if(!run)throw new V2ApplicationError("NOT_FOUND","Production Run was not found.");
    const disposed=canCompleteProductionRun(run.allocations);
    let state:ProductionRunState; try {state=nextRunState(run.state,input.transition,disposed);}catch(error){throw new V2ApplicationError("CONFLICT",error instanceof Error?error.message:"Production Run transition failed.");}
    const reason=input.transition==="cancel"?requiredReason(input.reason,"A cancellation reason"):undefined;
    return input.transition==="start"?tx.start({organizationId:run.organizationId,productionRunId:run.productionRunId,...actor(c)}):tx.transition({organizationId:run.organizationId,productionRunId:run.productionRunId,state,transition:input.transition,...(reason?{reason}:{}),...actor(c)});
    });
    // A Run transition never mutates Order state directly. Terminal transitions
    // merely ask the same canonical lifecycle reconciler used by ordinary
    // Production to re-evaluate immutable attempt evidence after commit.
    if(result.ok&&(input.transition==="complete"||input.transition==="cancel"))await this.reconcile(result.value);
    return result;
  }
  async list(c:OperationContext,station?:ProductionStationKey):Promise<ApplicationResult<readonly ProductionRun[]>>{try{requireOperationPrincipalScope(c);if(!this.authority.decide(c.principal,{capability:"production.view",resource:{organizationId:c.organizationId}}).allowed)throw new V2ApplicationError("FORBIDDEN","The principal does not have authority to view Production Runs.");return success(await this.runner.transaction(tx=>tx.list(brandedId<"OrganizationId">(c.organizationId),station)));}catch(error){return failure(error instanceof V2ApplicationError?error:new V2ApplicationError("VALIDATION_ERROR","Production Runs are unavailable."));}}
  async get(c:OperationContext,id:ProductionRunId):Promise<ApplicationResult<ProductionRun>>{try{requireOperationPrincipalScope(c);const run=await this.runner.transaction(tx=>tx.lockRun(brandedId<"OrganizationId">(c.organizationId),id));if(!run)throw new V2ApplicationError("NOT_FOUND","Production Run was not found.");return success(run);}catch(error){return failure(error instanceof V2ApplicationError?error:new V2ApplicationError("VALIDATION_ERROR","Production Run is unavailable."));}}
  async recordOutput(c:OperationContext,input:Readonly<{businessRequestId:string;productionRunId:ProductionRunId;productionRunAllocationId:string;goodQuantityDelta:number;wasteQuantityDelta?:number}>):Promise<ApplicationResult<ProductionRun>>{
    const result=await this.mutate(c,"production.run.output.v1",input,"production.run.execute",async tx=>{if(!Number.isSafeInteger(input.goodQuantityDelta)||input.goodQuantityDelta<0||!Number.isSafeInteger(input.wasteQuantityDelta??0)||(input.wasteQuantityDelta??0)<0||input.goodQuantityDelta+(input.wasteQuantityDelta??0)===0)throw new V2ApplicationError("VALIDATION_ERROR","Output quantities must be non-negative whole units.");return tx.output({organizationId:brandedId<"OrganizationId">(c.organizationId),productionRunId:input.productionRunId,productionRunAllocationId:input.productionRunAllocationId,goodQuantityDelta:input.goodQuantityDelta,wasteQuantityDelta:input.wasteQuantityDelta??0,...actor(c)});});
    if(result.ok&&input.goodQuantityDelta>0)await this.reconcile(result.value);
    return result;
  }
  async releaseAllocation(c:OperationContext,input:Readonly<{businessRequestId:string;productionRunId:ProductionRunId;productionRunAllocationId:string;reason:string}>):Promise<ApplicationResult<ProductionRun>>{
    const result=await this.mutate(c,"production.run.release.v1",input,"production.run.execute",tx=>{const reason=requiredReason(input.reason,"A member release reason");return tx.release({organizationId:brandedId<"OrganizationId">(c.organizationId),productionRunId:input.productionRunId,productionRunAllocationId:input.productionRunAllocationId,reason,...actor(c)});});
    if(result.ok)await this.reconcile(result.value);
    return result;
  }
  async refreshPreparation(c:OperationContext,input:Readonly<{businessRequestId:string;productionRunId:ProductionRunId}>):Promise<ApplicationResult<ProductionRun>>{
    return this.mutate(c,"production.run.refresh-preparation.v1",input,"production.run.execute",tx=>tx.refreshPreparation({organizationId:brandedId<"OrganizationId">(c.organizationId),productionRunId:input.productionRunId,...actor(c)}));
  }
  private async reconcile(run:ProductionRun):Promise<void>{
    if(!this.lifecycle)return;
    const orderIds=await this.runner.transaction(tx=>tx.orderIds(run.organizationId,run.productionRunId));
    for(const orderId of orderIds)await this.lifecycle.reconcileOrder(run.organizationId,orderId);
  }
  private async mutate(c:OperationContext,operation:string,input:{businessRequestId:string},cap:"production.run.create"|"production.run.execute",work:(tx:ProductionRunTransaction)=>Promise<ProductionRun>):Promise<ApplicationResult<ProductionRun>>{try{requireOperationPrincipalScope(c);if(!this.authority.decide(c.principal,{capability:cap,resource:{organizationId:c.organizationId}}).allowed)throw new V2ApplicationError("FORBIDDEN","The principal does not have authority for this Production Run operation.");if(!c.businessRequest||c.businessRequest.id!==input.businessRequestId)throw new V2ApplicationError("VALIDATION_ERROR","A matching business request identity is required.");return success(await this.runner.transaction(async tx=>{const r=await tx.reserve({organizationId:c.organizationId,operation,businessRequestId:input.businessRequestId,payloadFingerprint:fingerprint(input),...actor(c)});if(r.kind==="replay")return r.resultJson as ProductionRun;const result=await work(tx);await tx.succeed(c.organizationId,r.requestId,result);return result;}));}catch(error){if(error instanceof Error&&error.message==="STALE_RUN_PREPARATION")return failure(new V2ApplicationError("CONFLICT","Production Run preparation is stale; refresh preparation before starting."));return failure(error instanceof V2ApplicationError?error:new V2ApplicationError("VALIDATION_ERROR",error instanceof Error?error.message:"Production Run operation failed."));}}
}
const requiredReason=(value:string|undefined,label:string)=>{const normalized=value?.trim();if(!normalized)throw new V2ApplicationError("VALIDATION_ERROR",`${label} is required.`);if(normalized.length>1_000)throw new V2ApplicationError("VALIDATION_ERROR",`${label} is too long.`);return normalized;};
