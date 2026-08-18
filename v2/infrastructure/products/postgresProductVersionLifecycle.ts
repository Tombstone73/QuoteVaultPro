import type { Pool, PoolClient } from "pg";
import { PostgresOperationRequestRepository } from "../persistence/postgresOperationRequests.js";
import type { ProductVersionLifecycle, ProductVersionSummary, ProductVersionTransaction, ProductVersionTransactionRunner } from "../../src/modules/products/productVersionLifecycle.js";
import { V2ApplicationError } from "../../src/errors/applicationError.js";

type VersionRow = { id: string; status: "DRAFT" | "ACTIVE" | "DEPRECATED" | "ARCHIVED"; schema_version: number; tree_json: unknown; created_at: Date; updated_at: Date; published_at: Date | null };
const historyLimit = 25;
const asSummary = (row: VersionRow): ProductVersionSummary => ({ status: row.status.toLowerCase() as ProductVersionSummary["status"], createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString(), ...(row.published_at ? { publishedAt: row.published_at.toISOString() } : {}), editable: row.status === "DRAFT" });

const lifecycle = (rows: readonly VersionRow[], activeId: string | null): ProductVersionLifecycle => {
  const active = activeId ? rows.find((row) => row.id === activeId && row.status === "ACTIVE") : undefined;
  const drafts = rows.filter((row) => row.status === "DRAFT");
  const draft = drafts[0];
  const current = new Set([active?.id, draft?.id]);
  const history = rows.filter((row) => !current.has(row.id)).slice(0, historyLimit).map(asSummary);
  return { ...(active ? { active: asSummary(active) } : {}), ...(draft ? { draft: asSummary(draft) } : {}), history, historyLimit, historyHasMore: rows.filter((row) => !current.has(row.id)).length > historyLimit, canCreateDraft: Boolean(active) && !draft };
};

export class PostgresProductVersionLifecycleReader {
  constructor(private readonly pool: Pool) {}
  async read(organizationId: string, productId: string): Promise<ProductVersionLifecycle | null> {
    const product = await this.pool.query<{ pbv2_active_tree_version_id: string | null }>("SELECT pbv2_active_tree_version_id FROM products WHERE organization_id=$1 AND id=$2", [organizationId, productId]);
    if (!product.rows[0]) return null;
    const versions = await this.pool.query<VersionRow>(`SELECT id,status,schema_version,tree_json,created_at,updated_at,published_at FROM pbv2_tree_versions WHERE organization_id=$1 AND product_id=$2 ORDER BY updated_at DESC,id DESC LIMIT $3`, [organizationId, productId, historyLimit + 3]);
    return lifecycle(versions.rows, product.rows[0].pbv2_active_tree_version_id);
  }
}

class PostgresProductVersionTransaction implements ProductVersionTransaction {
  private readonly requests = new PostgresOperationRequestRepository();
  constructor(private readonly client: PoolClient) {}
  async reserve(input: Parameters<ProductVersionTransaction["reserve"]>[0]) { return this.requests.reserve(this.client, input); }
  async createDraftFromActive(input: Parameters<ProductVersionTransaction["createDraftFromActive"]>[0]) {
    const product = await this.client.query<{ pbv2_active_tree_version_id: string | null }>("SELECT pbv2_active_tree_version_id FROM products WHERE organization_id=$1 AND id=$2 FOR UPDATE", [input.organizationId, input.productId]);
    const activeId = product.rows[0]?.pbv2_active_tree_version_id;
    if (!product.rows[0]) throw new V2ApplicationError("NOT_FOUND", "Product was not found.");
    if (!activeId) throw new V2ApplicationError("CONFLICT", "This Product has no Active version to draft from.");
    const active = await this.client.query<VersionRow>("SELECT id,status,schema_version,tree_json,created_at,updated_at,published_at FROM pbv2_tree_versions WHERE organization_id=$1 AND product_id=$2 AND id=$3 AND status='ACTIVE' FOR UPDATE", [input.organizationId, input.productId, activeId]);
    const source = active.rows[0];
    if (!source) throw new V2ApplicationError("STALE_STATE", "The Product Active version changed. Refresh and try again.");
    if (source.updated_at.toISOString() !== new Date(input.expectedActiveVersionUpdatedAt).toISOString()) throw new V2ApplicationError("STALE_STATE", "The Product Active version changed. Refresh and try again.");
    const existing = await this.client.query<VersionRow>("SELECT id,status,schema_version,tree_json,created_at,updated_at,published_at FROM pbv2_tree_versions WHERE organization_id=$1 AND product_id=$2 AND status='DRAFT' ORDER BY updated_at DESC,id DESC LIMIT 1 FOR UPDATE", [input.organizationId, input.productId]);
    if (existing.rows[0]) throw new V2ApplicationError("CONFLICT", "A Draft already exists for this Product.");
    const now = new Date();
    const inserted = await this.client.query<VersionRow>("INSERT INTO pbv2_tree_versions(organization_id,product_id,status,schema_version,tree_json,created_by_user_id,updated_by_user_id,created_at,updated_at) VALUES($1,$2,'DRAFT',$3,$4::jsonb,$5,$5,$6,$6) RETURNING id,status,schema_version,tree_json,created_at,updated_at,published_at", [input.organizationId, input.productId, source.schema_version, JSON.stringify(source.tree_json), input.staffActorUserId ?? null, now]);
    const all = await this.client.query<VersionRow>("SELECT id,status,schema_version,tree_json,created_at,updated_at,published_at FROM pbv2_tree_versions WHERE organization_id=$1 AND product_id=$2 ORDER BY updated_at DESC,id DESC LIMIT $3", [input.organizationId, input.productId, historyLimit + 3]);
    return { draftId: inserted.rows[0]!.id, lifecycle: lifecycle(all.rows, activeId) };
  }
  async succeed(organizationId: string, requestId: string, draftId: string, result: ProductVersionLifecycle) { await this.requests.succeed(this.client, organizationId, requestId, { resourceType: "product_version", resourceId: draftId, resultJson: result }); }
  async attribute(input: Parameters<ProductVersionTransaction["attribute"]>[0]) { await this.requests.recordAttribution(this.client, { organizationId: input.organizationId, operationRequestId: input.requestId, operation: input.operation, resourceType: "product_version", resourceId: input.resourceId, principalKind: input.principalKind, principalSubject: input.principalSubject, staffActorUserId: input.staffActorUserId }); }
  async audit(input: Parameters<ProductVersionTransaction["audit"]>[0]) { await this.client.query("INSERT INTO v2_audit_events(organization_id,operation_request_id,operation,event_type,resource_type,resource_id,principal_kind,principal_subject,staff_actor_user_id,changes) VALUES($1,$2,$3,'product_draft_created','product_version',$4,$5,$6,$7,'[]'::jsonb)", [input.organizationId,input.requestId,input.operation,input.resourceId,input.principalKind,input.principalSubject,input.staffActorUserId ?? null]); }
}

export class PostgresProductVersionTransactionRunner implements ProductVersionTransactionRunner {
  constructor(private readonly pool: Pool) {}
  async transaction<T>(action: (tx: ProductVersionTransaction) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try { await client.query("BEGIN"); const result = await action(new PostgresProductVersionTransaction(client)); await client.query("COMMIT"); return result; }
    catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  }
}
