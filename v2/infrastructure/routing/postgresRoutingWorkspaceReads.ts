import type { Pool } from "pg";
import type { RouteStepKind, RouteInstanceState } from "../../src/modules/routing/contracts.js";
import type { RoutingWorkspaceRead, RoutingWorkspaceReadPort } from "../../src/modules/routing/workspaceReads.js";
import { brandedId } from "../../src/modules/shared/commercialValues.js";
import { readRoutePrerequisite } from "./postgresRoutePrerequisites.js";

const limit = 100;

/** Canonical Routing/Sales read projection; no route state is copied or written. */
export class PostgresRoutingWorkspaceReads implements RoutingWorkspaceReadPort {
  constructor(private readonly pool: Pool) {}
  async workspace(organizationId: string): Promise<RoutingWorkspaceRead> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
      const templates = await client.query<{ id: string; name: string; active: boolean; revision: string; definition_fingerprint: string }>(
        "SELECT id,name,active,revision,definition_fingerprint FROM v2_route_templates WHERE organization_id=$1 ORDER BY lower(name),id LIMIT $2", [organizationId, limit]);
      const templateSteps = await client.query<{ route_template_id: string; position: number; step_kind: RouteStepKind }>(
        "SELECT route_template_id,position,step_kind FROM v2_route_template_steps WHERE organization_id=$1 ORDER BY route_template_id,position", [organizationId]);
      const instances = await client.query<{ id: string; route_state: RouteInstanceState; revision: string; current_step_id: string | null; source_template_id: string; source_template_revision: string; source_template_fingerprint: string; order_document_id: string; order_line_id: string; display_number: string; line_description: string }>(
        `SELECT r.id,r.route_state,r.revision,r.current_step_id,r.source_template_id,r.source_template_revision,r.source_template_fingerprint,r.order_document_id,r.order_line_id,d.display_number,l.description AS line_description
         FROM v2_route_instances r JOIN v2_sales_documents d ON d.organization_id=r.organization_id AND d.id=r.order_document_id
         JOIN v2_sales_document_lines l ON l.organization_id=r.organization_id AND l.document_id=r.order_document_id AND l.id=r.order_line_id
         WHERE r.organization_id=$1 ORDER BY r.updated_at DESC,r.id LIMIT $2`, [organizationId, limit]);
      const instanceSteps = await client.query<{ route_instance_id: string; id: string; position: number; step_kind: RouteStepKind }>(
        "SELECT route_instance_id,id,position,step_kind FROM v2_route_instance_steps WHERE organization_id=$1 ORDER BY route_instance_id,position", [organizationId]);
      const prerequisiteByRoute = new Map<string, Awaited<ReturnType<typeof readRoutePrerequisite>>>();
      for (const row of instances.rows) {
        const current = instanceSteps.rows.find((step) => step.route_instance_id === row.id && step.id === row.current_step_id);
        if (current) prerequisiteByRoute.set(row.id, await readRoutePrerequisite(client, brandedId<"OrganizationId">(organizationId), brandedId<"OrderLineId">(row.order_line_id), current.step_kind));
      }
      await client.query("COMMIT");
      return {
        templates: templates.rows.map((row) => ({ routeTemplateId: row.id, name: row.name, active: row.active, revision: row.revision, definitionFingerprint: row.definition_fingerprint, steps: templateSteps.rows.filter((step) => step.route_template_id === row.id).map(({ position, step_kind }) => ({ position, kind: step_kind })) })),
        instances: instances.rows.map((row) => ({ routeInstanceId: row.id, state: row.route_state, revision: row.revision, ...(row.current_step_id ? { currentStepId: row.current_step_id } : {}), ...(prerequisiteByRoute.has(row.id) ? { currentPrerequisite: prerequisiteByRoute.get(row.id)! } : {}), sourceTemplate: { routeTemplateId: row.source_template_id, revision: row.source_template_revision, definitionFingerprint: row.source_template_fingerprint }, orderId: row.order_document_id, orderNumber: row.display_number, orderLineId: row.order_line_id, lineDescription: row.line_description, steps: instanceSteps.rows.filter((step) => step.route_instance_id === row.id).map((step) => ({ routeInstanceStepId: step.id, position: step.position, kind: step.step_kind })) })),
      };
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }
}
