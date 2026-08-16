import type { Pool, PoolClient } from "pg";
import { PostgresOperationRequestRepository } from "../persistence/postgresOperationRequests.js";
import type { PrepressTransaction, PrepressTransactionRunner } from "../../src/modules/prepress/prepressApplication.js";
import type { PrepressUnit } from "../../src/modules/prepress/contracts.js";
import { brandedId, type ArtworkAssignmentId, type OrderLineId, type OrganizationId, type PrepressUnitId } from "../../src/modules/shared/commercialValues.js";

type UnitRow = {
  id:string; organization_id:string; order_document_id:string; order_line_id:string; artwork_assignment_id:string; artwork_file_id:string;
  side:"front"|"back"|null; source_page_index:number|null; layer_key:string|null; layer_order:number|null;
  created_at:Date; created_principal_kind:PrepressUnit["createdPrincipalKind"]; created_principal_subject:string; created_staff_actor_user_id:string|null;
  started_at:Date|null; started_principal_kind:PrepressUnit["startedPrincipalKind"]|null; started_principal_subject:string|null; started_staff_actor_user_id:string|null;
  completed_at:Date|null; completed_principal_kind:PrepressUnit["completedPrincipalKind"]|null; completed_principal_subject:string|null; completed_staff_actor_user_id:string|null;
};
const unit = (r:UnitRow):PrepressUnit => ({
  prepressUnitId:brandedId<"PrepressUnitId">(r.id), organizationId:brandedId<"OrganizationId">(r.organization_id), orderId:brandedId<"OrderId">(r.order_document_id), orderLineId:brandedId<"OrderLineId">(r.order_line_id), artworkAssignmentId:brandedId<"ArtworkAssignmentId">(r.artwork_assignment_id), artworkFileId:brandedId<"ArtworkFileId">(r.artwork_file_id),
  ...(r.side?{side:r.side}:{}), ...(r.source_page_index===null?{}:{sourcePageIndex:r.source_page_index}), ...(r.layer_key===null?{}:{layerKey:r.layer_key}), ...(r.layer_order===null?{}:{layerOrder:r.layer_order}),
  createdAt:r.created_at.toISOString(), createdPrincipalKind:r.created_principal_kind, createdPrincipalSubject:r.created_principal_subject, ...(r.created_staff_actor_user_id?{createdStaffActorUserId:r.created_staff_actor_user_id}:{}),
  ...(r.started_at?{startedAt:r.started_at.toISOString(),startedPrincipalKind:r.started_principal_kind!,startedPrincipalSubject:r.started_principal_subject!,...(r.started_staff_actor_user_id?{startedStaffActorUserId:r.started_staff_actor_user_id}:{})}:{}),
  ...(r.completed_at?{completedAt:r.completed_at.toISOString(),completedPrincipalKind:r.completed_principal_kind!,completedPrincipalSubject:r.completed_principal_subject!,...(r.completed_staff_actor_user_id?{completedStaffActorUserId:r.completed_staff_actor_user_id}:{})}:{}),
});
export type PrepressPersistenceTestHooks=Readonly<{afterUnit?:()=>Promise<void>;afterStart?:()=>Promise<void>;afterComplete?:()=>Promise<void>;afterAudit?:()=>Promise<void>}>;
export class PostgresPrepressTransaction implements PrepressTransaction {
  private readonly requests=new PostgresOperationRequestRepository();
  constructor(private readonly client:PoolClient,private readonly hooks?:PrepressPersistenceTestHooks) {}
  async reserve(input:Parameters<PrepressTransaction["reserve"]>[0]){const r=await this.requests.reserve(this.client,input);return {kind:r.kind,request:{id:r.request.id,resultJson:r.request.resultJson}};}
  async succeed(org:string,id:string,result:Parameters<PrepressTransaction["succeed"]>[2]){await this.requests.succeed(this.client,org,id,{resourceType:"prepress_unit",resourceId:result.unit.prepressUnitId,resultJson:result});}
  async attribute(input:Parameters<PrepressTransaction["attribute"]>[0]){await this.requests.recordAttribution(this.client,{organizationId:input.organizationId,operationRequestId:input.requestId,operation:input.operation,resourceType:"prepress_unit",resourceId:input.resourceId,principalKind:input.principalKind,principalSubject:input.principalSubject,staffActorUserId:input.staffActorUserId});}
  async audit(input:Parameters<PrepressTransaction["audit"]>[0]){await this.client.query("INSERT INTO v2_audit_events(organization_id,operation_request_id,operation,event_type,resource_type,resource_id,principal_kind,principal_subject,staff_actor_user_id,changes) VALUES($1,$2,$3,$4,'prepress_unit',$5,$6,$7,$8,$9::jsonb)",[input.organizationId,input.requestId,input.operation,input.eventType,input.resourceId,input.principalKind,input.principalSubject,input.staffActorUserId??null,JSON.stringify([{kind:input.eventType,summary:input.summary}])]);await this.hooks?.afterAudit?.();}
  async findUnit(org:OrganizationId,id:PrepressUnitId){const r=await this.client.query<UnitRow>("SELECT * FROM v2_prepress_units WHERE organization_id=$1 AND id=$2",[org,id]);return r.rows[0]?unit(r.rows[0]):null;}
  async lockUnit(org:OrganizationId,id:PrepressUnitId){const r=await this.client.query<UnitRow>("SELECT * FROM v2_prepress_units WHERE organization_id=$1 AND id=$2 FOR UPDATE",[org,id]);return r.rows[0]?unit(r.rows[0]):null;}
  async listUnits(org:OrganizationId,line:OrderLineId){const r=await this.client.query<UnitRow>("SELECT * FROM v2_prepress_units WHERE organization_id=$1 AND order_line_id=$2 ORDER BY created_at,id",[org,line]);return r.rows.map(unit);}
  async eligibleProductionAssignment(org:OrganizationId,assignment:ArtworkAssignmentId){const r=await this.client.query<{valid:boolean}>(`SELECT EXISTS(
      SELECT 1 FROM v2_artwork_assignments a JOIN v2_route_instances ri ON ri.organization_id=a.organization_id AND ri.order_document_id=a.order_document_id AND ri.order_line_id=a.order_line_id
      JOIN v2_route_instance_steps rs ON rs.organization_id=ri.organization_id AND rs.route_instance_id=ri.id AND rs.id=ri.current_step_id
      WHERE a.organization_id=$1 AND a.id=$2 AND a.purpose='production' AND ri.route_state IN ('pending','active') AND rs.step_kind='prepress'
    ) valid`,[org,assignment]);return r.rows[0]?.valid===true;}
  async createOrGetUnit(input:Parameters<PrepressTransaction["createOrGetUnit"]>[0]){
    const r=await this.client.query<UnitRow>(`INSERT INTO v2_prepress_units(id,organization_id,order_document_id,order_line_id,artwork_assignment_id,artwork_file_id,side,source_page_index,layer_key,layer_order,created_principal_kind,created_principal_subject,created_staff_actor_user_id)
      SELECT $1,a.organization_id,a.order_document_id,a.order_line_id,a.id,a.artwork_file_id,a.side,a.source_page_index,a.layer_key,a.layer_order,$3,$4,$5 FROM v2_artwork_assignments a WHERE a.organization_id=$2 AND a.id=$6 AND a.purpose='production'
      ON CONFLICT(organization_id,artwork_assignment_id) DO NOTHING RETURNING *`,[input.id,input.organizationId,input.principalKind,input.principalSubject,input.staffActorUserId??null,input.artworkAssignmentId]);
    if(r.rows[0]){await this.hooks?.afterUnit?.();return unit(r.rows[0]);}
    const prior=await this.client.query<UnitRow>("SELECT * FROM v2_prepress_units WHERE organization_id=$1 AND artwork_assignment_id=$2 FOR UPDATE",[input.organizationId,input.artworkAssignmentId]);
    if(!prior.rows[0])throw Error("Prepress unit creation could not reload its authoritative row.");return unit(prior.rows[0]);
  }
  async startUnit(input:Parameters<PrepressTransaction["startUnit"]>[0]){const r=await this.client.query<UnitRow>("UPDATE v2_prepress_units SET started_at=now(),started_principal_kind=$3,started_principal_subject=$4,started_staff_actor_user_id=$5 WHERE organization_id=$1 AND id=$2 AND started_at IS NULL RETURNING *",[input.organizationId,input.prepressUnitId,input.principalKind,input.principalSubject,input.staffActorUserId??null]);if(!r.rows[0])throw Error("Prepress unit start was not available.");await this.hooks?.afterStart?.();return unit(r.rows[0]);}
  async completeUnit(input:Parameters<PrepressTransaction["completeUnit"]>[0]){const r=await this.client.query<UnitRow>("UPDATE v2_prepress_units SET completed_at=now(),completed_principal_kind=$3,completed_principal_subject=$4,completed_staff_actor_user_id=$5 WHERE organization_id=$1 AND id=$2 AND started_at IS NOT NULL AND completed_at IS NULL RETURNING *",[input.organizationId,input.prepressUnitId,input.principalKind,input.principalSubject,input.staffActorUserId??null]);if(!r.rows[0])throw Error("Prepress unit completion was not available.");await this.hooks?.afterComplete?.();return unit(r.rows[0]);}
}
export class PostgresPrepressTransactionRunner implements PrepressTransactionRunner {constructor(private readonly pool:Pool,private readonly hooks?:PrepressPersistenceTestHooks){}async transaction<T>(action:(tx:PrepressTransaction)=>Promise<T>):Promise<T>{const client=await this.pool.connect();try{await client.query("BEGIN");const result=await action(new PostgresPrepressTransaction(client,this.hooks));await client.query("COMMIT");return result;}catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}}}
