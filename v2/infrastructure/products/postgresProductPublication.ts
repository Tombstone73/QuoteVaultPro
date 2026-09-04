import type { Pool, PoolClient } from "pg";
import { PostgresOperationRequestRepository } from "../persistence/postgresOperationRequests.js";
import type { ProductPublicationTransaction, ProductPublicationTransactionRunner, PublishedProductVersion } from "../../src/modules/products/productPublication.js";
import { PostgresProductVersionRoutingReader } from "./postgresProductRouting.js";
import { validateProductionUnitSpecification } from "../../src/modules/shared/productionRequirements.js";
import { V2ApplicationError } from "../../src/errors/applicationError.js";

type WorkflowIntent = "standard_production" | "fulfillment_only" | "service_fee";

const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};

/**
 * General settings are Draft-owned until the canonical publisher projects
 * them to products. Publish eligibility must therefore read the Draft tree,
 * not the previous Active Product projection.
 */
const draftWorkflow = (
  tree: unknown,
  fallback: Readonly<{ workflowIntent: WorkflowIntent; requiresProductionJob: boolean }>,
) => {
  const general = record(record(tree).meta).general;
  const value = record(general);
  const workflowIntent = value.workflowIntent === "standard_production" || value.workflowIntent === "fulfillment_only" || value.workflowIntent === "service_fee"
    ? value.workflowIntent
    : fallback.workflowIntent;
  const requiresProductionJob = typeof value.requiresProductionJob === "boolean"
    ? value.requiresProductionJob
    : fallback.requiresProductionJob;
  return { workflowIntent, requiresProductionJob };
};

const hasProductionUnitRules = (tree: unknown): boolean => {
  const specification = record(record(tree).meta).productionUnitSpecification;
  if (specification === undefined || specification === null) return false;
  try {
    return validateProductionUnitSpecification(specification).rules.length > 0;
  } catch {
    return false;
  }
};

/**
 * Retires only the empty starter GROUP used by older V2 drafts. A GROUP with
 * children or structural edges is merchant-authored data and must remain
 * untouched. The canonical publisher rejects a GROUP root, so normalize the
 * harmless scaffold before it receives an otherwise publishable draft.
 */
const normalizeLegacyDraftScaffold = (tree: unknown): { tree: Record<string, unknown>; changed: boolean } => {
  const candidate = structuredClone(record(tree));
  const roots = Array.isArray(candidate.rootNodeIds)
    ? candidate.rootNodeIds.filter((id): id is string => typeof id === "string")
    : [];
  if (!roots.includes("product_configuration")) return { tree: candidate, changed: false };
  const nodes = record(candidate.nodes);
  const scaffold = record(nodes.product_configuration);
  const otherRoots = roots.filter((id) => id !== "product_configuration");
  const hasSemanticRoot = otherRoots.some((id) => record(nodes[id]).kind === "question");
  const edges = Array.isArray(candidate.edges) ? candidate.edges : [];
  const hasStructuralEdge = edges.some((edge) => {
    const value = record(edge);
    return value.fromNodeId === "product_configuration" || value.toNodeId === "product_configuration";
  });
  if (
    scaffold.kind !== "group" ||
    scaffold.label !== "Product configuration" ||
    (Array.isArray(scaffold.children) && scaffold.children.length > 0) ||
    hasStructuralEdge ||
    !hasSemanticRoot
  )
    return { tree: candidate, changed: false };
  delete nodes.product_configuration;
  candidate.nodes = nodes;
  candidate.rootNodeIds = otherRoots;
  return { tree: candidate, changed: true };
};

class Transaction implements ProductPublicationTransaction {
  private readonly requests = new PostgresOperationRequestRepository();
  constructor(private readonly client: PoolClient) {}
  async readDraftPublicationState(input: Parameters<ProductPublicationTransaction["readDraftPublicationState"]>[0]) {
    const row = (await this.client.query<{ product_updated_at: Date; draft_updated_at: Date; status: string; workflow_intent:WorkflowIntent; requires_production_job:boolean; tree_json: unknown }>(
      `SELECT p.updated_at product_updated_at,p.workflow_intent,p.requires_production_job,d.updated_at draft_updated_at,d.status,d.tree_json
       FROM products p
       JOIN pbv2_tree_versions d ON d.organization_id=p.organization_id AND d.product_id=p.id
       WHERE p.organization_id=$1 AND p.id=$2 AND d.id=$3`,
      [input.organizationId, input.productId, input.draftVersionId],
    )).rows[0];
    if (!row) return null;
    const workflow = draftWorkflow(row.tree_json, {
      workflowIntent: row.workflow_intent,
      requiresProductionJob: row.requires_production_job,
    });
    return {
      productUpdatedAt: row.product_updated_at.toISOString(),
      draftUpdatedAt: row.draft_updated_at.toISOString(),
      lifecycle: row.status === "DRAFT" ? "draft" as const : row.status === "ACTIVE" ? "active" as const : "historical" as const,
      workflowIntent: workflow.workflowIntent,
      requiresProductionJob: workflow.requiresProductionJob,
      hasProductionUnitRules: hasProductionUnitRules(row.tree_json),
      routing: await new PostgresProductVersionRoutingReader(this.client).read(input.organizationId,input.productId,input.draftVersionId),
    };
  }
  async normalizeLegacyDraftScaffold(input: Parameters<ProductPublicationTransaction["normalizeLegacyDraftScaffold"]>[0]) {
    const row = (await this.client.query<{ updated_at: Date; status: string; tree_json: unknown }>(
      `SELECT updated_at,status,tree_json FROM pbv2_tree_versions
       WHERE organization_id=$1 AND product_id=$2 AND id=$3 FOR UPDATE`,
      [input.organizationId, input.productId, input.draftVersionId],
    )).rows[0];
    if (!row || row.status !== "DRAFT")
      throw new V2ApplicationError("CONFLICT", "Only the current Product Draft can be published.");
    if (row.updated_at.toISOString() !== new Date(input.expectedDraftUpdatedAt).toISOString())
      throw new V2ApplicationError("STALE_STATE", "The Product Draft changed before publication. Refresh and try again.");
    const normalized = normalizeLegacyDraftScaffold(row.tree_json);
    if (!normalized.changed) return;
    const updated = await this.client.query<{ updated_at: Date }>(
      `UPDATE pbv2_tree_versions SET tree_json=$1::jsonb,updated_at=now(),updated_by_user_id=$2
       WHERE organization_id=$3 AND product_id=$4 AND id=$5 AND status='DRAFT' AND updated_at=$6
       RETURNING updated_at`,
      [
        JSON.stringify(normalized.tree),
        input.staffActorUserId ?? null,
        input.organizationId,
        input.productId,
        input.draftVersionId,
        row.updated_at,
      ],
    );
    if (!updated.rows[0])
      throw new V2ApplicationError("STALE_STATE", "The Product Draft changed before publication. Refresh and try again.");
  }
  async reserve(input: Parameters<ProductPublicationTransaction["reserve"]>[0]) { return this.requests.reserve(this.client, input); }
  async succeed(organizationId: string, requestId: string, result: PublishedProductVersion) { await this.requests.succeed(this.client, organizationId, requestId, { resourceType: "product_version", resourceId: result.productVersionId, resultJson: result }); }
  async markRetryableFailure(organizationId: string, requestId: string) { await this.requests.markRetryableFailure(this.client, organizationId, requestId); }
  async attribute(input: Parameters<ProductPublicationTransaction["attribute"]>[0]) { await this.requests.recordAttribution(this.client, { organizationId: input.organizationId, operationRequestId: input.requestId, operation: input.operation, resourceType: "product_version", resourceId: input.resourceId, principalKind: input.principalKind, principalSubject: input.principalSubject, staffActorUserId: input.staffActorUserId }); }
  async audit(input: Parameters<ProductPublicationTransaction["audit"]>[0]) { await this.client.query("INSERT INTO v2_audit_events(organization_id,operation_request_id,operation,event_type,resource_type,resource_id,principal_kind,principal_subject,staff_actor_user_id,changes) VALUES($1,$2,$3,'product_draft_published','product_version',$4,$5,$6,$7,$8::jsonb)",[input.organizationId,input.requestId,input.operation,input.resourceId,input.principalKind,input.principalSubject,input.staffActorUserId??null,JSON.stringify([{kind:"product_draft_published"}])]); }
}

export class PostgresProductPublicationTransactionRunner implements ProductPublicationTransactionRunner {
  constructor(private readonly pool: Pool) {}
  async transaction<T>(action: (transaction: ProductPublicationTransaction) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try { await client.query("BEGIN"); const result = await action(new Transaction(client)); await client.query("COMMIT"); return result; }
    catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }
}
