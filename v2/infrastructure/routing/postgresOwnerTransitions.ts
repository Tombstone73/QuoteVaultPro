import type { PoolClient } from "pg";
import { V2ApplicationError } from "../../src/errors/applicationError.js";
import type { OwnerRouteScope, OwnerTransitions, PreparedPrepressResult, ProductionDestination, SalesWorkflowRouteRequest } from "../../src/modules/routing/ownerTransitions.js";

type RouteRow = { id: string; current_step_id: string | null; revision: string; step_kind?: string | null };
type StepRow = { id: string; position: number; step_kind: string; production_destination_station_key: ProductionDestination | null };

export class PostgresOwnerTransitions implements OwnerTransitions {
  constructor(private readonly client: PoolClient) {}

  async handoffPreparedPrepress<T>(request: OwnerRouteScope, prepare: (destination: ProductionDestination) => Promise<PreparedPrepressResult<T>>) {
    const routeRow = await this.client.query<RouteRow>(`SELECT ri.id,ri.current_step_id,ri.revision,current_step.step_kind
      FROM v2_route_instances ri LEFT JOIN v2_route_instance_steps current_step ON current_step.organization_id=ri.organization_id AND current_step.route_instance_id=ri.id AND current_step.id=ri.current_step_id
      JOIN v2_sales_order_details o ON o.organization_id=ri.organization_id AND o.document_id=ri.order_document_id AND o.commercial_state='open' AND o.archived_at IS NULL
      WHERE ri.organization_id=$1 AND ri.order_document_id=$2 AND ri.order_line_id=$3 AND ri.route_state IN ('pending','active') FOR UPDATE OF ri,o`, [request.organizationId, request.orderId, request.orderLineId]);
    const route = routeRow.rows[0];
    if (!route || !route.current_step_id || !route.step_kind) throw new Error("An active frozen Route is required before sending Prepress work to Production.");
    const steps = await this.steps(request.organizationId, route.id);
    const current = steps.find(step => step.id === route.current_step_id);
    if (!current) throw new Error("The frozen Route has no valid current step.");
    const production = current.step_kind === "prepress" ? steps.find(step => step.position > current.position && step.step_kind === "production") : current.step_kind === "production" ? current : undefined;
    if (!production || (current.step_kind === "prepress" && steps.some(step => step.position > current.position && step.position < production.position && step.step_kind !== "prepress"))) throw new Error("The frozen Route cannot hand this Prepress work to Production.");
    const destination = production.production_destination_station_key;
    if (!destination) throw new Error("The frozen Production Route step has no configured destination.");
    const prepared = await prepare(destination);
    if (prepared.kind === "rework") return { destination, value: prepared.value };
    if (current.step_kind === "prepress") await this.advance(request, route, production.id);
    return { destination, value: await prepared.createWork() };
  }

  async applySalesWorkflowException(request: SalesWorkflowRouteRequest, recordException: () => Promise<void>) {
    const result = await this.client.query<RouteRow>("SELECT id,current_step_id,revision FROM v2_route_instances WHERE organization_id=$1 AND order_line_id=$2 AND order_document_id=$3 AND route_state IN ('pending','active') FOR UPDATE", [request.organizationId, request.orderLineId, request.orderId]);
    const route = result.rows[0];
    if (!route) throw new V2ApplicationError("CONFLICT", "A current frozen Route is required for this workflow exception.");
    const steps = await this.steps(request.organizationId, route.id);
    const current = steps.find(step => step.id === route.current_step_id);
    const kind = request.kind === "direct_production" ? "production" : "fulfillment";
    const next = current ? steps.find(step => step.position > current.position && step.step_kind === kind) : undefined;
    if (request.kind === "direct_production") {
      if (!current || current.step_kind !== "prepress" || !next || steps.some(step => step.position > current.position && step.position < next.position && step.step_kind !== "prepress")) throw new V2ApplicationError("CONFLICT", "Direct Production is only available while Prepress is the current bypassable Route step.");
      const configured = await this.client.query<{ configured: boolean }>(`SELECT EXISTS(
        SELECT 1 FROM v2_route_instance_steps step
        WHERE step.organization_id=$1 AND step.route_instance_id=$2 AND step.id=$3 AND step.step_kind='production' AND step.production_destination_station_key=$4
      ) configured`, [request.organizationId, route.id, next.id, request.destination]);
      if (!configured.rows[0]?.configured) throw new V2ApplicationError("CONFLICT", "The frozen Route has no configured Production destination matching this station.");
    } else if (!current || (current.step_kind !== "prepress" && current.step_kind !== "production") || !next || steps.some(step => step.position > current.position && step.position < next.position && step.step_kind !== "prepress" && step.step_kind !== "production")) {
      throw new V2ApplicationError("CONFLICT", "Production Not Required is only available before the current Production obligation begins.");
    }
    await recordException();
    await this.advance(request, route, next!.id);
  }

  async inspectSalesWorkflowRoute(request: OwnerRouteScope) {
    const result = await this.client.query<RouteRow>("SELECT id,current_step_id FROM v2_route_instances WHERE organization_id=$1 AND order_line_id=$2 AND order_document_id=$3 AND route_state IN ('pending','active')", [request.organizationId, request.orderLineId, request.orderId]);
    const route = result.rows[0];
    if (!route) return { fulfillmentEligible: false };
    const steps = await this.steps(request.organizationId, route.id);
    const current = steps.find(step => step.id === route.current_step_id);
    if (!current) return { fulfillmentEligible: false };
    const fulfillment = steps.find(step => step.position > current.position && step.step_kind === "fulfillment");
    const fulfillmentEligible = Boolean(fulfillment && (current.step_kind === "prepress" || current.step_kind === "production") && !steps.some(step => step.position > current.position && step.position < fulfillment.position && step.step_kind !== "prepress" && step.step_kind !== "production"));
    const production = current.step_kind === "prepress" ? steps.find(step => step.position > current.position && step.step_kind === "production") : undefined;
    const destination = production && !steps.some(step => step.position > current.position && step.position < production.position && step.step_kind !== "prepress") ? production.production_destination_station_key : null;
    return { fulfillmentEligible, ...(destination ? { directProductionDestination: destination } : {}) };
  }

  private async steps(organizationId: string, routeId: string) {
    const result = await this.client.query<StepRow>("SELECT id,position,step_kind,production_destination_station_key FROM v2_route_instance_steps WHERE organization_id=$1 AND route_instance_id=$2 ORDER BY position FOR SHARE", [organizationId, routeId]);
    return result.rows;
  }

  private async advance(request: OwnerRouteScope, route: RouteRow, nextStepId: string) {
    const result = await this.client.query("UPDATE v2_route_instances SET route_state='active',current_step_id=$3,revision=revision+1,updated_at=now() WHERE organization_id=$1 AND id=$2 AND revision=$4 AND order_document_id=$5 AND order_line_id=$6 AND current_step_id=$7 AND route_state IN ('pending','active')", [request.organizationId, route.id, nextStepId, route.revision, request.orderId, request.orderLineId, route.current_step_id]);
    if (result.rowCount === 0) throw new V2ApplicationError("CONFLICT", "The frozen Route changed before its transition could be recorded.");
  }
}
