import type { Pool, PoolClient } from "pg";
import type { TransactionalClient } from "../persistence/types.js";
import { PostgresOperationRequestRepository } from "../persistence/postgresOperationRequests.js";
import { V2ApplicationError } from "../../src/errors/applicationError.js";
import type { ProductDraftRouting, ProductRoutingPolicy, ProductRoutingTransaction, ProductRoutingTransactionRunner } from "../../src/modules/products/productRouting.js";

type StepKind = "proofing" | "prepress" | "production" | "fulfillment";
type TemplateRow = { id: string; name: string; active: boolean; revision: string; definition_fingerprint: string };
type TemplateStepRow = { position: number; step_kind: StepKind };
type SpecRow = { routing_mode: "route_required" | "no_route" | "unconfigured"; route_template_id: string | null; source_template_revision: string | null; source_template_fingerprint: string | null; steps_json: unknown };
type DraftRow = { id: string; updated_at: Date; status: string };
const asSteps = (value: unknown): readonly Readonly<{ position: number; kind: StepKind }>[] => Array.isArray(value)
  ? value.flatMap((item) => item && typeof item === "object" && Number.isInteger((item as { position?: unknown }).position) && ["proofing", "prepress", "production", "fulfillment"].includes(String((item as { kind?: unknown }).kind)) ? [{ position: (item as { position: number }).position, kind: (item as { kind: StepKind }).kind }] : [])
  : [];

const projection = (input: { productId: string; draft: DraftRow; policy: ProductRoutingPolicy }): ProductDraftRouting => ({
  productId: input.productId, draftVersionId: input.draft.id, draftUpdatedAt: input.draft.updated_at.toISOString(), lifecycle: "draft", routing: input.policy,
});

export class PostgresProductDraftRoutingReader {
  constructor(private readonly pool: Pool) {}
  async read(organizationId: string, productId: string): Promise<ProductDraftRouting | null> {
    const client = await this.pool.connect();
    try {
      const draft = (await client.query<DraftRow>("SELECT id,updated_at,status FROM pbv2_tree_versions WHERE organization_id=$1 AND product_id=$2 AND status='DRAFT' ORDER BY updated_at DESC,id DESC LIMIT 1", [organizationId, productId])).rows[0];
      if (!draft) return null;
      return projection({ productId, draft, policy: await readPolicy(client, organizationId, productId, draft.id) });
    } finally { client.release(); }
  }
}

/** Used by Sales to obtain the route selection bound to the priced PBV2 version. */
export class PostgresProductVersionRoutingReader {
  constructor(private readonly client: TransactionalClient) {}
  async read(organizationId: string, productId: string, productVersionId: string): Promise<ProductRoutingPolicy> {
    return readPolicy(this.client, organizationId, productId, productVersionId);
  }
}

const readPolicy = async (client: TransactionalClient, organizationId: string, productId: string, versionId: string): Promise<ProductRoutingPolicy> => {
  const spec = (await client.query<SpecRow>("SELECT routing_mode,route_template_id,source_template_revision,source_template_fingerprint,steps_json FROM v2_product_version_routing_specs WHERE organization_id=$1 AND product_id=$2 AND product_version_id=$3", [organizationId, productId, versionId])).rows[0];
  if (spec) {
    if (spec.routing_mode === "no_route") return { kind: "no_route" };
    if (spec.routing_mode === "unconfigured") return { kind: "unconfigured" };
    if (!spec.route_template_id || !spec.source_template_revision || !spec.source_template_fingerprint)
      throw new V2ApplicationError("CONFLICT", "The Product Version has an invalid frozen Routing definition.");
    const template = (await client.query<{ name: string }>("SELECT name FROM v2_route_templates WHERE organization_id=$1 AND id=$2", [organizationId, spec.route_template_id])).rows[0];
    const steps = asSteps(spec.steps_json);
    if (!template || !steps.length || steps.some((step, index) => step.position !== index))
      throw new V2ApplicationError("CONFLICT", "The Product Version has an invalid frozen Routing definition.");
    return { kind: "route_required", routeTemplateId: spec.route_template_id, routeTemplateName: template.name, sourceTemplateRevision: spec.source_template_revision, sourceTemplateFingerprint: spec.source_template_fingerprint, steps };
  }
  // Existing catalog Product Versions legitimately predate the version-owned
  // selection. Preserve the old explicit Product Type policy as a read-only
  // compatibility fallback; Draft authoring writes the version-owned table.
  const legacy = (await client.query<{ routing_mode: "route_required" | "no_route" | "unconfigured"; default_route_template_id: string | null }>(
    "SELECT pt.routing_mode,pt.default_route_template_id FROM products p JOIN product_types pt ON pt.organization_id=p.organization_id AND pt.id=p.product_type_id WHERE p.organization_id=$1 AND p.id=$2",
    [organizationId, productId],
  )).rows[0];
  if (legacy?.routing_mode !== "route_required" || !legacy.default_route_template_id) return legacy?.routing_mode === "no_route" ? { kind: "no_route" } : { kind: "unconfigured" };
  const template = (await client.query<TemplateRow>("SELECT id,name,active,revision,definition_fingerprint FROM v2_route_templates WHERE organization_id=$1 AND id=$2 AND active=true", [organizationId, legacy.default_route_template_id])).rows[0];
  if (!template) return { kind: "unconfigured" };
  const steps = (await client.query<TemplateStepRow>("SELECT position,step_kind FROM v2_route_template_steps WHERE organization_id=$1 AND route_template_id=$2 ORDER BY position", [organizationId, template.id])).rows.map((step) => ({ position: step.position, kind: step.step_kind }));
  return steps.length ? { kind: "route_required", routeTemplateId: template.id, routeTemplateName: template.name, sourceTemplateRevision: template.revision, sourceTemplateFingerprint: template.definition_fingerprint, steps } : { kind: "unconfigured" };
};

class Transaction implements ProductRoutingTransaction {
  private readonly requests = new PostgresOperationRequestRepository();
  constructor(private readonly client: PoolClient) {}
  reserve(input: Parameters<ProductRoutingTransaction["reserve"]>[0]) { return this.requests.reserve(this.client, input); }
  async replaceDraftRouting(input: Parameters<ProductRoutingTransaction["replaceDraftRouting"]>[0]): Promise<ProductDraftRouting> {
    const draft = (await this.client.query<DraftRow>("SELECT id,updated_at,status FROM pbv2_tree_versions WHERE organization_id=$1 AND product_id=$2 AND id=$3 FOR UPDATE", [input.organizationId, input.productId, input.draftVersionId])).rows[0];
    if (!draft || draft.status !== "DRAFT") throw new V2ApplicationError("CONFLICT", "Only the current Product Draft can be edited.");
    if (draft.updated_at.toISOString() !== new Date(input.expectedDraftUpdatedAt).toISOString()) throw new V2ApplicationError("STALE_STATE", "This Product Draft changed elsewhere. Refresh and try again.");
    let policy: ProductRoutingPolicy = input.routing;
    if (input.routing.kind === "route_required") {
      const template = (await this.client.query<TemplateRow>("SELECT id,name,active,revision,definition_fingerprint FROM v2_route_templates WHERE organization_id=$1 AND id=$2 AND active=true FOR SHARE", [input.organizationId, input.routing.routeTemplateId])).rows[0];
      if (!template) throw new V2ApplicationError("NOT_FOUND", "An active Route Template was not found for this organization.");
      const steps = (await this.client.query<TemplateStepRow>("SELECT position,step_kind FROM v2_route_template_steps WHERE organization_id=$1 AND route_template_id=$2 ORDER BY position FOR SHARE", [input.organizationId, template.id])).rows.map((step) => ({ position: step.position, kind: step.step_kind }));
      if (!steps.length || steps.some((step, index) => step.position !== index)) throw new V2ApplicationError("VALIDATION_ERROR", "A Route Template requires ordered steps.");
      policy = { kind: "route_required", routeTemplateId: template.id, routeTemplateName: template.name, sourceTemplateRevision: template.revision, sourceTemplateFingerprint: template.definition_fingerprint, steps };
      await this.client.query(
        `INSERT INTO v2_product_version_routing_specs(organization_id,product_id,product_version_id,routing_mode,route_template_id,source_template_revision,source_template_fingerprint,steps_json,updated_by_user_id)
         VALUES($1,$2,$3,'route_required',$4,$5,$6,$7::jsonb,$8)
         ON CONFLICT(organization_id,product_version_id) DO UPDATE SET routing_mode=EXCLUDED.routing_mode,route_template_id=EXCLUDED.route_template_id,source_template_revision=EXCLUDED.source_template_revision,source_template_fingerprint=EXCLUDED.source_template_fingerprint,steps_json=EXCLUDED.steps_json,updated_by_user_id=EXCLUDED.updated_by_user_id,updated_at=now()`,
        [input.organizationId, input.productId, draft.id, template.id, template.revision, template.definition_fingerprint, JSON.stringify(steps), input.staffActorUserId ?? null],
      );
    } else {
      await this.client.query(
        `INSERT INTO v2_product_version_routing_specs(organization_id,product_id,product_version_id,routing_mode,updated_by_user_id)
         VALUES($1,$2,$3,$4,$5)
         ON CONFLICT(organization_id,product_version_id) DO UPDATE SET routing_mode=EXCLUDED.routing_mode,route_template_id=NULL,source_template_revision=NULL,source_template_fingerprint=NULL,steps_json=NULL,updated_by_user_id=EXCLUDED.updated_by_user_id,updated_at=now()`,
        [input.organizationId, input.productId, draft.id, input.routing.kind, input.staffActorUserId ?? null],
      );
    }
    const updated = (await this.client.query<DraftRow>("UPDATE pbv2_tree_versions SET updated_at=now(),updated_by_user_id=$1 WHERE organization_id=$2 AND product_id=$3 AND id=$4 AND status='DRAFT' RETURNING id,updated_at,status", [input.staffActorUserId ?? null, input.organizationId, input.productId, draft.id])).rows[0]!;
    return projection({ productId: input.productId, draft: updated, policy });
  }
  attribute(input: Parameters<ProductRoutingTransaction["attribute"]>[0]) { return this.requests.recordAttribution(this.client, { organizationId: input.organizationId, operationRequestId: input.requestId, operation: input.operation, resourceType: "product_version", resourceId: input.resourceId, principalKind: input.principalKind, principalSubject: input.principalSubject, staffActorUserId: input.staffActorUserId }); }
  async audit(input: Parameters<ProductRoutingTransaction["audit"]>[0]) { await this.client.query("INSERT INTO v2_audit_events(organization_id,operation_request_id,operation,event_type,resource_type,resource_id,principal_kind,principal_subject,staff_actor_user_id,changes) VALUES($1,$2,$3,'product_draft_routing_updated','product_version',$4,$5,$6,$7,'[]'::jsonb)", [input.organizationId,input.requestId,input.operation,input.resourceId,input.principalKind,input.principalSubject,input.staffActorUserId ?? null]); }
  async succeed(organizationId: string, requestId: string, resourceId: string, result: ProductDraftRouting) { await this.requests.succeed(this.client, organizationId, requestId, { resourceType: "product_version", resourceId, resultJson: result }); }
}
export class PostgresProductRoutingTransactionRunner implements ProductRoutingTransactionRunner {
  constructor(private readonly pool: Pool) {}
  async transaction<T>(work: (tx: ProductRoutingTransaction) => Promise<T>): Promise<T> { const client = await this.pool.connect(); try { await client.query("BEGIN"); const result = await work(new Transaction(client)); await client.query("COMMIT"); return result; } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); } }
}
