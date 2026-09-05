import type { Pool, PoolClient } from "pg";
import { PostgresOperationRequestRepository } from "../persistence/postgresOperationRequests.js";
import type { PrepressTransaction, PrepressTransactionRunner } from "../../src/modules/prepress/prepressApplication.js";
import type { OrderLinePrepressCoverage, PrepressQueueItem, PrepressQueuePageRequest, PrepressUnit } from "../../src/modules/prepress/contracts.js";
import type { ProductionUnitRequirement } from "../../src/modules/shared/productionRequirements.js";
import type { OperationalQueuePage } from "../../src/modules/shared/operationalQueue.js";
import { brandedId, type ArtworkAssignmentId, type OrderLineId, type OrganizationId, type PrepressUnitId } from "../../src/modules/shared/commercialValues.js";

type UnitRow = {
  id:string; organization_id:string; order_document_id:string; order_line_id:string; artwork_assignment_id:string; artwork_file_id:string;
  side:"front"|"back"|null; source_page_index:number|null; layer_key:string|null; layer_order:number|null;
  created_at:Date; created_principal_kind:PrepressUnit["createdPrincipalKind"]; created_principal_subject:string; created_staff_actor_user_id:string|null;
  started_at:Date|null; started_principal_kind:PrepressUnit["startedPrincipalKind"]|null; started_principal_subject:string|null; started_staff_actor_user_id:string|null;
  completed_at:Date|null; completed_principal_kind:PrepressUnit["completedPrincipalKind"]|null; completed_principal_subject:string|null; completed_staff_actor_user_id:string|null;
};
type RequirementRow={order_line_id:string;requirement_key:string;side:"front"|"back"|null;source_page_index:number|null;layer_key:string|null;layer_order:number|null};
type CoverageEvidenceRow=UnitRow & {coverage_order_line_id:string;requirement_key:string;artwork_assignment_id:string|null};
const unit = (r:UnitRow):PrepressUnit => ({
  prepressUnitId:brandedId<"PrepressUnitId">(r.id), organizationId:brandedId<"OrganizationId">(r.organization_id), orderId:brandedId<"OrderId">(r.order_document_id), orderLineId:brandedId<"OrderLineId">(r.order_line_id), artworkAssignmentId:brandedId<"ArtworkAssignmentId">(r.artwork_assignment_id), artworkFileId:brandedId<"ArtworkFileId">(r.artwork_file_id),
  ...(r.side?{side:r.side}:{}), ...(r.source_page_index===null?{}:{sourcePageIndex:r.source_page_index}), ...(r.layer_key===null?{}:{layerKey:r.layer_key}), ...(r.layer_order===null?{}:{layerOrder:r.layer_order}),
  createdAt:r.created_at.toISOString(), createdPrincipalKind:r.created_principal_kind, createdPrincipalSubject:r.created_principal_subject, ...(r.created_staff_actor_user_id?{createdStaffActorUserId:r.created_staff_actor_user_id}:{}),
  ...(r.started_at?{startedAt:r.started_at.toISOString(),startedPrincipalKind:r.started_principal_kind!,startedPrincipalSubject:r.started_principal_subject!,...(r.started_staff_actor_user_id?{startedStaffActorUserId:r.started_staff_actor_user_id}:{})}:{}),
  ...(r.completed_at?{completedAt:r.completed_at.toISOString(),completedPrincipalKind:r.completed_principal_kind!,completedPrincipalSubject:r.completed_principal_subject!,...(r.completed_staff_actor_user_id?{completedStaffActorUserId:r.completed_staff_actor_user_id}:{})}:{}),
});
const coverageFrom=(state:"configured"|"unconfigured",requirements:readonly RequirementRow[],evidence:readonly CoverageEvidenceRow[]):OrderLinePrepressCoverage=>{
  if(state==="unconfigured")return {state:"unconfigured",requirements:[],productionArtworkComplete:false,allRequiredPrepressUnitsComplete:false};
  const entries=requirements.map((r)=>{const requirement:ProductionUnitRequirement={key:r.requirement_key,...(r.side?{side:r.side}:{}),...(r.source_page_index===null?{}:{sourcePageIndex:r.source_page_index}),...(r.layer_key===null?{}:{layerKey:r.layer_key,layerOrder:r.layer_order!})};const matches=evidence.filter((e)=>e.requirement_key===r.requirement_key&&Boolean(e.artwork_assignment_id));const ids=matches.map((m)=>brandedId<"ArtworkAssignmentId">(m.artwork_assignment_id!));const units=matches.filter((m)=>m.id).map(unit);return {requirement,artworkAssignmentIds:ids,prepressUnits:units,productionArtworkCovered:ids.length>0,prepressComplete:ids.length>0&&units.some((u)=>Boolean(u.completedAt))};});
  return {state:"configured",requirements:entries,productionArtworkComplete:entries.every((entry)=>entry.productionArtworkCovered),allRequiredPrepressUnitsComplete:entries.every((entry)=>entry.prepressComplete)};
};
export type PrepressPersistenceTestHooks=Readonly<{afterUnit?:()=>Promise<void>;afterStart?:()=>Promise<void>;afterComplete?:()=>Promise<void>;afterAudit?:()=>Promise<void>}>;
export class PostgresPrepressTransaction implements PrepressTransaction {
  private readonly requests=new PostgresOperationRequestRepository();
  constructor(private readonly client:PoolClient,private readonly hooks?:PrepressPersistenceTestHooks) {}
  async reserve(input:Parameters<PrepressTransaction["reserve"]>[0]){const r=await this.requests.reserve(this.client,input);return {kind:r.kind,request:{id:r.request.id,resultJson:r.request.resultJson}};}
  async succeed(org:string,id:string,result:Parameters<PrepressTransaction["succeed"]>[2]){await this.requests.succeed(this.client,org,id,{resourceType:"prepress_unit",resourceId:result.unit.prepressUnitId,resultJson:result});}
  async attribute(input:Parameters<PrepressTransaction["attribute"]>[0]){await this.requests.recordAttribution(this.client,{organizationId:input.organizationId,operationRequestId:input.requestId,operation:input.operation,resourceType:"prepress_unit",resourceId:input.resourceId,principalKind:input.principalKind,principalSubject:input.principalSubject,staffActorUserId:input.staffActorUserId});}
  async audit(input:Parameters<PrepressTransaction["audit"]>[0]){await this.client.query("INSERT INTO v2_audit_events(organization_id,operation_request_id,operation,event_type,resource_type,resource_id,principal_kind,principal_subject,staff_actor_user_id,changes) VALUES($1,$2,$3,$4,'prepress_unit',$5,$6,$7,$8,$9::jsonb)",[input.organizationId,input.requestId,input.operation,input.eventType,input.resourceId,input.principalKind,input.principalSubject,input.staffActorUserId??null,JSON.stringify([{kind:input.eventType,summary:input.summary}])]);await this.hooks?.afterAudit?.();}
  async findUnit(org:OrganizationId,id:PrepressUnitId){const r=await this.client.query<UnitRow>("SELECT * FROM v2_prepress_units WHERE organization_id=$1 AND id=$2",[org,id]);return r.rows[0]?unit(r.rows[0]):null;}
  async orderLineExists(org:OrganizationId,line:OrderLineId){const r=await this.client.query<{id:string}>("SELECT l.id FROM v2_sales_document_lines l JOIN v2_sales_documents d ON d.organization_id=l.organization_id AND d.id=l.document_id WHERE l.organization_id=$1 AND l.id=$2 AND d.document_kind='order'",[org,line]);return Boolean(r.rows[0]);}
  async lockUnit(org:OrganizationId,id:PrepressUnitId){const r=await this.client.query<UnitRow>("SELECT * FROM v2_prepress_units WHERE organization_id=$1 AND id=$2 FOR UPDATE",[org,id]);return r.rows[0]?unit(r.rows[0]):null;}
  async listUnits(org:OrganizationId,line:OrderLineId){const r=await this.client.query<UnitRow>("SELECT * FROM v2_prepress_units WHERE organization_id=$1 AND order_line_id=$2 ORDER BY created_at,id",[org,line]);return r.rows.map(unit);}
  async listQueue(org:OrganizationId,request:PrepressQueuePageRequest):Promise<OperationalQueuePage<PrepressQueueItem>>{
    /* The queue is deliberately bounded. Coverage is loaded by the same
       transaction/repository, so no UI component infers requirements from art. */
    const page=request.page??1,pageSize=request.pageSize??25,search=request.search??"",requirementState=request.requirementState??"all",offset=(page-1)*pageSize;
    const where=`d.organization_id=$1 AND d.document_kind='order' AND ri.route_state IN ('pending','active')
        AND EXISTS(SELECT 1 FROM v2_route_instance_steps ps WHERE ps.organization_id=ri.organization_id AND ps.route_instance_id=ri.id AND ps.step_kind='prepress')
        AND ($3::text='all' OR l.production_requirement_state=$3::text)
        AND ($2='' OR d.display_number ILIKE '%'||$2||'%' OR COALESCE(c.display_name,c.company_name,'') ILIKE '%'||$2||'%' OR l.description ILIKE '%'||$2||'%')`;
    const [count,rows]=await Promise.all([
      this.client.query<{count:string}>(`SELECT count(*) count FROM v2_sales_documents d JOIN v2_sales_order_details o ON o.organization_id=d.organization_id AND o.document_id=d.id AND o.commercial_state='open' AND o.archived_at IS NULL JOIN v2_sales_document_lines l ON l.organization_id=d.organization_id AND l.document_id=d.id JOIN v2_route_instances ri ON ri.organization_id=l.organization_id AND ri.order_document_id=d.id AND ri.order_line_id=l.id LEFT JOIN customers c ON c.organization_id=d.organization_id AND c.id=d.customer_id WHERE ${where}`,[org,search,requirementState]),
    this.client.query<{order_id:string;order_number:string;customer_id:string|null;customer_display_name:string;line_id:string;line_description:string;quantity:number;requested_due_date:string|null;step_kind:"proofing"|"prepress"|"production"|"fulfillment"|null;production_requirement_state:"configured"|"unconfigured"}>(`SELECT d.id order_id,d.display_number order_number,d.customer_id customer_id,COALESCE(c.display_name,c.company_name,'Customer') customer_display_name,l.id line_id,l.description line_description,l.quantity,d.requested_due_date::text,step.step_kind,l.production_requirement_state
      FROM v2_sales_documents d JOIN v2_sales_order_details o ON o.organization_id=d.organization_id AND o.document_id=d.id AND o.commercial_state='open' AND o.archived_at IS NULL
      JOIN v2_sales_document_lines l ON l.organization_id=d.organization_id AND l.document_id=d.id
      JOIN v2_route_instances ri ON ri.organization_id=l.organization_id AND ri.order_document_id=d.id AND ri.order_line_id=l.id
      LEFT JOIN v2_route_instance_steps step ON step.organization_id=ri.organization_id AND step.route_instance_id=ri.id AND step.id=ri.current_step_id
      LEFT JOIN customers c ON c.organization_id=d.organization_id AND c.id=d.customer_id
      WHERE ${where}
      ORDER BY d.requested_due_date NULLS LAST,d.updated_at DESC,l.position,l.id LIMIT $4 OFFSET $5`,[org,search,requirementState,pageSize,offset]),
    ]);
    const totalCount=Number(count.rows[0]?.count??0),lineIds=rows.rows.map((row)=>row.line_id);if(!lineIds.length)return {items:[],pagination:{page,pageSize:pageSize as 25|50|100,totalCount,totalPages:Math.ceil(totalCount/pageSize)}};
    const [requirements,evidence]=await Promise.all([
      this.client.query<RequirementRow>("SELECT order_line_id,requirement_key,side,source_page_index,layer_key,layer_order FROM v2_sales_line_production_requirements WHERE organization_id=$1 AND order_line_id=ANY($2::text[]) ORDER BY requirement_key",[org,lineIds]),
      this.client.query<CoverageEvidenceRow>(`SELECT r.order_line_id coverage_order_line_id,r.requirement_key,pu.*,a.id artwork_assignment_id FROM v2_sales_line_production_requirements r
        LEFT JOIN v2_artwork_assignments a ON a.organization_id=r.organization_id AND a.order_line_id=r.order_line_id AND a.purpose='production' AND a.side IS NOT DISTINCT FROM r.side AND a.source_page_index IS NOT DISTINCT FROM r.source_page_index AND a.layer_key IS NOT DISTINCT FROM r.layer_key AND a.layer_order IS NOT DISTINCT FROM r.layer_order
        LEFT JOIN v2_prepress_units pu ON pu.organization_id=a.organization_id AND pu.artwork_assignment_id=a.id
        WHERE r.organization_id=$1 AND r.order_line_id=ANY($2::text[])`,[org,lineIds]),
    ]);
    const items=rows.rows.map((row)=>({orderId:brandedId<"OrderId">(row.order_id),orderNumber:row.order_number,...(row.customer_id?{customerId:row.customer_id}:{}),customerDisplayName:row.customer_display_name,orderLineId:brandedId<"OrderLineId">(row.line_id),lineDescription:row.line_description,quantity:row.quantity,...(row.requested_due_date?{requestedDueDate:row.requested_due_date}:{}),...(row.step_kind?{routingStepKind:row.step_kind}:{}),coverage:coverageFrom(row.production_requirement_state,requirements.rows.filter((value)=>value.order_line_id===row.line_id),evidence.rows.filter((value)=>value.coverage_order_line_id===row.line_id))}));
    return {items,pagination:{page,pageSize:pageSize as 25|50|100,totalCount,totalPages:Math.ceil(totalCount/pageSize)}};
  }
  async coverage(org:OrganizationId,line:OrderLineId):Promise<OrderLinePrepressCoverage>{
    const state=await this.client.query<{production_requirement_state:"configured"|"unconfigured"}>("SELECT production_requirement_state FROM v2_sales_document_lines WHERE organization_id=$1 AND id=$2",[org,line]);
    if(!state.rows[0]||state.rows[0].production_requirement_state==="unconfigured")return {state:"unconfigured",requirements:[],productionArtworkComplete:false,allRequiredPrepressUnitsComplete:false};
    const requirements=await this.client.query<RequirementRow>("SELECT order_line_id,requirement_key,side,source_page_index,layer_key,layer_order FROM v2_sales_line_production_requirements WHERE organization_id=$1 AND order_line_id=$2 ORDER BY requirement_key",[org,line]);
    const evidence=await this.client.query<CoverageEvidenceRow>(`SELECT r.order_line_id coverage_order_line_id,r.requirement_key,pu.*,a.id artwork_assignment_id FROM v2_sales_line_production_requirements r
      LEFT JOIN v2_artwork_assignments a ON a.organization_id=r.organization_id AND a.order_line_id=r.order_line_id AND a.purpose='production' AND a.side IS NOT DISTINCT FROM r.side AND a.source_page_index IS NOT DISTINCT FROM r.source_page_index AND a.layer_key IS NOT DISTINCT FROM r.layer_key AND a.layer_order IS NOT DISTINCT FROM r.layer_order
      LEFT JOIN v2_prepress_units pu ON pu.organization_id=a.organization_id AND pu.artwork_assignment_id=a.id
      WHERE r.organization_id=$1 AND r.order_line_id=$2`,[org,line]);
    return coverageFrom("configured",requirements.rows,evidence.rows);
  }
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
