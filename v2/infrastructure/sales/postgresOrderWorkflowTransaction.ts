import type { Pool, PoolClient } from "pg";
import { PostgresOperationRequestRepository } from "../persistence/postgresOperationRequests.js";
import type { WorkflowTransitionTransaction, WorkflowTransitionTransactionRunner } from "../../src/modules/sales/workflowApplication.js";
import { organizationWorkflowPolicyFromSettings, type OrganizationWorkflowPolicy } from "../../src/modules/sales/workflowPolicy.js";
import type { OrganizationId } from "../../src/modules/shared/commercialValues.js";
import { brandedId, type OrderId } from "../../src/modules/shared/commercialValues.js";
import type { WorkflowActionEligibility } from "../../src/modules/sales/workflowApplication.js";
import { V2ApplicationError } from "../../src/errors/applicationError.js";

/** SQL adapter for the narrow exceptional paths. Locking the Order line and
 * Route means a retry cannot create two direct transitions or silently erase
 * active Production work. */
export class PostgresOrderWorkflowTransaction implements WorkflowTransitionTransaction {
  private readonly requests = new PostgresOperationRequestRepository();
  constructor(private readonly client: PoolClient) {}
  async reserve(input: Parameters<WorkflowTransitionTransaction["reserve"]>[0]) { const value = await this.requests.reserve(this.client, input); return { kind: value.kind, request: { id: value.request.id, resultJson: value.request.resultJson } }; }
  async succeed(organizationId: string, requestId: string, result: Parameters<WorkflowTransitionTransaction["succeed"]>[2]) { await this.requests.succeed(this.client, organizationId, requestId, { resourceType: "sales_order_line", resourceId: result.orderLineId, resultJson: result }); }
  async attribute(input: Parameters<WorkflowTransitionTransaction["attribute"]>[0]) { await this.requests.recordAttribution(this.client, { organizationId: input.organizationId, operationRequestId: input.requestId, operation: input.operation, resourceType: "sales_order_line", resourceId: input.resourceId, principalKind: input.principalKind, principalSubject: input.principalSubject, staffActorUserId: input.staffActorUserId }); }
  async policy(organizationId: OrganizationId): Promise<OrganizationWorkflowPolicy> { const result = await this.client.query<{ settings: unknown }>("SELECT settings FROM organizations WHERE id=$1 FOR SHARE", [organizationId]); if (!result.rows[0]) throw new V2ApplicationError("NOT_FOUND", "Organization was not found."); return organizationWorkflowPolicyFromSettings(result.rows[0].settings); }
  async eligibleActions(organizationId: OrganizationId, orderId: OrderId, confirmationRequired: boolean): Promise<readonly WorkflowActionEligibility[]> {
    const lines = await this.client.query<{ id:string; requires_production:boolean; requires_proof:boolean; workflow_intent:string|null }>(`SELECT l.id,
      COALESCE((l.resolved_configuration#>>'{productFacts,requiresProductionJob}')::boolean,(v.tree_json#>>'{meta,general,requiresProductionJob}')::boolean,false) requires_production,
      COALESCE((l.resolved_configuration#>>'{productFacts,requiresProofApproval}')::boolean,(v.tree_json#>>'{meta,general,requiresProofApproval}')::boolean,false) requires_proof,
      COALESCE(l.resolved_configuration#>>'{productFacts,workflowIntent}',v.tree_json#>>'{meta,general,workflowIntent}') workflow_intent
      FROM v2_sales_document_lines l JOIN v2_sales_order_details o ON o.organization_id=l.organization_id AND o.document_id=l.document_id AND o.commercial_state='open'
      LEFT JOIN pbv2_tree_versions v ON v.organization_id=l.organization_id AND v.product_id=l.product_id AND v.id=l.resolved_configuration->>'pricingConfigurationId'
      WHERE l.organization_id=$1 AND l.document_id=$2 ORDER BY l.position,l.id`, [organizationId, orderId]);
    const actions: WorkflowActionEligibility[] = [];
    for (const line of lines.rows) {
      if (line.workflow_intent !== "standard_production" || !line.requires_production || await this.hasProductionWork(organizationId, line.id)) continue;
      const route = await this.client.query<{ id:string;current_step_id:string }>("SELECT id,current_step_id FROM v2_route_instances WHERE organization_id=$1 AND order_line_id=$2 AND route_state IN ('pending','active')", [organizationId,line.id]);
      const frozen = route.rows[0]; if (!frozen) continue;
      const steps = await this.client.query<{id:string;position:number;step_kind:string;source_template_step_id:string}>("SELECT id,position,step_kind,source_template_step_id FROM v2_route_instance_steps WHERE organization_id=$1 AND route_instance_id=$2 ORDER BY position",[organizationId,frozen.id]);
      const current = steps.rows.find((step)=>step.id===frozen.current_step_id); if (!current) continue;
      const fulfillment = steps.rows.find((step)=>step.position>current.position&&step.step_kind==='fulfillment');
      if (fulfillment && (current.step_kind==='prepress'||current.step_kind==='production') && !steps.rows.some((step)=>step.position>current.position&&step.position<fulfillment.position&&step.step_kind!=='prepress'&&step.step_kind!=='production')) actions.push({action:"production_not_required",orderLineId:brandedId<"OrderLineId">(line.id),confirmationRequired,reasonRequired:true,eligibilityReason:"No Production work exists and the frozen Route can proceed to Fulfillment without fabricating completion."});
      const production = current.step_kind==='prepress' ? steps.rows.find((step)=>step.position>current.position&&step.step_kind==='production') : undefined;
      if (!production || steps.rows.some((step)=>step.position>current.position&&step.position<production.position&&step.step_kind!=='prepress')) continue;
      if (!await this.productionArtworkComplete(organizationId,line.id)) continue;
      if (line.requires_proof && !await this.currentProofApproved(organizationId,line.id)) continue;
      const destinations = await this.client.query<{station_key:"flatbed"|"roll"}>("SELECT station_key FROM v2_route_template_production_destinations WHERE organization_id=$1 AND route_template_step_id=$2 ORDER BY station_key",[organizationId,production.source_template_step_id]);
      if (destinations.rows.length) actions.push({action:"direct_production",orderLineId:brandedId<"OrderLineId">(line.id),confirmationRequired,allowedDestinations:destinations.rows.map((row)=>row.station_key),reasonRequired:false,eligibilityReason:"The frozen Route, current Artwork, and required Proof evidence permit a direct Production handoff."});
    }
    return actions;
  }
  async directProduction(input: Parameters<WorkflowTransitionTransaction["directProduction"]>[0]): Promise<void> {
    const line = await this.lockEligibleLine(input.organizationId, input.orderId, input.orderLineId);
    if (!line.requiresProduction) throw new V2ApplicationError("CONFLICT", "This Order line has no Production obligation to route directly.");
    if (await this.hasProductionWork(input.organizationId, input.orderLineId)) throw new V2ApplicationError("CONFLICT", "Production work already exists for this Order line.");
    const route = await this.lockRoute(input.organizationId, input.orderLineId);
    const productionStep = await this.nextProductionStep(input.organizationId, route.id, route.current_step_id);
    await this.assertConfiguredDestination(input.organizationId, route.id, productionStep, input.destination);
    await this.assertProductionArtworkComplete(input.organizationId, input.orderLineId);
    if (line.requiresProof) await this.assertCurrentProofApproved(input.organizationId, input.orderLineId);
    await this.upsertException(input, null, input.destination);
    await this.client.query("UPDATE v2_route_instances SET route_state='active',current_step_id=$3,revision=revision+1,updated_at=now() WHERE organization_id=$1 AND id=$2", [input.organizationId, route.id, productionStep]);
  }
  async productionNotRequired(input: Parameters<WorkflowTransitionTransaction["productionNotRequired"]>[0]): Promise<void> {
    const line = await this.lockEligibleLine(input.organizationId, input.orderId, input.orderLineId);
    if (!line.requiresProduction) throw new V2ApplicationError("CONFLICT", "This Order line is already not Production-required.");
    if (await this.hasProductionWork(input.organizationId, input.orderLineId)) throw new V2ApplicationError("CONFLICT", "Production Not Required cannot be selected after Production work exists.");
    const route = await this.lockRoute(input.organizationId, input.orderLineId);
    const fulfillmentStep = await this.nextFulfillmentStep(input.organizationId, route.id, route.current_step_id);
    await this.upsertException(input, "not_required", null);
    await this.client.query("UPDATE v2_route_instances SET route_state='active',current_step_id=$3,revision=revision+1,updated_at=now() WHERE organization_id=$1 AND id=$2", [input.organizationId, route.id, fulfillmentStep]);
  }
  async audit(input: Parameters<WorkflowTransitionTransaction["audit"]>[0]) { await this.client.query("INSERT INTO v2_audit_events(organization_id,operation_request_id,operation,event_type,resource_type,resource_id,principal_kind,principal_subject,staff_actor_user_id,changes) VALUES($1,$2,$3,$4,'sales_order_line',$5,$6,$7,$8,$9::jsonb)", [input.organizationId, input.requestId, input.operation, input.eventType, input.resourceId, input.principalKind, input.principalSubject, input.staffActorUserId ?? null, JSON.stringify(input.changes)]); }
  private async lockEligibleLine(organizationId: string, orderId: string, lineId: string) {
    const result = await this.client.query<{ requires_production: boolean; requires_proof: boolean; workflow_intent: string | null }>(`SELECT COALESCE((l.resolved_configuration#>>'{productFacts,requiresProductionJob}')::boolean,(v.tree_json#>>'{meta,general,requiresProductionJob}')::boolean,false) requires_production,
      COALESCE((l.resolved_configuration#>>'{productFacts,requiresProofApproval}')::boolean,(v.tree_json#>>'{meta,general,requiresProofApproval}')::boolean,false) requires_proof,
      COALESCE(l.resolved_configuration#>>'{productFacts,workflowIntent}',v.tree_json#>>'{meta,general,workflowIntent}') workflow_intent
      FROM v2_sales_document_lines l JOIN v2_sales_order_details o ON o.organization_id=l.organization_id AND o.document_id=l.document_id AND o.commercial_state='open'
      LEFT JOIN pbv2_tree_versions v ON v.organization_id=l.organization_id AND v.product_id=l.product_id AND v.id=l.resolved_configuration->>'pricingConfigurationId'
      WHERE l.organization_id=$1 AND l.document_id=$2 AND l.id=$3 FOR UPDATE`, [organizationId, orderId, lineId]);
    const line = result.rows[0];
    if (!line) throw new V2ApplicationError("NOT_FOUND", "Open Order line was not found.");
    if (line.workflow_intent !== "standard_production") throw new V2ApplicationError("CONFLICT", "Only a standard-production Order line can use this workflow exception.");
    return { requiresProduction: line.requires_production, requiresProof: line.requires_proof };
  }
  private async lockRoute(organizationId: string, lineId: string) {
    const result = await this.client.query<{ id: string; current_step_id: string }>("SELECT id,current_step_id FROM v2_route_instances WHERE organization_id=$1 AND order_line_id=$2 AND route_state IN ('pending','active') FOR UPDATE", [organizationId, lineId]);
    if (!result.rows[0]) throw new V2ApplicationError("CONFLICT", "A current frozen Route is required for this workflow exception.");
    return result.rows[0];
  }
  private async nextProductionStep(organizationId: string, routeId: string, currentStepId: string) {
    const steps = await this.client.query<{ id: string; position: number; step_kind: string }>("SELECT id,position,step_kind FROM v2_route_instance_steps WHERE organization_id=$1 AND route_instance_id=$2 ORDER BY position FOR SHARE", [organizationId, routeId]);
    const current = steps.rows.find((step) => step.id === currentStepId);
    const next = current ? steps.rows.find((step) => step.position > current.position && step.step_kind === "production") : undefined;
    if (!current || current.step_kind !== "prepress" || !next || steps.rows.some((step) => step.position > current.position && step.position < next.position && step.step_kind !== "prepress")) throw new V2ApplicationError("CONFLICT", "Direct Production is only available while Prepress is the current bypassable Route step.");
    return next.id;
  }
  private async nextFulfillmentStep(organizationId: string, routeId: string, currentStepId: string) {
    const steps = await this.client.query<{ id: string; position: number; step_kind: string }>("SELECT id,position,step_kind FROM v2_route_instance_steps WHERE organization_id=$1 AND route_instance_id=$2 ORDER BY position FOR SHARE", [organizationId, routeId]);
    const current = steps.rows.find((step) => step.id === currentStepId);
    const next = current ? steps.rows.find((step) => step.position > current.position && step.step_kind === "fulfillment") : undefined;
    if (!current || (current.step_kind !== "prepress" && current.step_kind !== "production") || !next || steps.rows.some((step) => step.position > current.position && step.position < next.position && step.step_kind !== "prepress" && step.step_kind !== "production")) throw new V2ApplicationError("CONFLICT", "Production Not Required is only available before the current Production obligation begins.");
    return next.id;
  }
  private async assertProductionArtworkComplete(organizationId: string, lineId: string) {
    if (!await this.productionArtworkComplete(organizationId,lineId)) throw new V2ApplicationError("CONFLICT", "Every required Production Artwork assignment must be current before direct Production.");
  }
  private async productionArtworkComplete(organizationId: string, lineId: string) {
    const result = await this.client.query<{ complete: boolean }>(`SELECT count(*) > 0 AND count(*) = count(a.id) complete FROM v2_sales_line_production_requirements req
      LEFT JOIN LATERAL (SELECT a.id FROM v2_artwork_assignments a WHERE a.organization_id=req.organization_id AND a.order_line_id=req.order_line_id AND a.purpose='production' AND a.side IS NOT DISTINCT FROM req.side AND a.source_page_index IS NOT DISTINCT FROM req.source_page_index AND a.layer_key IS NOT DISTINCT FROM req.layer_key AND a.layer_order IS NOT DISTINCT FROM req.layer_order AND NOT EXISTS(SELECT 1 FROM v2_artwork_assignments successor WHERE successor.organization_id=a.organization_id AND successor.supersedes_artwork_assignment_id=a.id) LIMIT 1) a ON true
      WHERE req.organization_id=$1 AND req.order_line_id=$2`, [organizationId, lineId]);
    return result.rows[0]?.complete===true;
  }
  private async assertConfiguredDestination(organizationId: string, routeId: string, productionStepId: string, destination: "flatbed" | "roll") {
    const result = await this.client.query<{ configured: boolean }>(`SELECT EXISTS(
      SELECT 1 FROM v2_route_instance_steps step
      JOIN v2_route_template_production_destinations destination ON destination.organization_id=step.organization_id AND destination.route_template_step_id=step.source_template_step_id
      WHERE step.organization_id=$1 AND step.route_instance_id=$2 AND step.id=$3 AND step.step_kind='production' AND destination.station_key=$4
    ) configured`, [organizationId, routeId, productionStepId, destination]);
    if (!result.rows[0]?.configured) throw new V2ApplicationError("CONFLICT", "The frozen Route has no configured Production destination matching this station.");
  }
  private async assertCurrentProofApproved(organizationId: string, lineId: string) {
    if (!await this.currentProofApproved(organizationId,lineId)) throw new V2ApplicationError("CONFLICT", "Direct Production requires the current Proof Version to be approved.");
  }
  private async currentProofApproved(organizationId: string, lineId: string) {
    const result = await this.client.query<{ approved: boolean }>(`SELECT EXISTS(
      SELECT 1 FROM v2_proof_works w JOIN v2_proof_versions v ON v.organization_id=w.organization_id AND v.proof_work_id=w.id
      JOIN v2_proof_responses r ON r.organization_id=v.organization_id AND r.proof_version_id=v.id
      WHERE w.organization_id=$1 AND w.order_line_id=$2 AND r.outcome='approved'
        AND v.id=(SELECT latest.id FROM v2_proof_versions latest WHERE latest.organization_id=w.organization_id AND latest.proof_work_id=w.id ORDER BY latest.sequence DESC LIMIT 1)
    ) approved`, [organizationId, lineId]);
    return result.rows[0]?.approved===true;
  }
  private async hasProductionWork(organizationId: string, lineId: string) { const result = await this.client.query("SELECT 1 FROM v2_production_works WHERE organization_id=$1 AND order_line_id=$2 LIMIT 1 FOR UPDATE", [organizationId, lineId]); return (result.rowCount ?? 0) > 0; }
  private async upsertException(input: Parameters<WorkflowTransitionTransaction["directProduction"]>[0] | Parameters<WorkflowTransitionTransaction["productionNotRequired"]>[0], productionRequirement: "not_required" | null, destination: "flatbed" | "roll" | null) {
    await this.client.query(`INSERT INTO v2_sales_line_workflow_exceptions(organization_id,order_document_id,order_line_id,prepress_requirement,production_requirement,production_destination,reason,created_principal_kind,created_principal_subject,created_staff_actor_user_id,updated_principal_kind,updated_principal_subject,updated_staff_actor_user_id)
      VALUES($1,$2,$3,'not_required',$4,$5,$6,$7,$8,$9,$7,$8,$9)
      ON CONFLICT(organization_id,order_line_id) DO UPDATE SET prepress_requirement='not_required',production_requirement=EXCLUDED.production_requirement,production_destination=EXCLUDED.production_destination,reason=EXCLUDED.reason,revision=v2_sales_line_workflow_exceptions.revision+1,updated_at=now(),updated_principal_kind=EXCLUDED.updated_principal_kind,updated_principal_subject=EXCLUDED.updated_principal_subject,updated_staff_actor_user_id=EXCLUDED.updated_staff_actor_user_id`, [input.organizationId, input.orderId, input.orderLineId, productionRequirement, destination, input.reason, input.principalKind, input.principalSubject, input.staffActorUserId ?? null]);
  }
}
export class PostgresOrderWorkflowTransactionRunner implements WorkflowTransitionTransactionRunner {
  constructor(private readonly pool: Pool) {}
  async transaction<T>(action: (transaction: WorkflowTransitionTransaction) => Promise<T>): Promise<T> { const client = await this.pool.connect(); try { await client.query("BEGIN"); const result = await action(new PostgresOrderWorkflowTransaction(client)); await client.query("COMMIT"); return result; } catch (cause) { await client.query("ROLLBACK"); throw cause; } finally { client.release(); } }
}
