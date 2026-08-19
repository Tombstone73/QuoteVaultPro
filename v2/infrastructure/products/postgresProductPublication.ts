import type { Pool, PoolClient } from "pg";
import { PostgresOperationRequestRepository } from "../persistence/postgresOperationRequests.js";
import type { ProductPublicationTransaction, ProductPublicationTransactionRunner, PublishedProductVersion } from "../../src/modules/products/productPublication.js";

class Transaction implements ProductPublicationTransaction {
  private readonly requests = new PostgresOperationRequestRepository();
  constructor(private readonly client: PoolClient) {}
  async readDraftPublicationState(input: Parameters<ProductPublicationTransaction["readDraftPublicationState"]>[0]) {
    const row = (await this.client.query<{ product_updated_at: Date; draft_updated_at: Date; status: string }>(
      `SELECT p.updated_at product_updated_at,d.updated_at draft_updated_at,d.status
       FROM products p
       JOIN pbv2_tree_versions d ON d.organization_id=p.organization_id AND d.product_id=p.id
       WHERE p.organization_id=$1 AND p.id=$2 AND d.id=$3`,
      [input.organizationId, input.productId, input.draftVersionId],
    )).rows[0];
    if (!row) return null;
    return {
      productUpdatedAt: row.product_updated_at.toISOString(),
      draftUpdatedAt: row.draft_updated_at.toISOString(),
      lifecycle: row.status === "DRAFT" ? "draft" as const : row.status === "ACTIVE" ? "active" as const : "historical" as const,
    };
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
