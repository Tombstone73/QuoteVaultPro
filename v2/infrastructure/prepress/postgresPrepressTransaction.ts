import type { Pool, PoolClient } from "pg";
import { PostgresOperationRequestRepository } from "../persistence/postgresOperationRequests.js";
import type { PrepressTransaction, PrepressTransactionRunner } from "../../src/modules/prepress/prepressApplication.js";
import type { OrderLinePrepressCoverage, PrepressArtworkReference, PrepressQueueItem, PrepressQueuePageRequest, PrepressReadinessBlocker, PrepressUnit } from "../../src/modules/prepress/contracts.js";
import type { ProductionUnitRequirement } from "../../src/modules/shared/productionRequirements.js";
import type { OperationalQueuePage } from "../../src/modules/shared/operationalQueue.js";
import { brandedId, type ArtworkAssignmentId, type ArtworkFileId, type OrderLineId, type OrganizationId, type PrepressUnitId, type ProductionWorkId } from "../../src/modules/shared/commercialValues.js";

type UnitRow = {
  id:string; organization_id:string; order_document_id:string; order_line_id:string; artwork_assignment_id:string; artwork_file_id:string;
  side:"front"|"back"|null; source_page_index:number|null; layer_key:string|null; layer_order:number|null;
  created_at:Date; created_principal_kind:PrepressUnit["createdPrincipalKind"]; created_principal_subject:string; created_staff_actor_user_id:string|null;
  started_at:Date|null; started_principal_kind:PrepressUnit["startedPrincipalKind"]|null; started_principal_subject:string|null; started_staff_actor_user_id:string|null;
  completed_at:Date|null; completed_principal_kind:PrepressUnit["completedPrincipalKind"]|null; completed_principal_subject:string|null; completed_staff_actor_user_id:string|null;
};
type RequirementRow={order_line_id:string;requirement_key:string;side:"front"|"back"|null;source_page_index:number|null;layer_key:string|null;layer_order:number|null};
type CoverageEvidenceRow=UnitRow & {coverage_order_line_id:string;requirement_key:string;artwork_assignment_id:string|null};
type OperationalLineRow={
  order_id:string;order_number:string;customer_id:string|null;customer_display_name:string;line_id:string;line_description:string;quantity:number;requested_due_date:string|null;
  step_kind:"proofing"|"prepress"|"production"|"fulfillment"|null;production_requirement_state:"configured"|"unconfigured";resolved_configuration:unknown;
  requires_proof:boolean;production_destination:"flatbed"|"roll"|null;
};
type ArtworkReferenceRow={order_line_id:string;assignment_id:string;artwork_file_id:string;display_filename:string;content_type:string;purpose:"customer_supplied"|"production";side:"front"|"back"|null;source_page_index:number|null;detected_width_microns:number|null;detected_height_microns:number|null};
type ProofRow={order_line_id:string;state:"approved"|"revision_requested"|"pending"};
type MaterialRow={order_line_id:string;material_name_snapshot:string;material_sku_snapshot:string|null};

const record=(value:unknown):Readonly<Record<string,unknown>>=>value&&typeof value==="object"&&!Array.isArray(value)?value as Readonly<Record<string,unknown>>:{};
const text=(value:unknown):string|undefined=>typeof value==="string"&&value.trim()?value.trim():undefined;
const expectedDimensions=(value:unknown):PrepressQueueItem["operational"]["expectedDimensions"]=>{
  const dimensions=record(record(value).dimensions),width=text(dimensions.width),height=text(dimensions.height),unit=dimensions.unit;
  return width&&height&&(unit==="in"||unit==="ft"||unit==="mm")?{width,height,unit}:undefined;
};
const artworkReference=(row:ArtworkReferenceRow):PrepressArtworkReference=>({
  artworkAssignmentId:brandedId<"ArtworkAssignmentId">(row.assignment_id),artworkFileId:brandedId<"ArtworkFileId">(row.artwork_file_id),filename:row.display_filename,contentType:row.content_type,purpose:row.purpose,
  ...(row.side?{side:row.side}:{}),...(row.source_page_index===null?{}:{sourcePageIndex:row.source_page_index}),...(row.detected_width_microns===null?{}:{detectedWidthMicrons:row.detected_width_microns}),...(row.detected_height_microns===null?{}:{detectedHeightMicrons:row.detected_height_microns}),
});
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
        AND step.step_kind IN ('proofing','prepress')
        AND EXISTS(SELECT 1 FROM v2_route_instance_steps ps WHERE ps.organization_id=ri.organization_id AND ps.route_instance_id=ri.id AND ps.step_kind='prepress')
        AND NOT EXISTS(SELECT 1 FROM v2_sales_line_workflow_exceptions bypass WHERE bypass.organization_id=l.organization_id AND bypass.order_line_id=l.id AND bypass.prepress_requirement='not_required')
        AND ($3::text='all' OR l.production_requirement_state=$3::text)
        AND ($2='' OR d.display_number ILIKE '%'||$2||'%' OR COALESCE(c.display_name,c.company_name,'') ILIKE '%'||$2||'%' OR l.description ILIKE '%'||$2||'%')`;
    const [count,rows]=await Promise.all([
      this.client.query<{count:string}>(`SELECT count(*) count FROM v2_sales_documents d JOIN v2_sales_order_details o ON o.organization_id=d.organization_id AND o.document_id=d.id AND o.commercial_state='open' AND o.archived_at IS NULL JOIN v2_sales_document_lines l ON l.organization_id=d.organization_id AND l.document_id=d.id JOIN v2_route_instances ri ON ri.organization_id=l.organization_id AND ri.order_document_id=d.id AND ri.order_line_id=l.id LEFT JOIN v2_route_instance_steps step ON step.organization_id=ri.organization_id AND step.route_instance_id=ri.id AND step.id=ri.current_step_id LEFT JOIN customers c ON c.organization_id=d.organization_id AND c.id=d.customer_id WHERE ${where}`,[org,search,requirementState]),
    this.client.query<OperationalLineRow>(`SELECT d.id order_id,d.display_number order_number,d.customer_id customer_id,COALESCE(c.display_name,c.company_name,'Customer') customer_display_name,l.id line_id,l.description line_description,l.quantity,d.requested_due_date::text,step.step_kind,l.production_requirement_state,l.resolved_configuration,
        COALESCE((l.resolved_configuration#>>'{productFacts,requiresProofApproval}')::boolean,(v.tree_json#>>'{meta,general,requiresProofApproval}')::boolean,false) requires_proof,
        COALESCE(e.production_destination,next_production.production_destination_station_key) production_destination
      FROM v2_sales_documents d JOIN v2_sales_order_details o ON o.organization_id=d.organization_id AND o.document_id=d.id AND o.commercial_state='open' AND o.archived_at IS NULL
      JOIN v2_sales_document_lines l ON l.organization_id=d.organization_id AND l.document_id=d.id
      JOIN v2_route_instances ri ON ri.organization_id=l.organization_id AND ri.order_document_id=d.id AND ri.order_line_id=l.id
      LEFT JOIN v2_route_instance_steps step ON step.organization_id=ri.organization_id AND step.route_instance_id=ri.id AND step.id=ri.current_step_id
      LEFT JOIN LATERAL (SELECT candidate.production_destination_station_key FROM v2_route_instance_steps candidate WHERE candidate.organization_id=ri.organization_id AND candidate.route_instance_id=ri.id AND candidate.position>step.position AND candidate.step_kind='production' ORDER BY candidate.position LIMIT 1) next_production ON true
      LEFT JOIN customers c ON c.organization_id=d.organization_id AND c.id=d.customer_id
      LEFT JOIN pbv2_tree_versions v ON v.organization_id=l.organization_id AND v.product_id=l.product_id AND v.id=l.resolved_configuration->>'pricingConfigurationId'
      LEFT JOIN v2_sales_line_workflow_exceptions e ON e.organization_id=l.organization_id AND e.order_line_id=l.id
      WHERE ${where}
      ORDER BY d.requested_due_date NULLS LAST,d.updated_at DESC,l.position,l.id LIMIT $4 OFFSET $5`,[org,search,requirementState,pageSize,offset]),
    ]);
    const totalCount=Number(count.rows[0]?.count??0),lineIds=rows.rows.map((row)=>row.line_id);if(!lineIds.length)return {items:[],pagination:{page,pageSize:pageSize as 25|50|100,totalCount,totalPages:Math.ceil(totalCount/pageSize)}};
    const [requirements,evidence,artwork,proofs,materials]=await Promise.all([
      this.client.query<RequirementRow>("SELECT order_line_id,requirement_key,side,source_page_index,layer_key,layer_order FROM v2_sales_line_production_requirements WHERE organization_id=$1 AND order_line_id=ANY($2::text[]) ORDER BY requirement_key",[org,lineIds]),
      this.client.query<CoverageEvidenceRow>(`SELECT r.order_line_id coverage_order_line_id,r.requirement_key,pu.*,a.id artwork_assignment_id FROM v2_sales_line_production_requirements r
        LEFT JOIN v2_artwork_assignments a ON a.organization_id=r.organization_id AND a.order_line_id=r.order_line_id AND a.purpose='production' AND a.side IS NOT DISTINCT FROM r.side AND a.source_page_index IS NOT DISTINCT FROM r.source_page_index AND a.layer_key IS NOT DISTINCT FROM r.layer_key AND a.layer_order IS NOT DISTINCT FROM r.layer_order
        LEFT JOIN v2_prepress_units pu ON pu.organization_id=a.organization_id AND pu.artwork_assignment_id=a.id
        WHERE r.organization_id=$1 AND r.order_line_id=ANY($2::text[])`,[org,lineIds]),
      this.client.query<ArtworkReferenceRow>(`SELECT a.order_line_id,a.id assignment_id,a.artwork_file_id,f.display_filename,f.content_type,a.purpose,a.side,a.source_page_index,f.detected_width_microns,f.detected_height_microns
        FROM v2_artwork_assignments a JOIN v2_artwork_files f ON f.organization_id=a.organization_id AND f.id=a.artwork_file_id
        WHERE a.organization_id=$1 AND a.order_line_id=ANY($2::text[]) AND a.purpose IN ('customer_supplied','production')
          AND NOT EXISTS(SELECT 1 FROM v2_artwork_assignments successor WHERE successor.organization_id=a.organization_id AND successor.supersedes_artwork_assignment_id=a.id)
        ORDER BY a.created_at DESC,a.id DESC`,[org,lineIds]),
      this.client.query<ProofRow>(`SELECT l.id order_line_id,CASE
          WHEN EXISTS(SELECT 1 FROM v2_proof_works w JOIN v2_proof_versions v ON v.organization_id=w.organization_id AND v.proof_work_id=w.id JOIN v2_proof_responses r ON r.organization_id=v.organization_id AND r.proof_version_id=v.id WHERE w.organization_id=l.organization_id AND w.order_line_id=l.id AND r.outcome='approved' AND v.id=(SELECT latest.id FROM v2_proof_versions latest WHERE latest.organization_id=w.organization_id AND latest.proof_work_id=w.id ORDER BY latest.sequence DESC LIMIT 1)) THEN 'approved'
          WHEN EXISTS(SELECT 1 FROM v2_proof_works w JOIN v2_proof_versions v ON v.organization_id=w.organization_id AND v.proof_work_id=w.id JOIN v2_proof_responses r ON r.organization_id=v.organization_id AND r.proof_version_id=v.id WHERE w.organization_id=l.organization_id AND w.order_line_id=l.id AND r.outcome='revision_requested' AND v.id=(SELECT latest.id FROM v2_proof_versions latest WHERE latest.organization_id=w.organization_id AND latest.proof_work_id=w.id ORDER BY latest.sequence DESC LIMIT 1)) THEN 'revision_requested'
          ELSE 'pending' END state
        FROM v2_sales_document_lines l WHERE l.organization_id=$1 AND l.id=ANY($2::text[])`,[org,lineIds]),
      this.client.query<MaterialRow>("SELECT order_line_id,material_name_snapshot,material_sku_snapshot FROM v2_order_line_material_requirements WHERE organization_id=$1 AND order_line_id=ANY($2::text[]) ORDER BY order_line_id,material_name_snapshot,material_sku_snapshot",[org,lineIds]),
    ]);
    const items=rows.rows.map((row)=>{
      const coverage=coverageFrom(row.production_requirement_state,requirements.rows.filter((value)=>value.order_line_id===row.line_id),evidence.rows.filter((value)=>value.coverage_order_line_id===row.line_id));
      const lineArtwork=artwork.rows.filter((value)=>value.order_line_id===row.line_id),proof:ProofRow["state"]=proofs.rows.find((value)=>value.order_line_id===row.line_id)?.state??"pending",proofState:"not_required"|ProofRow["state"]=row.requires_proof?proof:"not_required";
      const blockers:PrepressReadinessBlocker[]=[];
      if(coverage.state==="unconfigured")blockers.push("production_requirements_unconfigured");
      if(!coverage.productionArtworkComplete)blockers.push("production_artwork_missing");
      if(!coverage.allRequiredPrepressUnitsComplete)blockers.push("prepress_units_incomplete");
      if(row.requires_proof&&proof!=="approved")blockers.push("proof_approval_required");
      if(!row.step_kind)blockers.push("production_route_missing");
      if(!row.production_destination)blockers.push("production_destination_unconfigured");
      const sourceArtwork=lineArtwork.filter((value)=>value.purpose==="customer_supplied").map(artworkReference),productionArtwork=lineArtwork.filter((value)=>value.purpose==="production").map(artworkReference);
      const lineMaterials=materials.rows.filter((value)=>value.order_line_id===row.line_id).map((value)=>[value.material_name_snapshot,value.material_sku_snapshot].filter(Boolean).join(" · "));
      return {orderId:brandedId<"OrderId">(row.order_id),orderNumber:row.order_number,...(row.customer_id?{customerId:row.customer_id}:{}),customerDisplayName:row.customer_display_name,orderLineId:brandedId<"OrderLineId">(row.line_id),lineDescription:row.line_description,quantity:row.quantity,...(row.requested_due_date?{requestedDueDate:row.requested_due_date}:{}),...(row.step_kind?{routingStepKind:row.step_kind}:{}),coverage,operational:{...(expectedDimensions(row.resolved_configuration)?{expectedDimensions:expectedDimensions(row.resolved_configuration)}:{}),materials:lineMaterials,sourceArtwork,productionArtwork,proof:{required:row.requires_proof,state:proofState},...(row.production_destination?{productionDestination:row.production_destination}:{}),readiness:{ready:blockers.length===0,blockers}}};
    });
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
  async handoffToProduction(input:Parameters<PrepressTransaction["handoffToProduction"]>[0]){
    const prepared=await this.lockUnit(input.organizationId,input.prepressUnitId);
    if(!prepared)throw new Error("Prepress unit was not found.");
    if(!prepared.completedAt)throw new Error("Prepress work must be completed before it can be sent to Production.");
    const routeRow=await this.client.query<{id:string;current_step_id:string|null;revision:string;step_kind:"prepress"|"production"|"proofing"|"fulfillment"|null}>(`SELECT ri.id,ri.current_step_id,ri.revision,current_step.step_kind
      FROM v2_route_instances ri LEFT JOIN v2_route_instance_steps current_step ON current_step.organization_id=ri.organization_id AND current_step.route_instance_id=ri.id AND current_step.id=ri.current_step_id
      JOIN v2_sales_order_details o ON o.organization_id=ri.organization_id AND o.document_id=ri.order_document_id AND o.commercial_state='open' AND o.archived_at IS NULL
      WHERE ri.organization_id=$1 AND ri.order_document_id=$2 AND ri.order_line_id=$3 AND ri.route_state IN ('pending','active') FOR UPDATE OF ri,o`,[input.organizationId,prepared.orderId,prepared.orderLineId]);
    const route=routeRow.rows[0];if(!route||!route.current_step_id||!route.step_kind)throw new Error("An active frozen Route is required before sending Prepress work to Production.");
    const steps=await this.client.query<{id:string;position:number;step_kind:"prepress"|"production"|"proofing"|"fulfillment";production_destination_station_key:"flatbed"|"roll"|null}>("SELECT id,position,step_kind,production_destination_station_key FROM v2_route_instance_steps WHERE organization_id=$1 AND route_instance_id=$2 ORDER BY position FOR SHARE",[input.organizationId,route.id]);
    const current=steps.rows.find((step)=>step.id===route.current_step_id);
    if(!current)throw new Error("The frozen Route has no valid current step.");
    const production=current.step_kind==="prepress"?steps.rows.find((step)=>step.position>current.position&&step.step_kind==="production"):current.step_kind==="production"?current:undefined;
    if(!production||(current.step_kind==="prepress"&&steps.rows.some((step)=>step.position>current.position&&step.position<production.position&&step.step_kind!=="prepress")))throw new Error("The frozen Route cannot hand this Prepress work to Production.");
    const destination=production.production_destination_station_key;if(!destination)throw new Error("The frozen Production Route step has no configured destination.");
    const proof=await this.client.query<{required:boolean;approved:boolean}>(`SELECT COALESCE((l.resolved_configuration#>>'{productFacts,requiresProofApproval}')::boolean,(v.tree_json#>>'{meta,general,requiresProofApproval}')::boolean,false) required,
      EXISTS(SELECT 1 FROM v2_proof_works w JOIN v2_proof_versions pv ON pv.organization_id=w.organization_id AND pv.proof_work_id=w.id JOIN v2_proof_responses response ON response.organization_id=pv.organization_id AND response.proof_version_id=pv.id WHERE w.organization_id=l.organization_id AND w.order_line_id=l.id AND response.outcome='approved' AND pv.id=(SELECT latest.id FROM v2_proof_versions latest WHERE latest.organization_id=w.organization_id AND latest.proof_work_id=w.id ORDER BY latest.sequence DESC LIMIT 1)) approved
      FROM v2_sales_document_lines l LEFT JOIN pbv2_tree_versions v ON v.organization_id=l.organization_id AND v.product_id=l.product_id AND v.id=l.resolved_configuration->>'pricingConfigurationId' WHERE l.organization_id=$1 AND l.id=$2 FOR SHARE OF l`,[input.organizationId,prepared.orderLineId]);
    if(!proof.rows[0])throw new Error("Order line was not found.");if(proof.rows[0].required&&!proof.rows[0].approved)throw new Error("The current Proof Version must be approved before sending this work to Production.");
    const assignments=await this.client.query<{assignment_id:string|null}>(`SELECT current_assignment.id assignment_id
      FROM v2_sales_line_production_requirements requirement
      LEFT JOIN LATERAL (SELECT a.id FROM v2_artwork_assignments a JOIN v2_prepress_units completed ON completed.organization_id=a.organization_id AND completed.artwork_assignment_id=a.id AND completed.completed_at IS NOT NULL WHERE a.organization_id=requirement.organization_id AND a.order_line_id=requirement.order_line_id AND a.purpose='production' AND a.side IS NOT DISTINCT FROM requirement.side AND a.source_page_index IS NOT DISTINCT FROM requirement.source_page_index AND a.layer_key IS NOT DISTINCT FROM requirement.layer_key AND a.layer_order IS NOT DISTINCT FROM requirement.layer_order AND NOT EXISTS(SELECT 1 FROM v2_artwork_assignments successor WHERE successor.organization_id=a.organization_id AND successor.supersedes_artwork_assignment_id=a.id) LIMIT 1) current_assignment ON true
      WHERE requirement.organization_id=$1 AND requirement.order_line_id=$2 ORDER BY requirement.requirement_key`,[input.organizationId,prepared.orderLineId]);
    if(!assignments.rows.length||assignments.rows.some((row)=>!row.assignment_id))throw new Error("Every required current Production Artwork assignment must have completed Prepress evidence.");
    if(current.step_kind==="prepress")await this.client.query("UPDATE v2_route_instances SET route_state='active',current_step_id=$3,revision=revision+1,updated_at=now() WHERE organization_id=$1 AND id=$2",[input.organizationId,route.id,production.id]);
    for(const assignment of assignments.rows){await this.client.query(`INSERT INTO v2_production_works(id,organization_id,order_document_id,order_line_id,requirement_key,artwork_assignment_id,artwork_file_id,prepress_unit_id,side,source_page_index,layer_key,layer_order,ordered_quantity,created_principal_kind,created_principal_subject,created_staff_actor_user_id)
      SELECT gen_random_uuid()::text,a.organization_id,a.order_document_id,a.order_line_id,req.requirement_key,a.id,a.artwork_file_id,completed.id,a.side,a.source_page_index,a.layer_key,a.layer_order,l.quantity,$3,$4,$5
      FROM v2_artwork_assignments a JOIN v2_sales_line_production_requirements req ON req.organization_id=a.organization_id AND req.order_line_id=a.order_line_id AND a.side IS NOT DISTINCT FROM req.side AND a.source_page_index IS NOT DISTINCT FROM req.source_page_index AND a.layer_key IS NOT DISTINCT FROM req.layer_key AND a.layer_order IS NOT DISTINCT FROM req.layer_order JOIN v2_sales_document_lines l ON l.organization_id=a.organization_id AND l.id=a.order_line_id JOIN v2_prepress_units completed ON completed.organization_id=a.organization_id AND completed.artwork_assignment_id=a.id AND completed.completed_at IS NOT NULL
      WHERE a.organization_id=$1 AND a.id=$2 AND a.purpose='production' ON CONFLICT(organization_id,artwork_assignment_id) DO NOTHING`,[input.organizationId,assignment.assignment_id,input.principalKind,input.principalSubject,input.staffActorUserId??null]);}
    const works=await this.client.query<{id:string}>("SELECT id FROM v2_production_works WHERE organization_id=$1 AND order_line_id=$2 AND artwork_assignment_id=ANY($3::text[]) ORDER BY id FOR SHARE",[input.organizationId,prepared.orderLineId,assignments.rows.map((row)=>row.assignment_id!)]);
    if(works.rows.length!==assignments.rows.length)throw new Error("Production work could not be created for every completed Prepress assignment.");
    return {unit:prepared,destination,productionWorkIds:works.rows.map((row)=>brandedId<"ProductionWorkId">(row.id))};
  }
}
export class PostgresPrepressTransactionRunner implements PrepressTransactionRunner {constructor(private readonly pool:Pool,private readonly hooks?:PrepressPersistenceTestHooks){}async transaction<T>(action:(tx:PrepressTransaction)=>Promise<T>):Promise<T>{const client=await this.pool.connect();try{await client.query("BEGIN");const result=await action(new PostgresPrepressTransaction(client,this.hooks));await client.query("COMMIT");return result;}catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}}}
