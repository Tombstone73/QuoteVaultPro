import type { Pool, PoolClient } from "pg";
import { PostgresOperationRequestRepository } from "../persistence/postgresOperationRequests.js";
import { V2ApplicationError } from "../../src/errors/applicationError.js";
import type { ProductionDestinationStation, RouteTemplateProductionDestination, RouteTemplateProductionDestinationTransaction, RouteTemplateProductionDestinationTransactionRunner } from "../../src/modules/routing/routeTemplateProductionDestinationAuthoring.js";

type Existing = Readonly<{ station_key: ProductionDestinationStation }>;

class Transaction implements RouteTemplateProductionDestinationTransaction {
  private readonly requests = new PostgresOperationRequestRepository();
  constructor(private readonly client: PoolClient) {}
  reserve(input: Parameters<RouteTemplateProductionDestinationTransaction["reserve"]>[0]) { return this.requests.reserve(this.client, input); }
  async set(input: Parameters<RouteTemplateProductionDestinationTransaction["set"]>[0]) {
    const step = (await this.client.query<{ id: string }>(
      `SELECT s.id FROM v2_route_template_steps s
       JOIN v2_route_templates t ON t.organization_id=s.organization_id AND t.id=s.route_template_id
       WHERE s.organization_id=$1 AND s.route_template_id=$2 AND s.id=$3 AND s.step_kind='production'`,
      [input.organizationId, input.routeTemplateId, input.routeTemplateStepId],
    )).rows[0];
    if (!step) throw new V2ApplicationError("NOT_FOUND", "The tenant-scoped production Route Template step was not found.");
    const existing = (await this.client.query<Existing>("SELECT station_key FROM v2_route_template_production_destinations WHERE organization_id=$1 AND route_template_step_id=$2 FOR UPDATE", [input.organizationId, input.routeTemplateStepId])).rows[0];
    await this.client.query(
      `INSERT INTO v2_route_template_production_destinations(organization_id,route_template_id,route_template_step_id,station_key)
       VALUES($1,$2,$3,$4)
       ON CONFLICT (organization_id,route_template_step_id) DO UPDATE SET route_template_id=EXCLUDED.route_template_id,station_key=EXCLUDED.station_key`,
      [input.organizationId, input.routeTemplateId, input.routeTemplateStepId, input.stationKey],
    );
    return { destination: { routeTemplateId: input.routeTemplateId, routeTemplateStepId: input.routeTemplateStepId, stationKey: input.stationKey } satisfies RouteTemplateProductionDestination, ...(existing?.station_key ? { previousStationKey: existing.station_key } : {}) };
  }
  attribute(input: Parameters<RouteTemplateProductionDestinationTransaction["attribute"]>[0]) { return this.requests.recordAttribution(this.client, { organizationId: input.organizationId, operationRequestId: input.requestId, operation: input.operation, resourceType: "route_template_production_destination", resourceId: input.resourceId, principalKind: input.principalKind, principalSubject: input.principalSubject, staffActorUserId: input.staffActorUserId }); }
  async audit(input: Parameters<RouteTemplateProductionDestinationTransaction["audit"]>[0]) {
    await this.client.query(
      "INSERT INTO v2_audit_events(organization_id,operation_request_id,operation,event_type,resource_type,resource_id,principal_kind,principal_subject,staff_actor_user_id,changes) VALUES($1,$2,$3,'route_template_production_destination_set','route_template_production_destination',$4,$5,$6,$7,$8::jsonb)",
      [input.organizationId, input.requestId, input.operation, input.resourceId, input.principalKind, input.principalSubject, input.staffActorUserId ?? null, JSON.stringify([{ routeTemplateId: input.destination.routeTemplateId, routeTemplateStepId: input.destination.routeTemplateStepId, stationKey: input.destination.stationKey, ...(input.previousStationKey ? { previousStationKey: input.previousStationKey } : {}) }])],
    );
  }
  async succeed(organizationId: string, requestId: string, resourceId: string, result: RouteTemplateProductionDestination): Promise<void> { await this.requests.succeed(this.client, organizationId, requestId, { resourceType: "route_template_production_destination", resourceId, resultJson: result }); }
}

export class PostgresRouteTemplateProductionDestinationTransactionRunner implements RouteTemplateProductionDestinationTransactionRunner {
  constructor(private readonly pool: Pool) {}
  async transaction<T>(work: (tx: RouteTemplateProductionDestinationTransaction) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try { await client.query("BEGIN"); const value = await work(new Transaction(client)); await client.query("COMMIT"); return value; }
    catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  }
}
