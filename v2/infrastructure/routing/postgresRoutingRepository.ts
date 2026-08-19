import { randomUUID } from "node:crypto";
import { V2ApplicationError } from "../../src/errors/applicationError.js";
import {
  brandedId,
  type OrganizationId,
  type RouteInstanceId,
  type RouteInstanceStepId,
  type RouteTemplateId,
} from "../../src/modules/shared/commercialValues.js";
import type {
  InstantiateRouteInput,
  InstantiateRouteResult,
  FrozenRouteDefinition,
  RouteInstance,
  RouteInstanceState,
  RouteInstanceStep,
  RouteStepKind,
  RouteTemplate,
  RouteTemplateStep,
} from "../../src/modules/routing/contracts.js";
import type { TransactionalClient } from "../persistence/types.js";

type TemplateRow = Readonly<{
  id: string; organization_id: string; name: string; active: boolean;
  revision: string; definition_fingerprint: string;
}>;
type TemplateStepRow = Readonly<{ id: string; position: number; step_kind: RouteStepKind }>;
type InstanceRow = Readonly<{
  id: string; organization_id: string; order_document_id: string; order_line_id: string;
  source_template_id: string; source_template_revision: string;
  source_template_fingerprint: string; route_state: RouteInstanceState;
  current_step_id: string | null; revision: string;
}>;
type InstanceStepRow = Readonly<{ id: string; position: number; step_kind: RouteStepKind }>;

export type RoutingPersistenceTestHooks = Readonly<{
  beforeInstanceInsert?: () => Promise<void> | void;
  afterInstance?: () => Promise<void> | void;
  afterFrozenStep?: (position: number) => Promise<void> | void;
}>;

const templateStep = (row: TemplateStepRow): RouteTemplateStep => ({
  routeTemplateStepId: brandedId<"RouteTemplateStepId">(row.id), position: row.position, kind: row.step_kind,
});
const instanceStep = (row: InstanceStepRow): RouteInstanceStep => ({
  routeInstanceStepId: brandedId<"RouteInstanceStepId">(row.id),
  position: row.position, kind: row.step_kind,
});

/**
 * Routing persistence is deliberately transaction-participating: this class
 * never begins, commits, or rolls back. M1.9 will call it with the same client
 * that creates Sales, Billing, Audit, and operation-request state.
 */
export class PostgresRoutingRepository {
  constructor(private readonly client: TransactionalClient, private readonly hooks?: RoutingPersistenceTestHooks) {}

  async resolveRouteTemplate(organizationId: OrganizationId, routeTemplateId: RouteTemplateId): Promise<RouteTemplate | null> {
    const template = await this.template(organizationId, routeTemplateId, true, false);
    return template ? this.readTemplate(template) : null;
  }

  async readRouteInstance(organizationId: OrganizationId, routeInstanceId: RouteInstanceId): Promise<RouteInstance | null> {
    const result = await this.client.query<InstanceRow>(
      "SELECT id,organization_id,order_document_id,order_line_id,source_template_id,source_template_revision,source_template_fingerprint,route_state,current_step_id,revision FROM v2_route_instances WHERE organization_id=$1 AND id=$2",
      [organizationId, routeInstanceId],
    );
    const row = result.rows[0];
    if (!row) return null;
    const steps = await this.client.query<InstanceStepRow>(
      "SELECT id,position,step_kind FROM v2_route_instance_steps WHERE organization_id=$1 AND route_instance_id=$2 ORDER BY position",
      [organizationId, routeInstanceId],
    );
    const routeSteps = steps.rows.map(instanceStep);
    const current = row.current_step_id ? brandedId<"RouteInstanceStepId">(row.current_step_id) : undefined;
    if (current && !routeSteps.some((step) => step.routeInstanceStepId === current))
      throw new Error("Route instance current step is outside its frozen route.");
    return {
      routeInstanceId: brandedId<"RouteInstanceId">(row.id), organizationId: brandedId<"OrganizationId">(row.organization_id),
      work: { kind: "sales_order_line", organizationId: brandedId<"OrganizationId">(row.organization_id), orderId: brandedId<"OrderId">(row.order_document_id), orderLineId: brandedId<"OrderLineId">(row.order_line_id) },
      sourceTemplate: { routeTemplateId: brandedId<"RouteTemplateId">(row.source_template_id), revision: row.source_template_revision, definitionFingerprint: row.source_template_fingerprint },
      state: row.route_state, ...(current ? { currentStepId: current } : {}), revision: row.revision, steps: routeSteps,
    };
  }

  async instantiateRoute(input: InstantiateRouteInput): Promise<InstantiateRouteResult> {
    if (input.organizationId !== input.work.organizationId)
      throw new V2ApplicationError("WRONG_TENANT", "Route work must use the same organization as its Route Instance.");
    const definition = await this.definition(input.organizationId, input);
    if (!definition.steps.length)
      throw new V2ApplicationError("VALIDATION_ERROR", "A Route Template requires at least one step.");

    const routeInstanceId = brandedId<"RouteInstanceId">(randomUUID());
    const frozen = definition.steps.map((step) => ({ id: brandedId<"RouteInstanceStepId">(randomUUID()), source: step }));
    const currentStepId = frozen[0]!.id;
    await this.hooks?.beforeInstanceInsert?.();
    const inserted = await this.client.query<{ id: string }>(
      `INSERT INTO v2_route_instances(id,organization_id,work_kind,order_document_id,order_line_id,source_template_id,source_template_revision,source_template_fingerprint,route_state,current_step_id)
       VALUES($1,$2,'sales_order_line',$3,$4,$5,$6,$7,'pending',$8)
       ON CONFLICT (organization_id,work_kind,order_line_id) DO NOTHING RETURNING id`,
      [routeInstanceId, input.organizationId, input.work.orderId, input.work.orderLineId, definition.sourceTemplate.routeTemplateId, definition.sourceTemplate.revision, definition.sourceTemplate.definitionFingerprint, currentStepId],
    );
    if (!inserted.rows[0]) {
      const existing = await this.readRouteForWork(input.organizationId, input.work.orderLineId);
      if (!existing) throw new Error("Route instance conflict did not return an existing scoped route.");
      if (existing.sourceTemplate.routeTemplateId !== definition.sourceTemplate.routeTemplateId
        || existing.sourceTemplate.revision !== definition.sourceTemplate.revision
        || existing.sourceTemplate.definitionFingerprint !== definition.sourceTemplate.definitionFingerprint)
        throw new V2ApplicationError("CONFLICT", "This Order line already has a Route Instance from a different template.");
      return { routeInstance: existing, created: false };
    }
    await this.hooks?.afterInstance?.();
    for (const step of frozen) {
      await this.client.query(
        "INSERT INTO v2_route_instance_steps(id,organization_id,route_instance_id,position,step_kind) VALUES($1,$2,$3,$4,$5)",
        [step.id, input.organizationId, routeInstanceId, step.source.position, step.source.kind],
      );
      await this.hooks?.afterFrozenStep?.(step.source.position);
    }
    const instance = await this.readRouteInstance(input.organizationId, routeInstanceId);
    if (!instance) throw new Error("New Route Instance could not be read in the caller transaction.");
    return { routeInstance: instance, created: true };
  }

  private async definition(organizationId: OrganizationId, input: InstantiateRouteInput): Promise<FrozenRouteDefinition> {
    if (input.definition) {
      const template = await this.template(organizationId, input.definition.sourceTemplate.routeTemplateId, false, true);
      if (!template) throw new V2ApplicationError("NOT_FOUND", "The Product Version Route Template was not found for this organization.");
      const steps = [...input.definition.steps].sort((a, b) => a.position - b.position);
      if (!steps.length || steps.some((step, index) => !Number.isInteger(step.position) || step.position !== index))
        throw new V2ApplicationError("VALIDATION_ERROR", "The Product Version Route definition is invalid.");
      return { sourceTemplate: input.definition.sourceTemplate, steps };
    }
    if (!input.routeTemplateId) throw new V2ApplicationError("VALIDATION_ERROR", "A Route Template is required.");
    // Template writers acquire FOR UPDATE on this header and revise it in the
    // same transaction as its steps. Legacy Product Type policy snapshots the
    // currently active definition here; version-owned definitions arrive above.
    const template = await this.template(organizationId, input.routeTemplateId, true, true);
    if (!template) throw new V2ApplicationError("NOT_FOUND", "An active Route Template was not found for this organization.");
    const live = await this.readTemplate(template);
    return {
      sourceTemplate: { routeTemplateId: live.routeTemplateId, revision: live.revision, definitionFingerprint: live.definitionFingerprint },
      steps: live.steps.map(({ position, kind }) => ({ position, kind })),
    };
  }

  private async template(organizationId: OrganizationId, routeTemplateId: RouteTemplateId, activeOnly: boolean, lockForSnapshot: boolean): Promise<TemplateRow | null> {
    const result = await this.client.query<TemplateRow>(
      `SELECT id,organization_id,name,active,revision,definition_fingerprint FROM v2_route_templates
       WHERE organization_id=$1 AND id=$2${activeOnly ? " AND active=true" : ""}${lockForSnapshot ? " FOR SHARE" : ""}`,
      [organizationId, routeTemplateId],
    );
    return result.rows[0] ?? null;
  }

  private async readTemplate(row: TemplateRow): Promise<RouteTemplate> {
    const steps = await this.client.query<TemplateStepRow>(
      "SELECT id,position,step_kind FROM v2_route_template_steps WHERE organization_id=$1 AND route_template_id=$2 ORDER BY position FOR SHARE",
      [row.organization_id, row.id],
    );
    return {
      routeTemplateId: brandedId<"RouteTemplateId">(row.id), organizationId: brandedId<"OrganizationId">(row.organization_id),
      name: row.name, active: row.active, revision: row.revision, definitionFingerprint: row.definition_fingerprint,
      steps: steps.rows.map(templateStep),
    };
  }

  async readRouteForWork(organizationId: OrganizationId, orderLineId: string): Promise<RouteInstance | null> {
    const result = await this.client.query<{ id: string }>(
      "SELECT id FROM v2_route_instances WHERE organization_id=$1 AND work_kind='sales_order_line' AND order_line_id=$2",
      [organizationId, orderLineId],
    );
    return result.rows[0] ? this.readRouteInstance(organizationId, brandedId<"RouteInstanceId">(result.rows[0].id)) : null;
  }
}
