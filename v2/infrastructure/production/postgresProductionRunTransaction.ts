import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { PostgresOperationRequestRepository } from "../persistence/postgresOperationRequests.js";
import { V2ApplicationError } from "../../src/errors/applicationError.js";
import type { ProductionRunTransaction, ProductionRunTransactionRunner } from "../../src/modules/production/productionRunApplication.js";
import type { ProductionRun, ProductionRunAllocation, ProductionRunEvent } from "../../src/modules/production/productionRunApplication.js";
import { brandedId, canonicalJson, type OrganizationId, type ProductionRunId, type ProductionWorkId } from "../../src/modules/shared/commercialValues.js";
import { assertCompatibleRunMembers, canRefreshRunPreparation, preparedArtworkIsCurrent, type PreparedArtwork } from "../../src/modules/production/productionRuns.js";
import { PostgresProductionRecovery, requirePreparedProductionOutput, lockProductionRunMembership } from "./postgresProductionRecovery.js";
import { productionIntentFingerprint } from "../../src/modules/production/productionRecovery.js";

type CandidateRow={id:string;station_key:"flatbed"|"roll"|null;material_fingerprint:string|null;ordered_quantity:number;recorded_good_quantity:string;reserved_quantity:string;artwork_assignment_id:string;artwork_file_id:string;artwork_identity_fingerprint:string;artwork_object_version:string};
type RunRow={id:string;organization_id:string;station_key:"flatbed"|"roll";state:ProductionRun["state"];revision:number;material_fingerprint:string|null;layout_metadata:Record<string,unknown>};
type AllocationRow={id:string;production_work_id:string;allocated_quantity:number;good_quantity:number;waste_quantity:number;artwork_assignment_id:string;artwork_file_id:string;artwork_identity_fingerprint:string;artwork_object_version:string;production_attempt_id:string|null;position:number;released_at:Date|null;terminal_resolution:"successful"|"released"|"cancelled"|null};
type EventRow={id:string;sequence:number;event_kind:ProductionRunEvent["kind"];production_run_allocation_id:string|null;production_attempt_id:string|null;reason:string|null;note:string|null;created_at:Date;created_principal_kind:ProductionRunEvent["createdPrincipalKind"];created_principal_subject:string;created_staff_actor_user_id:string|null};
type RunWorkControlRow={id:string;production_destination:"flatbed"|"roll"|null;latest_control:"hold"|"resume"|"note"|"rework_requested"|"output_rejected"|null};
const allocation=(r:AllocationRow):ProductionRunAllocation=>({productionRunAllocationId:r.id,productionWorkId:brandedId<"ProductionWorkId">(r.production_work_id),allocatedQuantity:r.allocated_quantity,goodQuantity:r.good_quantity,wasteQuantity:r.waste_quantity,artworkAssignmentId:r.artwork_assignment_id,artworkFileId:r.artwork_file_id,artworkIdentityFingerprint:r.artwork_identity_fingerprint,artworkObjectVersion:r.artwork_object_version,...(r.production_attempt_id?{productionAttemptId:r.production_attempt_id}:{}),position:r.position,...(r.released_at?{releasedAt:r.released_at.toISOString()}:{}),...(r.terminal_resolution?{terminalResolution:r.terminal_resolution}:{})});
const event=(r:EventRow):ProductionRunEvent=>({productionRunEventId:r.id,sequence:r.sequence,kind:r.event_kind,...(r.production_run_allocation_id?{productionRunAllocationId:r.production_run_allocation_id}:{}),...(r.production_attempt_id?{productionAttemptId:r.production_attempt_id}:{}),...(r.reason?{reason:r.reason}:{}),...(r.note?{note:r.note}:{}),createdAt:r.created_at.toISOString(),createdPrincipalKind:r.created_principal_kind,createdPrincipalSubject:r.created_principal_subject,...(r.created_staff_actor_user_id?{createdStaffActorUserId:r.created_staff_actor_user_id}:{})});
const asRun=(row:RunRow,items:AllocationRow[],events:EventRow[]):ProductionRun=>({productionRunId:brandedId<"ProductionRunId">(row.id),organizationId:brandedId<"OrganizationId">(row.organization_id),stationKey:row.station_key,state:row.state,revision:row.revision,materialFingerprint:row.material_fingerprint,layoutMetadata:row.layout_metadata,allocations:items.map(allocation),events:events.map(event)});

export class PostgresProductionRunTransaction implements ProductionRunTransaction {
  private readonly requests=new PostgresOperationRequestRepository();
  constructor(private readonly client:PoolClient,private readonly exclusiveCreationApproved=false){}
  private async lockProductionWork(org:OrganizationId,workId:ProductionWorkId,stationKey?:"flatbed"|"roll",requireExecutable=false){
   const locked=await this.client.query<{id:string}>("SELECT w.id FROM v2_production_works w WHERE w.organization_id=$1 AND w.id=$2 FOR UPDATE OF w",[org,workId]);
   if(!locked.rows[0])throw Error("Production Run member work was not found.");
   const result=await this.client.query<RunWorkControlRow>(`SELECT w.id,COALESCE(cycle.destination_station_key,step.production_destination_station_key,e.production_destination,origin_attempt.station_key) production_destination,control.event_kind latest_control
     FROM v2_production_works w
     LEFT JOIN v2_production_rework_cycles cycle ON cycle.organization_id=w.organization_id AND cycle.id=w.rework_cycle_id
     LEFT JOIN v2_sales_line_workflow_exceptions e ON e.organization_id=w.organization_id AND e.order_line_id=w.order_line_id
     LEFT JOIN v2_route_instances ri ON ri.organization_id=w.organization_id AND ri.order_document_id=w.order_document_id AND ri.order_line_id=w.order_line_id
     LEFT JOIN v2_route_instance_steps step ON step.organization_id=ri.organization_id AND step.route_instance_id=ri.id AND step.id=ri.current_step_id AND step.step_kind='production'
     LEFT JOIN LATERAL (SELECT attempt.station_key FROM v2_production_attempts attempt WHERE attempt.organization_id=w.organization_id AND attempt.production_work_id=w.replacement_origin_production_work_id ORDER BY attempt.completed_at DESC NULLS LAST,attempt.sequence DESC LIMIT 1) origin_attempt ON TRUE
     LEFT JOIN LATERAL (SELECT event.event_kind FROM v2_production_work_events event WHERE event.organization_id=w.organization_id AND event.production_work_id=w.id AND event.event_kind NOT IN ('note','output_rejected') ORDER BY event.sequence DESC LIMIT 1) control ON TRUE
     WHERE w.organization_id=$1 AND w.id=$2`,[org,workId]);
   const row=result.rows[0];
   if(!row)throw Error("Production Run member work was not found.");
   if(requireExecutable&&(!row.production_destination||row.production_destination!==stationKey))throw Error("Production Run member no longer matches its frozen Production destination.");
   if(requireExecutable&&row.latest_control==="hold")throw Error("Production Run member work is held and must be resumed before execution.");
   if(requireExecutable&&row.latest_control==="rework_requested")throw Error("Production Run member is blocked pending Prepress rework.");
   return row;
  }
 async reserve(input:Parameters<ProductionRunTransaction["reserve"]>[0]){if(input.operation==="production.run.output.v1"){if(input.outputIntent){if(input.outputIntent.businessRequestId!==input.businessRequestId||productionIntentFingerprint(input.outputIntent)!==input.payloadFingerprint)throw new V2ApplicationError("VALIDATION_ERROR","Production output intent and request identity must match.");await PostgresProductionRecovery.prepareInTransaction(this.client,input,"production.run.output.v1",input.outputIntent);}await requirePreparedProductionOutput(this.client,input);}const result=await this.requests.reserve(this.client,input);return {kind:result.kind==="replay"?"replay" as const:"new" as const,requestId:result.request.id,resultJson:result.request.resultJson};}
 async succeed(org:string,id:string,result:ProductionRun){await this.requests.succeed(this.client,org,id,{resourceType:"production_run",resourceId:result.productionRunId,resultJson:result});}
   async lockCandidates(org:OrganizationId,ids:readonly ProductionWorkId[]){
    await lockProductionRunMembership(this.client);
   for(const id of [...new Set(ids)].sort())await this.client.query("SELECT w.id FROM v2_production_works w WHERE w.organization_id=$1 AND w.id=$2 FOR UPDATE OF w",[org,id]);
   const rows=await this.client.query<CandidateRow>(`SELECT w.id,COALESCE(cycle.destination_station_key,step.production_destination_station_key,e.production_destination,origin_attempt.station_key) station_key,
     (SELECT string_agg(mr.material_id||':'||mr.quantity_unit,',' ORDER BY mr.material_id,mr.quantity_unit) FROM v2_order_line_material_requirements mr WHERE mr.organization_id=w.organization_id AND mr.order_line_id=w.order_line_id) material_fingerprint,
    w.ordered_quantity,(v2_usable_production_good_quantity(w.organization_id,w.id)+COALESCE((SELECT sum(a.good_quantity) FROM v2_production_attempts a WHERE a.organization_id=w.organization_id AND a.production_work_id=w.id AND a.completed_at IS NULL),0))::text recorded_good_quantity,
    COALESCE((SELECT sum(ra.allocated_quantity-ra.good_quantity) FROM v2_production_run_allocations ra JOIN v2_production_runs r ON r.organization_id=ra.organization_id AND r.id=ra.production_run_id WHERE ra.organization_id=w.organization_id AND ra.production_work_id=w.id AND ra.released_at IS NULL AND r.state IN ('draft','ready','active','held')),0)::text reserved_quantity,
    w.artwork_assignment_id,w.artwork_file_id,a.identity_fingerprint artwork_identity_fingerprint,f.object_version artwork_object_version FROM v2_production_works w
    JOIN v2_artwork_assignments a ON a.organization_id=w.organization_id AND a.id=w.artwork_assignment_id AND a.artwork_file_id=w.artwork_file_id
     JOIN v2_artwork_files f ON f.organization_id=a.organization_id AND f.id=a.artwork_file_id
     LEFT JOIN v2_production_rework_cycles cycle ON cycle.organization_id=w.organization_id AND cycle.id=w.rework_cycle_id
     LEFT JOIN v2_sales_line_workflow_exceptions e ON e.organization_id=w.organization_id AND e.order_line_id=w.order_line_id
     LEFT JOIN v2_route_instances ri ON ri.organization_id=w.organization_id AND ri.order_document_id=w.order_document_id AND ri.order_line_id=w.order_line_id
     LEFT JOIN v2_route_instance_steps step ON step.organization_id=ri.organization_id AND step.route_instance_id=ri.id AND step.id=ri.current_step_id AND step.step_kind='production'
     LEFT JOIN LATERAL (SELECT attempt.station_key FROM v2_production_attempts attempt WHERE attempt.organization_id=w.organization_id AND attempt.production_work_id=w.replacement_origin_production_work_id ORDER BY attempt.completed_at DESC NULLS LAST,attempt.sequence DESC LIMIT 1) origin_attempt ON TRUE
     WHERE w.organization_id=$1 AND w.id=ANY($2::varchar[])
       AND COALESCE(cycle.destination_station_key,step.production_destination_station_key,e.production_destination,origin_attempt.station_key) IN ('flatbed','roll')
       AND NOT EXISTS(SELECT 1 FROM v2_production_attempts active WHERE active.organization_id=w.organization_id AND active.production_work_id=w.id AND active.completed_at IS NULL)
      ORDER BY w.id`,[org,ids]);
   return rows.rows.map(r=>{
    if(r.station_key!=="flatbed"&&r.station_key!=="roll")throw Error("Production Run candidate has no frozen Production destination.");
    return {productionWorkId:brandedId<"ProductionWorkId">(r.id),stationKey:r.station_key,materialFingerprint:r.material_fingerprint,orderedQuantity:r.ordered_quantity,recordedGoodQuantity:Number(r.recorded_good_quantity),reservedByOtherRuns:Number(r.reserved_quantity),artworkAssignmentId:r.artwork_assignment_id,artworkFileId:r.artwork_file_id,artworkIdentityFingerprint:r.artwork_identity_fingerprint,artworkObjectVersion:r.artwork_object_version};
   });
 }
   async create(input:Parameters<ProductionRunTransaction["create"]>[0]):Promise<ProductionRun>{
    if(!this.exclusiveCreationApproved)throw new V2ApplicationError("CONFLICT","Production Run creation remains disabled until exclusive membership is verified with a native two-client PostgreSQL test and reviewed approval.");
    const invariant=await this.client.query<{definition:string;valid:boolean;unique:boolean}>(`SELECT pg_get_indexdef(i.indexrelid) definition,i.indisvalid valid,i.indisunique unique FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid WHERE i.indrelid='v2_production_run_allocations'::regclass AND c.relname='v2_production_run_allocations_exclusive_active_uidx'`);
    const index=invariant.rows[0];
    if(!index?.valid||!index.unique||!/\(organization_id, production_work_id\) WHERE membership_active$/.test(index.definition))throw new V2ApplicationError("CONFLICT","Production Run exclusive membership invariant is unavailable.");
    const triggers=await this.client.query<{n:number}>(`SELECT count(*)::integer n FROM pg_trigger WHERE NOT tgisinternal AND tgenabled='O' AND ((tgrelid='v2_production_run_allocations'::regclass AND tgname IN ('v2_production_run_membership_bind_trigger','v2_production_run_membership_gate_allocations')) OR (tgrelid='v2_production_runs'::regclass AND tgname IN ('v2_production_run_membership_state_trigger','v2_production_run_membership_gate_runs')))`);
    if(triggers.rows[0]?.n!==4)throw new V2ApplicationError("CONFLICT","Production Run exclusive membership invariant triggers are unavailable.");
    const ids=input.members.map(member=>member.productionWorkId).sort();
    if(!ids.length||new Set(ids).size!==ids.length)throw new V2ApplicationError("VALIDATION_ERROR","Production Run members must be unique.");
    const existing=await this.lockRun(input.organizationId,input.id);
    for(const id of ids)await this.lockProductionWork(input.organizationId,id,input.stationKey,true);
    if(existing){
     if(existing.stationKey!==input.stationKey||existing.materialFingerprint!==input.materialFingerprint||canonicalJson(existing.layoutMetadata)!==canonicalJson(input.layoutMetadata)||existing.allocations.length!==ids.length||existing.allocations.some(member=>!ids.includes(member.productionWorkId)||member.allocatedQuantity!==input.quantities.get(member.productionWorkId)))throw new V2ApplicationError("IDEMPOTENCY_CONFLICT","Production Run identity was used for different members.");
     return existing;
    }
    const conflict=await this.client.query("SELECT ra.id FROM v2_production_run_allocations ra JOIN v2_production_runs r ON r.organization_id=ra.organization_id AND r.id=ra.production_run_id WHERE ra.organization_id=$1 AND ra.production_work_id=ANY($2::varchar[]) AND ra.released_at IS NULL AND r.state IN ('draft','ready','active','held') LIMIT 1",[input.organizationId,ids]);
    if(conflict.rows.length)throw new V2ApplicationError("CONFLICT","Production work already belongs to an active Production Run.");
    const current=await this.lockCandidates(input.organizationId,ids);
    if(current.length!==ids.length)throw new V2ApplicationError("CONFLICT","Production Run members are no longer available.");
    assertCompatibleRunMembers(input.stationKey,current.map(member=>({...member,requestedQuantity:input.quantities.get(member.productionWorkId)!})));
    for(const member of current){const frozen=input.members.find(item=>item.productionWorkId===member.productionWorkId)!;if(member.materialFingerprint!==input.materialFingerprint||!preparedArtworkIsCurrent({artworkAssignmentId:frozen.artworkAssignmentId,artworkFileId:frozen.artworkFileId,identityFingerprint:frozen.artworkIdentityFingerprint,objectVersion:frozen.artworkObjectVersion},{artworkAssignmentId:member.artworkAssignmentId,artworkFileId:member.artworkFileId,identityFingerprint:member.artworkIdentityFingerprint,objectVersion:member.artworkObjectVersion}))throw new V2ApplicationError("CONFLICT","Production Run preparation changed before creation.");}
    await this.client.query("INSERT INTO v2_production_runs(id,organization_id,station_key,material_fingerprint,layout_metadata,created_principal_kind,created_principal_subject,created_staff_actor_user_id) VALUES($1,$2,$3,$4,$5::jsonb,$6,$7,$8)",[input.id,input.organizationId,input.stationKey,input.materialFingerprint,JSON.stringify(input.layoutMetadata),input.principalKind,input.principalSubject,input.staffActorUserId??null]);
    await this.event({organizationId:input.organizationId,productionRunId:input.id,kind:"created",principalKind:input.principalKind,principalSubject:input.principalSubject,staffActorUserId:input.staffActorUserId});
    for(const [position,member] of current.entries()){
     const id=randomUUID();
     await this.client.query("INSERT INTO v2_production_run_allocations(id,organization_id,production_run_id,production_work_id,allocated_quantity,artwork_assignment_id,artwork_file_id,artwork_identity_fingerprint,artwork_object_version,position) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",[id,input.organizationId,input.id,member.productionWorkId,input.quantities.get(member.productionWorkId),member.artworkAssignmentId,member.artworkFileId,member.artworkIdentityFingerprint,member.artworkObjectVersion,position]);
     await this.event({organizationId:input.organizationId,productionRunId:input.id,kind:"allocation_reserved",productionRunAllocationId:id,principalKind:input.principalKind,principalSubject:input.principalSubject,staffActorUserId:input.staffActorUserId});
    }
    return (await this.lockRun(input.organizationId,input.id))!;
   }
  async lockRun(org:OrganizationId,id:ProductionRunId){await lockProductionRunMembership(this.client);const run=await this.client.query<RunRow>("SELECT id,organization_id,station_key,state,revision,material_fingerprint,layout_metadata FROM v2_production_runs WHERE organization_id=$1 AND id=$2 FOR UPDATE",[org,id]);if(!run.rows[0])return null;const [items,events]=await Promise.all([this.client.query<AllocationRow>("SELECT id,production_work_id,allocated_quantity,good_quantity,waste_quantity,artwork_assignment_id,artwork_file_id,artwork_identity_fingerprint,artwork_object_version,production_attempt_id,position,released_at,terminal_resolution FROM v2_production_run_allocations WHERE organization_id=$1 AND production_run_id=$2 ORDER BY position FOR UPDATE",[org,id]),this.client.query<EventRow>("SELECT id,sequence,event_kind,production_run_allocation_id,production_attempt_id,reason,note,created_at,created_principal_kind,created_principal_subject,created_staff_actor_user_id FROM v2_production_run_events WHERE organization_id=$1 AND production_run_id=$2 ORDER BY sequence,id",[org,id])]);return asRun(run.rows[0],items.rows,events.rows);}
 async list(org:OrganizationId,station?:"flatbed"|"roll"){const rows=await this.client.query<RunRow>(`SELECT id,organization_id,station_key,state,revision,material_fingerprint,layout_metadata FROM v2_production_runs WHERE organization_id=$1 ${station?"AND station_key=$2":""} ORDER BY created_at DESC,id DESC LIMIT 100`,station?[org,station]:[org]);return Promise.all(rows.rows.map(row=>this.lockRun(org,brandedId<"ProductionRunId">(row.id)).then(value=>value!)));}
 async orderIds(org:OrganizationId,id:ProductionRunId){const rows=await this.client.query<{order_document_id:string}>("SELECT DISTINCT w.order_document_id FROM v2_production_run_allocations ra JOIN v2_production_works w ON w.organization_id=ra.organization_id AND w.id=ra.production_work_id WHERE ra.organization_id=$1 AND ra.production_run_id=$2 ORDER BY w.order_document_id",[org,id]);return rows.rows.map(row=>brandedId<"OrderId">(row.order_document_id));}
  private async currentCandidatesForRun(org:OrganizationId,run:ProductionRun){
   for(const member of [...run.allocations].sort((left,right)=>left.productionWorkId.localeCompare(right.productionWorkId)))await this.lockProductionWork(org,member.productionWorkId);
   const rows=await this.client.query<{
    allocation_id:string;id:string;station_key:"flatbed"|"roll"|null;material_fingerprint:string|null;ordered_quantity:number;recorded_good_quantity:string;reserved_quantity:string;
    artwork_assignment_id:string;artwork_file_id:string;artwork_identity_fingerprint:string;artwork_object_version:string;allocated_quantity:number;
  }>(`SELECT ra.id allocation_id,current_work.id,COALESCE(cycle.destination_station_key,step.production_destination_station_key,e.production_destination,origin_attempt.station_key) station_key,
      (SELECT string_agg(mr.material_id||':'||mr.quantity_unit,',' ORDER BY mr.material_id,mr.quantity_unit) FROM v2_order_line_material_requirements mr WHERE mr.organization_id=current_work.organization_id AND mr.order_line_id=current_work.order_line_id) material_fingerprint,
      current_work.ordered_quantity,(v2_usable_production_good_quantity(current_work.organization_id,current_work.id)+COALESCE((SELECT sum(a.good_quantity) FROM v2_production_attempts a WHERE a.organization_id=current_work.organization_id AND a.production_work_id=current_work.id AND a.completed_at IS NULL),0))::text recorded_good_quantity,
      COALESCE((SELECT sum(other.allocated_quantity-other.good_quantity) FROM v2_production_run_allocations other JOIN v2_production_runs other_run ON other_run.organization_id=other.organization_id AND other_run.id=other.production_run_id WHERE other.organization_id=current_work.organization_id AND other.production_work_id=current_work.id AND other.production_run_id<>$3 AND other.released_at IS NULL AND other_run.state IN ('draft','ready','active','held')),0)::text reserved_quantity,
      current_art.id artwork_assignment_id,current_art.artwork_file_id,current_art.identity_fingerprint artwork_identity_fingerprint,current_file.object_version artwork_object_version,ra.allocated_quantity
    FROM v2_production_run_allocations ra
    JOIN v2_production_works prepared_work ON prepared_work.organization_id=ra.organization_id AND prepared_work.id=ra.production_work_id
    JOIN LATERAL (
      SELECT a.id,a.organization_id,a.artwork_file_id,a.identity_fingerprint
      FROM v2_current_artwork_assignments a
      WHERE a.organization_id=prepared_work.organization_id AND a.order_document_id=prepared_work.order_document_id AND a.order_line_id=prepared_work.order_line_id
        AND a.purpose='production' AND a.side IS NOT DISTINCT FROM prepared_work.side AND a.source_page_index IS NOT DISTINCT FROM prepared_work.source_page_index
        AND a.layer_key IS NOT DISTINCT FROM prepared_work.layer_key AND a.layer_order IS NOT DISTINCT FROM prepared_work.layer_order
        AND NOT EXISTS(SELECT 1 FROM v2_artwork_assignments successor WHERE successor.organization_id=a.organization_id AND successor.supersedes_artwork_assignment_id=a.id)
      ORDER BY a.created_at DESC,a.id DESC LIMIT 1
    ) current_art ON true
    JOIN v2_artwork_files current_file ON current_file.organization_id=current_art.organization_id AND current_file.id=current_art.artwork_file_id
     JOIN v2_production_works current_work ON current_work.organization_id=current_art.organization_id AND current_work.artwork_assignment_id=current_art.id
     LEFT JOIN v2_production_rework_cycles cycle ON cycle.organization_id=current_work.organization_id AND cycle.id=current_work.rework_cycle_id
     LEFT JOIN v2_sales_line_workflow_exceptions e ON e.organization_id=current_work.organization_id AND e.order_line_id=current_work.order_line_id
     LEFT JOIN v2_route_instances ri ON ri.organization_id=current_work.organization_id AND ri.order_document_id=current_work.order_document_id AND ri.order_line_id=current_work.order_line_id
     LEFT JOIN v2_route_instance_steps step ON step.organization_id=ri.organization_id AND step.route_instance_id=ri.id AND step.id=ri.current_step_id AND step.step_kind='production'
     LEFT JOIN LATERAL (SELECT attempt.station_key FROM v2_production_attempts attempt WHERE attempt.organization_id=current_work.organization_id AND attempt.production_work_id=current_work.replacement_origin_production_work_id ORDER BY attempt.completed_at DESC NULLS LAST,attempt.sequence DESC LIMIT 1) origin_attempt ON TRUE
     WHERE ra.organization_id=$1 AND ra.production_run_id=$2
       AND COALESCE(cycle.destination_station_key,step.production_destination_station_key,e.production_destination,origin_attempt.station_key) IN ('flatbed','roll')
      ORDER BY current_work.id,ra.position`,[org,run.productionRunId,run.productionRunId]);
   return rows.rows.map(row=>{
    if(row.station_key!=="flatbed"&&row.station_key!=="roll")throw Error("Production Run member has no frozen Production destination.");
    return {allocationId:row.allocation_id,productionWorkId:brandedId<"ProductionWorkId">(row.id),stationKey:row.station_key,materialFingerprint:row.material_fingerprint,orderedQuantity:row.ordered_quantity,recordedGoodQuantity:Number(row.recorded_good_quantity),reservedByOtherRuns:Number(row.reserved_quantity),requestedQuantity:row.allocated_quantity,artworkAssignmentId:row.artwork_assignment_id,artworkFileId:row.artwork_file_id,artworkIdentityFingerprint:row.artwork_identity_fingerprint,artworkObjectVersion:row.artwork_object_version};
   });
 }
 private async preparationIsCurrent(org:OrganizationId,run:ProductionRun){
  const current=await this.currentCandidatesForRun(org,run);
  if(current.length!==run.allocations.length)return false;
    return current.every(candidate=>{const prepared=run.allocations.find(allocation=>allocation.productionRunAllocationId===candidate.allocationId);return prepared!==undefined&&prepared.productionWorkId===candidate.productionWorkId&&candidate.stationKey===run.stationKey&&preparedArtworkIsCurrent({artworkAssignmentId:prepared.artworkAssignmentId,artworkFileId:prepared.artworkFileId,identityFingerprint:prepared.artworkIdentityFingerprint,objectVersion:prepared.artworkObjectVersion},{artworkAssignmentId:candidate.artworkAssignmentId,artworkFileId:candidate.artworkFileId,identityFingerprint:candidate.artworkIdentityFingerprint,objectVersion:candidate.artworkObjectVersion});});
 }
 async refreshPreparation(input:Parameters<ProductionRunTransaction["refreshPreparation"]>[0]){
  const run=await this.lockRun(input.organizationId,input.productionRunId);
  if(!run||!canRefreshRunPreparation(run.state))throw Error("Only a draft or ready Production Run can refresh preparation.");
  const current=await this.currentCandidatesForRun(input.organizationId,run);
  if(current.length!==run.allocations.length)throw Error("Current Production Artwork is not eligible for every Run allocation.");
  try{assertCompatibleRunMembers(run.stationKey,current);}catch(error){throw Error(error instanceof Error?error.message:"Production Run refresh compatibility failed.");}
  for(const candidate of current)await this.client.query("UPDATE v2_production_run_allocations SET production_work_id=$3,artwork_assignment_id=$4,artwork_file_id=$5,artwork_identity_fingerprint=$6,artwork_object_version=$7 WHERE organization_id=$1 AND id=$2",[input.organizationId,candidate.allocationId,candidate.productionWorkId,candidate.artworkAssignmentId,candidate.artworkFileId,candidate.artworkIdentityFingerprint,candidate.artworkObjectVersion]);
  await this.client.query("UPDATE v2_production_runs SET revision=revision+1 WHERE organization_id=$1 AND id=$2",[input.organizationId,input.productionRunId]);
  await this.event({organizationId:input.organizationId,productionRunId:input.productionRunId,kind:"artwork_refreshed",principalKind:input.principalKind,principalSubject:input.principalSubject,staffActorUserId:input.staffActorUserId});
  return (await this.lockRun(input.organizationId,input.productionRunId))!;
 }
  async transition(input:Parameters<ProductionRunTransaction["transition"]>[0]){
   const run=await this.lockRun(input.organizationId,input.productionRunId);
   if(!run)throw Error("Production Run was not found.");
   if(input.state==="completed"||input.state==="cancelled")for(const member of [...run.allocations].sort((left,right)=>left.productionWorkId.localeCompare(right.productionWorkId)))await this.lockProductionWork(input.organizationId,member.productionWorkId);
   if(input.state==="cancelled"){
   if(!input.reason)throw Error("A cancellation reason is required.");
   for(const member of run.allocations){
    if(member.goodQuantity>=member.allocatedQuantity||member.releasedAt)continue;
    await this.client.query("UPDATE v2_production_run_allocations SET released_at=now(),terminal_resolution='cancelled' WHERE organization_id=$1 AND id=$2 AND released_at IS NULL",[input.organizationId,member.productionRunAllocationId]);
    await this.event({organizationId:input.organizationId,productionRunId:input.productionRunId,kind:"member_released",productionRunAllocationId:member.productionRunAllocationId,reason:input.reason,principalKind:input.principalKind,principalSubject:input.principalSubject,staffActorUserId:input.staffActorUserId});
    await this.event({organizationId:input.organizationId,productionRunId:input.productionRunId,kind:"reservation_released",productionRunAllocationId:member.productionRunAllocationId,reason:input.reason,principalKind:input.principalKind,principalSubject:input.principalSubject,staffActorUserId:input.staffActorUserId});
   }
  }
  if(input.state==="completed")await this.client.query("UPDATE v2_production_run_allocations SET terminal_resolution='successful' WHERE organization_id=$1 AND production_run_id=$2 AND good_quantity>=allocated_quantity",[input.organizationId,input.productionRunId]);
   if(input.state==="completed"||input.state==="cancelled")await this.client.query("UPDATE v2_production_attempts a SET completed_at=now(),completed_principal_kind=$3,completed_principal_subject=$4,completed_staff_actor_user_id=$5,terminal_disposition=CASE WHEN ra.good_quantity>=ra.allocated_quantity THEN 'successful' ELSE CASE WHEN $6='cancelled' THEN 'cancelled' ELSE 'released' END END FROM v2_production_run_allocations ra WHERE ra.organization_id=$1 AND ra.production_run_id=$2 AND ra.production_work_id=a.production_work_id AND ra.production_attempt_id=a.id AND a.completed_at IS NULL",[input.organizationId,input.productionRunId,input.principalKind,input.principalSubject,input.staffActorUserId??null,input.state]);
  const timestamp=input.state==="ready"?"ready_at=now()":input.state==="active"?"started_at=COALESCE(started_at,now())":input.state==="completed"?"completed_at=now()":input.state==="cancelled"?"cancelled_at=now()":"";
  await this.client.query(`UPDATE v2_production_runs SET state=$3,revision=revision+1 ${timestamp?","+timestamp:""} WHERE organization_id=$1 AND id=$2`,[input.organizationId,input.productionRunId,input.state]);
  const kind=input.transition==="ready"?"ready":input.transition==="start"?"started":input.transition==="hold"?"held":input.transition==="resume"?"resumed":input.transition==="complete"?"completed":"cancelled";
  await this.event({organizationId:input.organizationId,productionRunId:input.productionRunId,kind,reason:input.reason,principalKind:input.principalKind,principalSubject:input.principalSubject,staffActorUserId:input.staffActorUserId});
  return (await this.lockRun(input.organizationId,input.productionRunId))!;
 }
  async start(input:Parameters<ProductionRunTransaction["start"]>[0]){const run=await this.lockRun(input.organizationId,input.productionRunId);if(!run||run.state!=="ready")throw Error("Only a ready Production Run can start.");if(!await this.preparationIsCurrent(input.organizationId,run))throw Error("STALE_RUN_PREPARATION");for(const member of [...run.allocations].sort((left,right)=>left.productionWorkId.localeCompare(right.productionWorkId))){await this.lockProductionWork(input.organizationId,member.productionWorkId,run.stationKey,true);const active=await this.client.query<{id:string}>("SELECT id FROM v2_production_attempts WHERE organization_id=$1 AND production_work_id=$2 AND completed_at IS NULL FOR UPDATE",[input.organizationId,member.productionWorkId]);if(active.rows[0])throw Error("A Run member already has an active Production attempt.");const n=await this.client.query<{n:string}>("SELECT coalesce(max(sequence),0)+1 n FROM v2_production_attempts WHERE organization_id=$1 AND production_work_id=$2",[input.organizationId,member.productionWorkId]);const id=randomUUID(),sequence=Number(n.rows[0]!.n);await this.client.query("INSERT INTO v2_production_attempts(id,organization_id,production_work_id,sequence,attempt_kind,station_key,started_principal_kind,started_principal_subject,started_staff_actor_user_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",[id,input.organizationId,member.productionWorkId,sequence,sequence===1?"initial":"reprint",run.stationKey,input.principalKind,input.principalSubject,input.staffActorUserId??null]);const linked=await this.client.query("UPDATE v2_production_run_allocations SET production_attempt_id=$3 WHERE organization_id=$1 AND id=$2 AND production_run_id=$4 AND production_work_id=$5 AND production_attempt_id IS NULL AND released_at IS NULL RETURNING id",[input.organizationId,member.productionRunAllocationId,id,input.productionRunId,member.productionWorkId]);if(!linked.rows[0])throw Error("Production Run allocation changed before its exact attempt could be linked.");await this.event({organizationId:input.organizationId,productionRunId:input.productionRunId,kind:"attempt_linked",productionRunAllocationId:member.productionRunAllocationId,productionAttemptId:id,principalKind:input.principalKind,principalSubject:input.principalSubject,staffActorUserId:input.staffActorUserId});}return this.transition({...input,state:"active",transition:"start"});}
 async release(input:Parameters<ProductionRunTransaction["release"]>[0]){
  const run=await this.lockRun(input.organizationId,input.productionRunId);
  if(!run||!(run.state==="active"||run.state==="held"))throw Error("Only an active or held Production Run can release an allocation.");
   const member=run.allocations.find(item=>item.productionRunAllocationId===input.productionRunAllocationId);
   if(!member||member.releasedAt||!member.productionAttemptId)throw Error("Production Run allocation is not releasable.");
   if(member.goodQuantity>=member.allocatedQuantity)throw Error("A fully produced allocation has no reservation to release.");
   await this.lockProductionWork(input.organizationId,member.productionWorkId);
   const linked=await this.client.query("SELECT id FROM v2_production_attempts WHERE organization_id=$1 AND id=$2 AND production_work_id=$3 AND completed_at IS NULL FOR UPDATE",[input.organizationId,member.productionAttemptId,member.productionWorkId]);
   if(!linked.rows[0])throw Error("Production Run allocation does not own an active attempt for this Production work.");
   const released=await this.client.query("UPDATE v2_production_run_allocations SET released_at=now(),terminal_resolution='released' WHERE organization_id=$1 AND id=$2 AND production_run_id=$3 AND production_work_id=$4 AND production_attempt_id=$5 AND released_at IS NULL RETURNING id",[input.organizationId,input.productionRunAllocationId,input.productionRunId,member.productionWorkId,member.productionAttemptId]);
   if(!released.rows[0])throw Error("Production Run allocation changed before it could be released.");
   await this.client.query("UPDATE v2_production_attempts SET completed_at=now(),completed_principal_kind=$4,completed_principal_subject=$5,completed_staff_actor_user_id=$6,terminal_disposition='released' WHERE organization_id=$1 AND id=$2 AND production_work_id=$3 AND completed_at IS NULL",[input.organizationId,member.productionAttemptId,member.productionWorkId,input.principalKind,input.principalSubject,input.staffActorUserId??null]);
  await this.event({organizationId:input.organizationId,productionRunId:input.productionRunId,kind:"member_released",productionRunAllocationId:member.productionRunAllocationId,productionAttemptId:member.productionAttemptId,reason:input.reason,principalKind:input.principalKind,principalSubject:input.principalSubject,staffActorUserId:input.staffActorUserId});
  await this.event({organizationId:input.organizationId,productionRunId:input.productionRunId,kind:"reservation_released",productionRunAllocationId:member.productionRunAllocationId,productionAttemptId:member.productionAttemptId,reason:input.reason,principalKind:input.principalKind,principalSubject:input.principalSubject,staffActorUserId:input.staffActorUserId});
  return (await this.lockRun(input.organizationId,input.productionRunId))!;
 }
 async output(input:Parameters<ProductionRunTransaction["output"]>[0]){
  const run=await this.lockRun(input.organizationId,input.productionRunId);
  if(!run||run.state!=="active")throw Error("Only an active Production Run can record output.");
   const member=run.allocations.find(item=>item.productionRunAllocationId===input.productionRunAllocationId);
   if(!member||member.releasedAt||!member.productionAttemptId)throw Error("Production Run allocation is not executable.");
   await this.lockProductionWork(input.organizationId,member.productionWorkId,run.stationKey,true);
   const linked=await this.client.query<{id:string}>("SELECT id FROM v2_production_attempts WHERE organization_id=$1 AND id=$2 AND production_work_id=$3 AND completed_at IS NULL FOR UPDATE",[input.organizationId,member.productionAttemptId,member.productionWorkId]);
   if(!linked.rows[0])throw Error("Production Run allocation attempt does not belong to this Production work or is no longer active.");
   const total=await this.client.query<{ordered_quantity:number;good:string}>("SELECT w.ordered_quantity,(v2_usable_production_good_quantity(w.organization_id,w.id)+COALESCE((SELECT sum(a.good_quantity) FROM v2_production_attempts a WHERE a.organization_id=w.organization_id AND a.production_work_id=w.id AND a.completed_at IS NULL),0))::text good FROM v2_production_works w WHERE w.organization_id=$1 AND w.id=$2",[input.organizationId,member.productionWorkId]);
   if(!total.rows[0])throw Error("Production Run member work was not found.");
   const globalRemaining=total.rows[0].ordered_quantity-Number(total.rows[0].good),allocationRemaining=member.allocatedQuantity-member.goodQuantity;
   if(input.goodQuantityDelta>Math.min(globalRemaining,allocationRemaining))throw Error("Output exceeds the allocation or remaining Production work.");
   const attemptUpdated=await this.client.query("UPDATE v2_production_attempts SET good_quantity=good_quantity+$4,waste_quantity=waste_quantity+$5 WHERE organization_id=$1 AND id=$2 AND production_work_id=$3 AND completed_at IS NULL RETURNING id",[input.organizationId,member.productionAttemptId,member.productionWorkId,input.goodQuantityDelta,input.wasteQuantityDelta]);
   if(!attemptUpdated.rows[0])throw Error("Production Run linked attempt changed before output could be recorded.");
   const allocationUpdated=await this.client.query("UPDATE v2_production_run_allocations SET good_quantity=good_quantity+$5,waste_quantity=waste_quantity+$6 WHERE organization_id=$1 AND id=$2 AND production_run_id=$3 AND production_work_id=$4 AND production_attempt_id=$7 AND released_at IS NULL RETURNING id",[input.organizationId,member.productionRunAllocationId,input.productionRunId,member.productionWorkId,input.goodQuantityDelta,input.wasteQuantityDelta,member.productionAttemptId]);
   if(!allocationUpdated.rows[0])throw Error("Production Run allocation changed before output could be recorded.");
  if(input.goodQuantityDelta>0)await this.event({organizationId:input.organizationId,productionRunId:input.productionRunId,kind:"good_output",productionRunAllocationId:member.productionRunAllocationId,productionAttemptId:member.productionAttemptId,principalKind:input.principalKind,principalSubject:input.principalSubject,staffActorUserId:input.staffActorUserId});
  if(input.wasteQuantityDelta>0)await this.event({organizationId:input.organizationId,productionRunId:input.productionRunId,kind:"waste_output",productionRunAllocationId:member.productionRunAllocationId,productionAttemptId:member.productionAttemptId,principalKind:input.principalKind,principalSubject:input.principalSubject,staffActorUserId:input.staffActorUserId});
  return (await this.lockRun(input.organizationId,input.productionRunId))!;
 }
  private async event(input:Readonly<{organizationId:string;productionRunId:string;kind:ProductionRunEvent["kind"];productionRunAllocationId?:string;productionAttemptId?:string;reason?:string;note?:string;principalKind:string;principalSubject:string;staffActorUserId?:string}>){
   await this.client.query(`INSERT INTO v2_production_run_events(organization_id,production_run_id,sequence,event_kind,production_run_allocation_id,production_attempt_id,reason,note,created_principal_kind,created_principal_subject,created_staff_actor_user_id)
     SELECT $1::varchar,$2::varchar,COALESCE(max(sequence),0)+1,$3::varchar,$4::varchar,$5::varchar,$6::varchar,$7::varchar,$8::varchar,$9::varchar,$10::varchar
     FROM v2_production_run_events WHERE organization_id=$1::varchar AND production_run_id=$2::varchar`,[input.organizationId,input.productionRunId,input.kind,input.productionRunAllocationId??null,input.productionAttemptId??null,input.reason??null,input.note??null,input.principalKind,input.principalSubject,input.staffActorUserId??null]);
 }
}
export class PostgresProductionRunTransactionRunner implements ProductionRunTransactionRunner {constructor(private readonly pool:Pool,private readonly exclusiveCreationApproved=false){}async transaction<T>(work:(tx:ProductionRunTransaction)=>Promise<T>){const client=await this.pool.connect();try{await client.query("BEGIN");const value=await work(new PostgresProductionRunTransaction(client,this.exclusiveCreationApproved));await client.query("COMMIT");return value;}catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}}}
