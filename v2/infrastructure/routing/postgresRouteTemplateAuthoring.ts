import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { PostgresOperationRequestRepository } from "../persistence/postgresOperationRequests.js";
import { V2ApplicationError } from "../../src/errors/applicationError.js";
import type { RouteTemplate, RouteTemplateStep } from "../../src/modules/routing/contracts.js";
import { routeTemplateFingerprint, type RouteTemplateAuthoringTransaction, type RouteTemplateAuthoringTransactionRunner, type RouteTemplateStepInput } from "../../src/modules/routing/routeTemplateAuthoring.js";
import { brandedId } from "../../src/modules/shared/commercialValues.js";

type Header = { id: string; organization_id: string; name: string; active: boolean; revision: string; definition_fingerprint: string };
type Step = { id: string; position: number; step_kind: "proofing" | "prepress" | "production" | "fulfillment" };
const normal = (name: string) => name.trim().toLocaleLowerCase("en-US");
const route = (header: Header, steps: readonly Step[]): RouteTemplate => ({
  routeTemplateId: brandedId<"RouteTemplateId">(header.id), organizationId: brandedId<"OrganizationId">(header.organization_id), name: header.name, active: header.active, revision: header.revision, definitionFingerprint: header.definition_fingerprint,
  steps: steps.map((step): RouteTemplateStep => ({ routeTemplateStepId: brandedId<"RouteTemplateStepId">(step.id), position: step.position, kind: step.step_kind })),
});
class Transaction implements RouteTemplateAuthoringTransaction {
  private readonly requests = new PostgresOperationRequestRepository();
  constructor(private readonly client: PoolClient) {}
  reserve(input: Parameters<RouteTemplateAuthoringTransaction["reserve"]>[0]) { return this.requests.reserve(this.client, input); }
  async create(input: Parameters<RouteTemplateAuthoringTransaction["create"]>[0]): Promise<RouteTemplate> {
    const id = randomUUID(), fingerprint = routeTemplateFingerprint(input.name, input.steps);
    let header: Header;
    try {
      header = (await this.client.query<Header>("INSERT INTO v2_route_templates(id,organization_id,name,normalized_name,active,revision,definition_fingerprint) VALUES($1,$2,$3,$4,TRUE,1,$5) RETURNING id,organization_id,name,active,revision::text,definition_fingerprint", [id,input.organizationId,input.name,normal(input.name),fingerprint])).rows[0]!;
    } catch (error: any) { if (error?.code === "23505") throw new V2ApplicationError("CONFLICT", "A Route Template with that name already exists."); throw error; }
    const rows: Step[] = [];
    for (const step of input.steps) rows.push((await this.client.query<Step>("INSERT INTO v2_route_template_steps(id,organization_id,route_template_id,position,step_kind) VALUES($1,$2,$3,$4,$5) RETURNING id,position,step_kind", [randomUUID(),input.organizationId,id,step.position,step.kind])).rows[0]!);
    return route(header, rows);
  }
  async update(input: Parameters<RouteTemplateAuthoringTransaction["update"]>[0]): Promise<RouteTemplate> {
    const current = (await this.client.query<Header>("SELECT id,organization_id,name,active,revision::text,definition_fingerprint FROM v2_route_templates WHERE organization_id=$1 AND id=$2 FOR UPDATE", [input.organizationId,input.routeTemplateId])).rows[0];
    if (!current) throw new V2ApplicationError("NOT_FOUND", "The tenant-scoped Route Template was not found.");
    if (current.revision !== input.expectedRevision) throw new V2ApplicationError("STALE_STATE", "The Route Template changed elsewhere. Refresh and try again.");
    const fingerprint = routeTemplateFingerprint(input.name, input.steps);
    let header: Header;
    try {
      header = (await this.client.query<Header>("UPDATE v2_route_templates SET name=$1,normalized_name=$2,active=$3,revision=revision+1,definition_fingerprint=$4,updated_at=now() WHERE organization_id=$5 AND id=$6 RETURNING id,organization_id,name,active,revision::text,definition_fingerprint", [input.name,normal(input.name),input.active,fingerprint,input.organizationId,input.routeTemplateId])).rows[0]!;
    } catch (error: any) { if (error?.code === "23505") throw new V2ApplicationError("CONFLICT", "A Route Template with that name already exists."); throw error; }
    await this.client.query("DELETE FROM v2_route_template_steps WHERE organization_id=$1 AND route_template_id=$2", [input.organizationId,input.routeTemplateId]);
    const rows: Step[]=[];
    for (const step of input.steps) rows.push((await this.client.query<Step>("INSERT INTO v2_route_template_steps(id,organization_id,route_template_id,position,step_kind) VALUES($1,$2,$3,$4,$5) RETURNING id,position,step_kind", [randomUUID(),input.organizationId,input.routeTemplateId,step.position,step.kind])).rows[0]!);
    return route(header, rows);
  }
  attribute(input: Parameters<RouteTemplateAuthoringTransaction["attribute"]>[0]) { return this.requests.recordAttribution(this.client, { organizationId:input.organizationId, operationRequestId:input.requestId, operation:input.operation, resourceType:"route_template", resourceId:input.resourceId, principalKind:input.principalKind, principalSubject:input.principalSubject, staffActorUserId:input.staffActorUserId }); }
  async audit(input: Parameters<RouteTemplateAuthoringTransaction["audit"]>[0]) { await this.client.query("INSERT INTO v2_audit_events(organization_id,operation_request_id,operation,event_type,resource_type,resource_id,principal_kind,principal_subject,staff_actor_user_id,changes) VALUES($1,$2,$3,$4,'route_template',$5,$6,$7,$8,'[]'::jsonb)", [input.organizationId,input.requestId,input.operation,input.event,input.resourceId,input.principalKind,input.principalSubject,input.staffActorUserId ?? null]); }
  async succeed(organizationId:string,requestId:string,resourceId:string,result:RouteTemplate) { await this.requests.succeed(this.client,organizationId,requestId,{resourceType:"route_template",resourceId,resultJson:result}); }
}
export class PostgresRouteTemplateAuthoringTransactionRunner implements RouteTemplateAuthoringTransactionRunner {
  constructor(private readonly pool: Pool) {}
  async transaction<T>(work: (tx: RouteTemplateAuthoringTransaction) => Promise<T>): Promise<T> { const client=await this.pool.connect(); try { await client.query("BEGIN"); const value=await work(new Transaction(client)); await client.query("COMMIT"); return value; } catch(error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); } }
}
