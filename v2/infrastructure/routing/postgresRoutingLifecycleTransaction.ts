import type { Pool, PoolClient } from "pg";
import { PostgresOperationRequestRepository } from "../persistence/postgresOperationRequests.js";
import type { RoutingLifecycleTransaction, RoutingLifecycleTransactionRunner, RoutePrerequisite } from "../../src/modules/routing/routingLifecycle.js";
import type { RouteInstance, RouteInstanceState, RouteInstanceStep, RouteStepKind } from "../../src/modules/routing/contracts.js";
import { brandedId, type OrganizationId, type RouteInstanceId } from "../../src/modules/shared/commercialValues.js";
import { V2ApplicationError } from "../../src/errors/applicationError.js";
import { PostgresProductionCompletionProjection } from "../production/postgresProductionCompletionProjection.js";
import { PostgresFulfillmentCompletionProjection } from "../fulfillment/postgresFulfillmentCompletionProjection.js";

type RouteRow = Readonly<{ id: string; organization_id: string; order_document_id: string; order_line_id: string; source_template_id: string; source_template_revision: string; source_template_fingerprint: string; route_state: RouteInstanceState; current_step_id: string | null; revision: string }>;
type StepRow = Readonly<{ id: string; position: number; step_kind: RouteStepKind }>;
const step = (row: StepRow): RouteInstanceStep => ({ routeInstanceStepId: brandedId<"RouteInstanceStepId">(row.id), position: row.position, kind: row.step_kind });
const route = (row: RouteRow, steps: readonly RouteInstanceStep[]): RouteInstance => ({
  routeInstanceId: brandedId<"RouteInstanceId">(row.id), organizationId: brandedId<"OrganizationId">(row.organization_id),
  work: { kind: "sales_order_line", organizationId: brandedId<"OrganizationId">(row.organization_id), orderId: brandedId<"OrderId">(row.order_document_id), orderLineId: brandedId<"OrderLineId">(row.order_line_id) },
  sourceTemplate: { routeTemplateId: brandedId<"RouteTemplateId">(row.source_template_id), revision: row.source_template_revision, definitionFingerprint: row.source_template_fingerprint },
  state: row.route_state, ...(row.current_step_id ? { currentStepId: brandedId<"RouteInstanceStepId">(row.current_step_id) } : {}), revision: row.revision, steps,
});

export type RoutingLifecyclePersistenceTestHooks = Readonly<{ afterAdvance?: () => Promise<void> | void; afterAudit?: () => Promise<void> | void }>;

/**
 * Routing queries only compact ownership facts.  Proof approval, Prepress
 * coverage, production output, and fulfillment allocations remain authored by
 * their owning modules; this adapter merely asks whether their frozen line is
 * eligible to leave the current Routing step.
 */
export class PostgresRoutingLifecycleTransaction implements RoutingLifecycleTransaction {
  private readonly requests = new PostgresOperationRequestRepository();
  private readonly productionCompletion: PostgresProductionCompletionProjection;
  private readonly fulfillmentCompletion: PostgresFulfillmentCompletionProjection;
  constructor(private readonly client: PoolClient, private readonly hooks?: RoutingLifecyclePersistenceTestHooks) { this.productionCompletion=new PostgresProductionCompletionProjection(client);this.fulfillmentCompletion=new PostgresFulfillmentCompletionProjection(client); }
  async reserve(input: Parameters<RoutingLifecycleTransaction["reserve"]>[0]) { const value = await this.requests.reserve(this.client, input); return { kind: value.kind, request: { id: value.request.id, resultJson: value.request.resultJson } }; }
  async succeed(org: string, id: string, result: Parameters<RoutingLifecycleTransaction["succeed"]>[2]) { await this.requests.succeed(this.client, org, id, { resourceType: "route_instance", resourceId: result.routeInstance.routeInstanceId, resultJson: result }); }
  async attribute(input: Parameters<RoutingLifecycleTransaction["attribute"]>[0]) { await this.requests.recordAttribution(this.client, { organizationId: input.organizationId, operationRequestId: input.requestId, operation: input.operation, resourceType: "route_instance", resourceId: input.resourceId, principalKind: input.principalKind, principalSubject: input.principalSubject, staffActorUserId: input.staffActorUserId }); }
  async audit(input: Parameters<RoutingLifecycleTransaction["audit"]>[0]) {
    await this.client.query("INSERT INTO v2_audit_events(organization_id,operation_request_id,operation,event_type,resource_type,resource_id,principal_kind,principal_subject,staff_actor_user_id,changes) VALUES($1,$2,$3,'routing_step_completed','route_instance',$4,$5,$6,$7,$8::jsonb)", [input.organizationId, input.requestId, input.operation, input.resourceId, input.principalKind, input.principalSubject, input.staffActorUserId ?? null, JSON.stringify([{ kind: "routing_step_completed", stepId: input.completedStep.routeInstanceStepId, stepKind: input.completedStep.kind, ...(input.nextStep ? { nextStepId: input.nextStep.routeInstanceStepId, nextStepKind: input.nextStep.kind } : { routeCompleted: true }) }])]);
    await this.hooks?.afterAudit?.();
  }
  async lockRouteInstance(org: OrganizationId, id: RouteInstanceId): Promise<RouteInstance | null> {
    const result = await this.client.query<RouteRow>("SELECT id,organization_id,order_document_id,order_line_id,source_template_id,source_template_revision,source_template_fingerprint,route_state,current_step_id,revision FROM v2_route_instances WHERE organization_id=$1 AND id=$2 FOR UPDATE", [org, id]);
    const row = result.rows[0]; if (!row) return null;
    const steps = await this.client.query<StepRow>("SELECT id,position,step_kind FROM v2_route_instance_steps WHERE organization_id=$1 AND route_instance_id=$2 ORDER BY position FOR SHARE", [org, id]);
    const frozen = steps.rows.map(step);
    if (!frozen.length || (row.current_step_id && !frozen.some((candidate) => candidate.routeInstanceStepId === row.current_step_id))) throw new V2ApplicationError("CONFLICT", "The frozen Route is structurally invalid.");
    return route(row, frozen);
  }
  async prerequisite(org: OrganizationId, frozen: RouteInstance, current: RouteInstanceStep): Promise<RoutePrerequisite> {
    if (current.kind === "proofing") return this.proofApproved(org, frozen.work.orderLineId);
    if (current.kind === "prepress") return this.prepressComplete(org, frozen.work.orderLineId);
    if (current.kind === "production") { const completion=await this.productionCompletion.readCompletion(org,frozen.work.orderLineId); return completion.state==="complete"?{satisfied:true}:{satisfied:false,reason:completion.reason??"Production is incomplete."}; }
    if (current.kind === "fulfillment") { const completion=await this.fulfillmentCompletion.readCompletion(org,frozen.work.orderLineId); return completion.state==="complete"?{satisfied:true}:{satisfied:false,reason:completion.reason??"Fulfillment is incomplete."}; }
    return { satisfied: false, reason: "Routing has an unknown current step." };
  }
  async advance(input: Parameters<RoutingLifecycleTransaction["advance"]>[0]): Promise<RouteInstance> {
    const state: RouteInstanceState = input.nextStepId ? "active" : "completed";
    const updated = await this.client.query<RouteRow>("UPDATE v2_route_instances SET route_state=$4,current_step_id=$5,revision=revision+1,updated_at=now() WHERE organization_id=$1 AND id=$2 AND revision=$3 RETURNING id,organization_id,order_document_id,order_line_id,source_template_id,source_template_revision,source_template_fingerprint,route_state,current_step_id,revision", [input.organizationId, input.routeInstanceId, input.expectedRevision, state, input.nextStepId ?? null]);
    if (!updated.rows[0]) throw new V2ApplicationError("STALE_STATE", "The frozen Route changed; reload before advancing it.");
    await this.hooks?.afterAdvance?.();
    const steps = await this.client.query<StepRow>("SELECT id,position,step_kind FROM v2_route_instance_steps WHERE organization_id=$1 AND route_instance_id=$2 ORDER BY position", [input.organizationId, input.routeInstanceId]);
    return route(updated.rows[0], steps.rows.map(step));
  }
  private async proofApproved(org: OrganizationId, line: string): Promise<RoutePrerequisite> {
    const result = await this.client.query<{ satisfied: boolean }>(`SELECT EXISTS(
      SELECT 1 FROM v2_proof_works w
      JOIN v2_proof_versions v ON v.organization_id=w.organization_id AND v.proof_work_id=w.id
      JOIN v2_proof_responses r ON r.organization_id=v.organization_id AND r.proof_version_id=v.id
      WHERE w.organization_id=$1 AND w.order_line_id=$2 AND r.outcome='approved'
        AND v.id=(SELECT latest.id FROM v2_proof_versions latest WHERE latest.organization_id=w.organization_id AND latest.proof_work_id=w.id ORDER BY latest.sequence DESC LIMIT 1)
    ) satisfied`, [org, line]);
    return result.rows[0]?.satisfied ? { satisfied: true } : { satisfied: false, reason: "Routing requires the current Proof Version to be approved." };
  }
  private async prepressComplete(org: OrganizationId, line: string): Promise<RoutePrerequisite> {
    const result = await this.client.query<{ satisfied: boolean }>(`SELECT EXISTS(
      SELECT 1 FROM v2_sales_document_lines l
      WHERE l.organization_id=$1 AND l.id=$2 AND l.production_requirement_state='configured'
        AND NOT EXISTS(
          SELECT 1 FROM v2_sales_line_production_requirements req
          WHERE req.organization_id=l.organization_id AND req.order_line_id=l.id
            AND NOT EXISTS(
              SELECT 1 FROM v2_artwork_assignments a
              JOIN v2_prepress_units unit ON unit.organization_id=a.organization_id AND unit.artwork_assignment_id=a.id AND unit.completed_at IS NOT NULL
              WHERE a.organization_id=req.organization_id AND a.order_line_id=req.order_line_id AND a.purpose='production'
                AND a.side IS NOT DISTINCT FROM req.side AND a.source_page_index IS NOT DISTINCT FROM req.source_page_index
                AND a.layer_key IS NOT DISTINCT FROM req.layer_key AND a.layer_order IS NOT DISTINCT FROM req.layer_order
            )
        )
    ) satisfied`, [org, line]);
    return result.rows[0]?.satisfied ? { satisfied: true } : { satisfied: false, reason: "Routing requires all authoritative Prepress units to be complete." };
  }
}

export class PostgresRoutingLifecycleTransactionRunner implements RoutingLifecycleTransactionRunner {
  constructor(private readonly pool: Pool, private readonly hooks?: RoutingLifecyclePersistenceTestHooks) {}
  async transaction<T>(action: (tx: RoutingLifecycleTransaction) => Promise<T>): Promise<T> { const client = await this.pool.connect(); try { await client.query("BEGIN"); const result = await action(new PostgresRoutingLifecycleTransaction(client, this.hooks)); await client.query("COMMIT"); return result; } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); } }
}
