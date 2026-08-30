import { createHash } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { PostgresOperationRequestRepository } from "../persistence/postgresOperationRequests.js";
import type { ArtworkTransaction, ArtworkTransactionRunner } from "../../src/modules/artwork/artworkApplication.js";
import type { ArtworkAssignment, ArtworkFile, ArtworkFileInput, OrderLineArtworkProjection } from "../../src/modules/artwork/contracts.js";
import { brandedId, type ArtworkAssignmentId, type ArtworkFileId, type OrganizationId } from "../../src/modules/shared/commercialValues.js";
import { V2ApplicationError } from "../../src/errors/applicationError.js";

type FileRow = Readonly<{
  id: string; organization_id: string; storage_provider: string; object_key: string; object_version: string;
  original_filename: string; display_filename: string; content_type: string; byte_size: string;
  checksum_algorithm: "sha256" | null; checksum_value: string | null; source_kind: "customer_upload" | "prepress_derived" | "imported";
  page_count: number | null; detected_width_microns: number | null; detected_height_microns: number | null;
  derived_from_artwork_file_id: string | null; created_at: Date;
}>;
type AssignmentRow = Readonly<{
  id: string; organization_id: string; artwork_file_id: string; order_document_id: string; order_line_id: string;
  purpose: "customer_supplied" | "production" | "proof" | "reference"; side: "front" | "back" | null;
  source_page_index: number | null; layer_key: string | null; layer_order: number | null; supersedes_artwork_assignment_id: string | null; created_at: Date;
}>;
type ProjectionRow = FileRow & Readonly<{
  assignment_id: string; assignment_organization_id: string; artwork_file_id: string; order_document_id: string; order_line_id: string;
  purpose: AssignmentRow["purpose"]; side: AssignmentRow["side"]; source_page_index: number | null; layer_key: string | null; layer_order: number | null; supersedes_artwork_assignment_id: string | null; assignment_created_at: Date;
}>;
const file = (row: FileRow): ArtworkFile => ({
  id: brandedId<"ArtworkFileId">(row.id), organizationId: brandedId<"OrganizationId">(row.organization_id),
  objectReference: { storageProvider: row.storage_provider, objectKey: row.object_key, ...(row.object_version ? { objectVersion: row.object_version } : {}) },
  originalFilename: row.original_filename, displayFilename: row.display_filename, contentType: row.content_type, byteSize: Number(row.byte_size),
  ...(row.checksum_algorithm && row.checksum_value ? { checksum: { algorithm: row.checksum_algorithm, value: row.checksum_value } } : {}),
  source: row.source_kind, ...(row.page_count !== null ? { pageCount: row.page_count } : {}),
  ...(row.detected_width_microns !== null ? { detectedWidthMicrons: row.detected_width_microns } : {}),
  ...(row.detected_height_microns !== null ? { detectedHeightMicrons: row.detected_height_microns } : {}),
  ...(row.derived_from_artwork_file_id ? { derivedFromArtworkFileId: brandedId<"ArtworkFileId">(row.derived_from_artwork_file_id) } : {}),
  createdAt: row.created_at.toISOString(),
});
const assignment = (row: AssignmentRow): ArtworkAssignment => ({
  id: brandedId<"ArtworkAssignmentId">(row.id), organizationId: brandedId<"OrganizationId">(row.organization_id), artworkFileId: brandedId<"ArtworkFileId">(row.artwork_file_id),
  orderId: brandedId<"OrderId">(row.order_document_id), orderLineId: brandedId<"OrderLineId">(row.order_line_id), purpose: row.purpose,
  ...(row.side ? { side: row.side } : {}), ...(row.source_page_index !== null ? { sourcePageIndex: row.source_page_index } : {}),
  ...(row.layer_key !== null ? { layerKey: row.layer_key } : {}), ...(row.layer_order !== null ? { layerOrder: row.layer_order } : {}), ...(row.supersedes_artwork_assignment_id ? { supersedesArtworkAssignmentId: brandedId<"ArtworkAssignmentId">(row.supersedes_artwork_assignment_id) } : {}), createdAt: row.created_at.toISOString(),
});

/** One PostgreSQL client is shared with M0 reservation, attribution, and audit. */
export class PostgresArtworkTransaction implements ArtworkTransaction {
  private readonly requests = new PostgresOperationRequestRepository();
  constructor(private readonly client: PoolClient, private readonly hooks?: Readonly<{ afterFile?: () => Promise<void>; afterAssignment?: () => Promise<void>; afterAudit?: () => Promise<void> }>) {}
  async reserve(input: Parameters<ArtworkTransaction["reserve"]>[0]) { const r = await this.requests.reserve(this.client, input); return { kind: r.kind, request: { id: r.request.id, resultJson: r.request.resultJson } }; }
  async succeed(organizationId: string, requestId: string, result: Parameters<ArtworkTransaction["succeed"]>[2]) { await this.requests.succeed(this.client, organizationId, requestId, { resourceType: "artwork_file", resourceId: result.artworkFile.id, resultJson: result }); }
  async attribute(input: Parameters<ArtworkTransaction["attribute"]>[0]) { await this.requests.recordAttribution(this.client, input); }
  async audit(input: Parameters<ArtworkTransaction["audit"]>[0]) {
    await this.client.query("INSERT INTO v2_audit_events(organization_id,operation_request_id,operation,event_type,resource_type,resource_id,principal_kind,principal_subject,staff_actor_user_id,changes) VALUES($1,$2,$3,$4,'artwork_file',$5,$6,$7,$8,$9::jsonb)", [input.organizationId,input.requestId,input.operation,input.eventType,input.resourceId,input.principalKind,input.principalSubject,input.staffActorUserId ?? null,JSON.stringify(input.changes)]);
    await this.hooks?.afterAudit?.();
  }
  async findFile(organizationId: OrganizationId, artworkFileId: ArtworkFileId): Promise<ArtworkFile | null> {
    const r = await this.client.query<FileRow>("SELECT * FROM v2_artwork_files WHERE organization_id=$1 AND id=$2", [organizationId, artworkFileId]); return r.rows[0] ? file(r.rows[0]) : null;
  }
  async findOrderLineArtwork(organizationId: OrganizationId, orderLineId: string): Promise<readonly OrderLineArtworkProjection[]> {
    const r = await this.client.query<ProjectionRow>("SELECT a.id AS assignment_id,a.organization_id AS assignment_organization_id,a.artwork_file_id,a.order_document_id,a.order_line_id,a.purpose,a.side,a.source_page_index,a.layer_key,a.layer_order,a.supersedes_artwork_assignment_id,a.created_at AS assignment_created_at,f.* FROM v2_artwork_assignments a JOIN v2_artwork_files f ON f.id=a.artwork_file_id AND f.organization_id=a.organization_id WHERE a.organization_id=$1 AND a.order_line_id=$2 AND NOT EXISTS (SELECT 1 FROM v2_artwork_assignments successor WHERE successor.organization_id=a.organization_id AND successor.supersedes_artwork_assignment_id=a.id) ORDER BY a.created_at,a.id", [organizationId,orderLineId]);
    return r.rows.map((row) => ({ file: file(row), assignment: assignment({ id: row.assignment_id, organization_id: row.assignment_organization_id, artwork_file_id: row.artwork_file_id, order_document_id: row.order_document_id, order_line_id: row.order_line_id, purpose: row.purpose, side: row.side, source_page_index: row.source_page_index, layer_key: row.layer_key, layer_order: row.layer_order, supersedes_artwork_assignment_id: row.supersedes_artwork_assignment_id, created_at: row.assignment_created_at }) }));
  }
  async findOrderArtwork(organizationId: OrganizationId, orderId: string): Promise<readonly OrderLineArtworkProjection[]> {
    const r = await this.client.query<ProjectionRow>("SELECT a.id AS assignment_id,a.organization_id AS assignment_organization_id,a.artwork_file_id,a.order_document_id,a.order_line_id,a.purpose,a.side,a.source_page_index,a.layer_key,a.layer_order,a.supersedes_artwork_assignment_id,a.created_at AS assignment_created_at,f.* FROM v2_artwork_assignments a JOIN v2_artwork_files f ON f.id=a.artwork_file_id AND f.organization_id=a.organization_id WHERE a.organization_id=$1 AND a.order_document_id=$2 AND NOT EXISTS (SELECT 1 FROM v2_artwork_assignments successor WHERE successor.organization_id=a.organization_id AND successor.supersedes_artwork_assignment_id=a.id) ORDER BY a.order_line_id,a.created_at,a.id", [organizationId,orderId]);
    return r.rows.map((row) => ({ file: file(row), assignment: assignment({ id: row.assignment_id, organization_id: row.assignment_organization_id, artwork_file_id: row.artwork_file_id, order_document_id: row.order_document_id, order_line_id: row.order_line_id, purpose: row.purpose, side: row.side, source_page_index: row.source_page_index, layer_key: row.layer_key, layer_order: row.layer_order, supersedes_artwork_assignment_id: row.supersedes_artwork_assignment_id, created_at: row.assignment_created_at }) }));
  }
  async createOrGetFile(input: Parameters<ArtworkTransaction["createOrGetFile"]>[0]): Promise<ArtworkFile> {
    const f = input.file;
    const r = await this.client.query<FileRow>(`INSERT INTO v2_artwork_files(id,organization_id,storage_provider,object_key,object_version,original_filename,display_filename,content_type,byte_size,checksum_algorithm,checksum_value,source_kind,page_count,detected_width_microns,detected_height_microns,derived_from_artwork_file_id)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
      ON CONFLICT(organization_id,storage_provider,object_key,object_version) DO NOTHING RETURNING *`, [input.id,input.organizationId,f.objectReference.storageProvider,f.objectReference.objectKey,f.objectReference.objectVersion ?? "",f.originalFilename,f.displayFilename ?? f.originalFilename,f.contentType,f.byteSize,f.checksum?.algorithm ?? null,f.checksum?.value ?? null,f.source,f.pageCount ?? null,f.detectedWidthMicrons ?? null,f.detectedHeightMicrons ?? null,input.derivedFromArtworkFileId ?? null]);
    if (r.rows[0]) { await this.hooks?.afterFile?.(); return file(r.rows[0]); }
    const existing = await this.client.query<FileRow>("SELECT * FROM v2_artwork_files WHERE organization_id=$1 AND storage_provider=$2 AND object_key=$3 AND object_version=$4 FOR UPDATE", [input.organizationId,f.objectReference.storageProvider,f.objectReference.objectKey,f.objectReference.objectVersion ?? ""]);
    if (!existing.rows[0]) throw new Error("Artwork file identity race could not reload its authoritative row.");
    return file(existing.rows[0]);
  }
  async createOrGetAssignment(input: Parameters<ArtworkTransaction["createOrGetAssignment"]>[0]): Promise<ArtworkAssignment> {
    const u = input.usage; const semantic = JSON.stringify({ artworkFileId: input.artworkFileId, purpose: u.purpose, side: u.side ?? null, sourcePageIndex: u.sourcePageIndex ?? null, layerKey: u.layerKey ?? null, layerOrder: u.layerOrder ?? null });
    const fingerprint = `sha256:${createHash("sha256").update(semantic).digest("hex")}`;
    const r = await this.client.query<AssignmentRow>(`INSERT INTO v2_artwork_assignments(id,organization_id,artwork_file_id,order_document_id,order_line_id,purpose,side,source_page_index,layer_key,layer_order,identity_fingerprint)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT(organization_id,order_line_id,identity_fingerprint) DO NOTHING RETURNING *`, [input.id,input.organizationId,input.artworkFileId,u.orderId,u.orderLineId,u.purpose,u.side ?? null,u.sourcePageIndex ?? null,u.layerKey ?? null,u.layerOrder ?? null,fingerprint]);
    if (r.rows[0]) { await this.hooks?.afterAssignment?.(); return assignment(r.rows[0]); }
    const existing = await this.client.query<AssignmentRow>("SELECT * FROM v2_artwork_assignments WHERE organization_id=$1 AND order_line_id=$2 AND identity_fingerprint=$3 FOR UPDATE", [input.organizationId,u.orderLineId,fingerprint]);
    if (!existing.rows[0]) throw new Error("Artwork assignment race could not reload its authoritative row.");
    return assignment(existing.rows[0]);
  }
  async createOrGetReplacementAssignment(input: Parameters<ArtworkTransaction["createOrGetReplacementAssignment"]>[0]): Promise<ArtworkAssignment> {
    const u = input.usage; const semantic = JSON.stringify({ artworkFileId: input.artworkFileId, purpose: u.purpose, side: u.side ?? null, sourcePageIndex: u.sourcePageIndex ?? null, layerKey: u.layerKey ?? null, layerOrder: u.layerOrder ?? null });
    const fingerprint = `sha256:${createHash("sha256").update(semantic).digest("hex")}`;
    try {
      const r = await this.client.query<AssignmentRow>(`INSERT INTO v2_artwork_assignments(id,organization_id,artwork_file_id,order_document_id,order_line_id,purpose,side,source_page_index,layer_key,layer_order,identity_fingerprint,supersedes_artwork_assignment_id)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT(organization_id,order_line_id,identity_fingerprint) DO NOTHING RETURNING *`, [input.id,input.organizationId,input.artworkFileId,u.orderId,u.orderLineId,u.purpose,u.side ?? null,u.sourcePageIndex ?? null,u.layerKey ?? null,u.layerOrder ?? null,fingerprint,input.supersedesArtworkAssignmentId]);
      if (r.rows[0]) return assignment(r.rows[0]);
      const existing = await this.client.query<AssignmentRow>("SELECT * FROM v2_artwork_assignments WHERE organization_id=$1 AND order_line_id=$2 AND identity_fingerprint=$3 FOR UPDATE", [input.organizationId,u.orderLineId,fingerprint]);
      if (!existing.rows[0]) throw new Error("Artwork replacement race could not reload its authoritative row.");
      if (existing.rows[0].supersedes_artwork_assignment_id !== input.supersedesArtworkAssignmentId) {
        throw new V2ApplicationError("CONFLICT", "That artwork file already belongs to a different replacement lineage; reload before replacing it.");
      }
      return assignment(existing.rows[0]);
    } catch (error: unknown) {
      const code = typeof error === "object" && error !== null && "code" in error ? (error as { code?: unknown }).code : undefined;
      if (code === "23505" || code === "23514") throw new V2ApplicationError("CONFLICT", "Artwork has changed or has downstream workflow evidence; reload before replacing it.");
      throw error;
    }
  }
}

export class PostgresArtworkTransactionRunner implements ArtworkTransactionRunner {
  constructor(private readonly pool: Pool, private readonly hooks?: ConstructorParameters<typeof PostgresArtworkTransaction>[1]) {}
  async transaction<T>(action: (transaction: ArtworkTransaction) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try { await client.query("BEGIN"); const result = await action(new PostgresArtworkTransaction(client, this.hooks)); await client.query("COMMIT"); return result; }
    catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }
}
