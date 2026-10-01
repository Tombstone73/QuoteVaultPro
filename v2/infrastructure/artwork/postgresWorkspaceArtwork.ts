import { createHash, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type { OperationContext } from "../../src/application/operation.js";
import { AuthorityPolicy } from "../../src/authorization/authorityPolicy.js";
import { V2ApplicationError } from "../../src/errors/applicationError.js";
import { ArtworkApplicationService } from "../../src/modules/artwork/artworkApplication.js";
import { QuoteArtworkApplicationService } from "../../src/modules/artwork/quoteArtworkApplication.js";
import type {
  WorkspaceArtworkClaim, WorkspaceArtworkCleanupSummary, WorkspaceArtworkLifecycle, WorkspaceArtworkMaintenance,
  WorkspaceArtworkMutation, WorkspaceArtworkPromotionInput, WorkspaceArtworkPromotionResult,
  WorkspaceArtworkResult, WorkspaceArtworkState, WorkspaceArtworkStorageLiveness,
} from "../../src/modules/artwork/workspaceArtwork.js";
import {
  assertSalesWorkspaceMutable, authorizeSalesWorkspace, salesWorkspaceFingerprint,
  validateSalesWorkspaceId, validateSalesWorkspaceMutation,
} from "../../src/modules/sales/workspaceApplication.js";
import type { SalesWorkspace } from "../../src/modules/sales/workspaceContracts.js";
import { brandedId } from "../../src/modules/shared/commercialValues.js";
import { PostgresOperationRequestRepository } from "../persistence/postgresOperationRequests.js";
import { advanceSalesWorkspaceArtworkRevision, lockSalesWorkspaceForArtwork, readSalesWorkspaceForArtwork, readSalesWorkspacePromotionLineMap } from "../sales/workspaceArtworkAccess.js";
import type { ArtworkBinaryStorage, StoredArtworkObject } from "./artworkBinaryStorage.js";
import { validateArtworkPdf } from "./artworkPdfValidation.js";
import { PostgresArtworkTransaction } from "./postgresArtworkTransaction.js";
import { PostgresQuoteArtworkTransaction } from "./postgresQuoteArtworkTransaction.js";

type ClaimRow = {
  id: string; organization_id: string; workspace_id: string; workspace_line_id: string | null;
  upload_intent_id: string; request_id: string; request_fingerprint: string; request_revision: number; accepted_revision: number;
  filename: string; content_type: "application/pdf"; byte_size: number; checksum_sha256: string;
  storage_provider: string; object_key: string; state: WorkspaceArtworkState; artwork_file_id: string | null;
  assignment_id: string | null; canonical_document_kind: string | null; canonical_document_id: string | null; canonical_line_id: string | null;
  upload_generation: number; settled_upload_generation: number; cleanup_recheck_required: boolean;
};
export type ValidatedWorkspaceArtworkUpload = WorkspaceArtworkMutation & Readonly<{
  workspaceLineId?: string; filename: string; contentType: "application/pdf"; byteSize: number; checksumSha256: string;
}>;
const projection = (row: ClaimRow): WorkspaceArtworkClaim => ({
  id: row.id, workspaceId: row.workspace_id, workspaceLineId: row.workspace_line_id, filename: row.filename,
  contentType: row.content_type, byteSize: Number(row.byte_size), checksumSha256: row.checksum_sha256,
  state: row.state, artworkFileId: row.artwork_file_id, assignmentId: row.assignment_id,
});
const conflict = (message: string): never => { throw new V2ApplicationError("CONFLICT", message); };

function requireArtwork(context: OperationContext, capability: "artwork.view" | "artwork.adopt" | "artwork.assign" | "quote.edit"): void {
  authorizeSalesWorkspace(context);
  if (!new AuthorityPolicy().decide(context.principal, { capability, resource: { organizationId: context.organizationId } }).allowed) {
    throw new V2ApplicationError("FORBIDDEN", "The principal does not have authority for workspace Artwork.");
  }
}
async function workspace(client: PoolClient, context: OperationContext, id: string, lock = true): Promise<SalesWorkspace> {
  return readSalesWorkspaceForArtwork(client, context, id, lock);
}
async function transaction<T>(client: PoolClient, action: () => Promise<T>): Promise<T> {
  await client.query("BEGIN");
  try { const result = await action(); await client.query("COMMIT"); return result; }
  catch (cause) { await client.query("ROLLBACK"); throw cause; }
}
function mutation(context: OperationContext, input: WorkspaceArtworkMutation): void {
  validateSalesWorkspaceId(input.workspaceId);
  validateSalesWorkspaceMutation({ requestId: input.requestId, expectedRevision: input.expectedRevision });
  if (context.businessRequest?.id !== input.requestId) throw new V2ApplicationError("VALIDATION_ERROR", "A matching business request identity is required.");
}

/** Caller holds the Sales workspace lock. This is only a durable release, never storage I/O. */
export async function requestWorkspaceArtworkCleanupInTransaction(client: PoolClient, input: Readonly<{
  organizationId: string; workspaceId: string; workspaceLineId?: string;
}>): Promise<void> {
  const rows = await client.query<{ upload_intent_id: string }>(`UPDATE v2_artwork_workspace_claims
    SET state='cleanup_pending',workspace_line_id=NULL,updated_at=now()
    WHERE organization_id=$1 AND workspace_id=$2 AND state IN ('pending','uploaded')
      AND ($3::text IS NULL OR workspace_line_id=$3) RETURNING upload_intent_id`,
  [input.organizationId, input.workspaceId, input.workspaceLineId ?? null]);
  for (const row of rows.rows) await client.query(`UPDATE v2_artwork_storage_upload_intents SET state='cleanup_pending',updated_at=now()
    WHERE organization_id=$1 AND id=$2 AND state<>'adopted'`, [input.organizationId, row.upload_intent_id]);
}

/** The session lock serializes healthy clients, not disconnected uploads.
 * Durable generation/settlement evidence keeps cleanup pending while a late
 * write is possible; completion recovery uses a fresh connection. */
export class PostgresWorkspaceArtwork implements WorkspaceArtworkLifecycle, WorkspaceArtworkMaintenance, WorkspaceArtworkStorageLiveness {
  constructor(private readonly pool: Pick<Pool, "connect">, private readonly storage: ArtworkBinaryStorage) {}

  private async session<T>(organizationId: string, workspaceId: string, action: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    const key = `workspace-artwork:${organizationId}:${workspaceId}`;
    let locked = false;
    try {
      const result = await client.query<{ locked: boolean }>("SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS locked", [key]);
      if (!result.rows[0]?.locked) throw new V2ApplicationError("RETRYABLE_FAILURE", "Workspace Artwork storage is busy. Retry shortly.");
      locked = true;
      return await action(client);
    } finally {
      try { if (locked) await client.query("SELECT pg_advisory_unlock(hashtextextended($1,0))", [key]); }
      catch (cause) {
        // Never return a possibly still-locked session to the pool.
        client.release(cause instanceof Error ? cause : new Error("Artwork session unlock failed."));
        throw cause;
      }
      client.release();
    }
  }

  async list(context: OperationContext, workspaceId: string): Promise<readonly WorkspaceArtworkClaim[]> {
    requireArtwork(context, "artwork.view");
    const client = await this.pool.connect();
    try {
      await workspace(client, context, workspaceId, false);
      const rows = await client.query<ClaimRow>("SELECT * FROM v2_artwork_workspace_claims WHERE organization_id=$1 AND workspace_id=$2 ORDER BY created_at,id", [context.organizationId, workspaceId]);
      return rows.rows.map(projection);
    } finally { client.release(); }
  }

  async download(context: OperationContext, workspaceId: string, claimId: string): Promise<Readonly<{ filename: string; contentType: "application/pdf"; bytes: Uint8Array }>> {
    requireArtwork(context, "artwork.view");
    validateSalesWorkspaceId(workspaceId); validateSalesWorkspaceId(claimId);
    return this.session(context.organizationId, workspaceId, async (client) => {
      const row = await transaction(client, async () => {
        const ws = await workspace(client, context, workspaceId);
        assertSalesWorkspaceMutable(ws, ws.revision);
        const found = (await client.query<ClaimRow>("SELECT * FROM v2_artwork_workspace_claims WHERE organization_id=$1 AND workspace_id=$2 AND id=$3 AND state='uploaded'", [context.organizationId, workspaceId, claimId])).rows[0];
        if (!found) throw new V2ApplicationError("NOT_FOUND", "Staged Artwork was not found.");
        return found;
      });
      const bytes = await this.storage.read(row.object_key);
      // A discard can happen during I/O; do not disclose now-released evidence.
      await transaction(client, async () => {
        const ws = await workspace(client, context, workspaceId);
        assertSalesWorkspaceMutable(ws, ws.revision);
        if (!(await client.query("SELECT 1 FROM v2_artwork_workspace_claims WHERE organization_id=$1 AND id=$2 AND state='uploaded'", [context.organizationId, claimId])).rows.length) conflict("Staged Artwork was released.");
      });
      return { filename: row.filename, contentType: row.content_type, bytes };
    });
  }

  async storeUpload(context: OperationContext, input: ValidatedWorkspaceArtworkUpload, put: (objectKey: string) => Promise<StoredArtworkObject>): Promise<WorkspaceArtworkResult> {
    requireArtwork(context, "artwork.adopt");
    if (input.workspaceLineId) { requireArtwork(context, "artwork.assign"); validateSalesWorkspaceId(input.workspaceLineId); }
    mutation(context, input);
    const fingerprint = salesWorkspaceFingerprint({ workspaceLineId: input.workspaceLineId ?? null, filename: input.filename,
      contentType: input.contentType, byteSize: input.byteSize, checksumSha256: input.checksumSha256 });
    return this.session(context.organizationId, input.workspaceId, async (client) => {
      const reserved = await transaction(client, async () => {
        const ws = await workspace(client, context, input.workspaceId);
        const existing = (await client.query<ClaimRow>("SELECT * FROM v2_artwork_workspace_claims WHERE organization_id=$1 AND workspace_id=$2 AND request_id=$3 FOR UPDATE", [context.organizationId, ws.id, input.requestId])).rows[0];
        if (existing) {
          if (existing.workspace_line_id) requireArtwork(context, "artwork.assign");
          if (existing.request_fingerprint !== fingerprint) conflict("Artwork upload request input changed.");
          assertSalesWorkspaceMutable(ws, input.expectedRevision === existing.request_revision && ws.revision === existing.accepted_revision ? existing.accepted_revision : input.expectedRevision);
          if (!['pending','uploaded'].includes(existing.state)) conflict("The staged Artwork claim is no longer available.");
          if (existing.state === 'uploaded') return { row: existing, revision: ws.revision };
          if (existing.upload_generation !== existing.settled_upload_generation) throw new V2ApplicationError("RETRYABLE_FAILURE", "The prior Artwork upload has not settled yet.");
          const row = (await client.query<ClaimRow>(`UPDATE v2_artwork_workspace_claims SET upload_generation=upload_generation+1,updated_at=now()
            WHERE organization_id=$1 AND id=$2 RETURNING *`, [context.organizationId, existing.id])).rows[0]!;
          return { row, revision: ws.revision };
        }
        assertSalesWorkspaceMutable(ws, input.expectedRevision);
        if (input.workspaceLineId && !ws.lines.some((line) => line.id === input.workspaceLineId)) throw new V2ApplicationError("NOT_FOUND", "Workspace line was not found.");
        if (input.workspaceLineId && (await client.query("SELECT 1 FROM v2_artwork_workspace_claims WHERE organization_id=$1 AND workspace_id=$2 AND workspace_line_id=$3 AND state IN ('pending','uploaded')", [context.organizationId, ws.id, input.workspaceLineId])).rows.length) conflict("Remove the current staged source Artwork before uploading another file for this line.");
        const id = randomUUID(); const intentId = randomUUID();
        const objectKey = `v2-artwork/${context.organizationId}/workspaces/${ws.id}/${id}.pdf`;
        await client.query(`INSERT INTO v2_artwork_storage_upload_intents(id,organization_id,storage_provider,object_key,request_identity,expected_checksum_sha256,expected_content_type,expected_byte_size,object_created_by_intent)
          VALUES($1,$2,'supabase',$3,$4,$5,$6,$7,true)`, [intentId, context.organizationId, objectKey, `workspace-artwork:${id}`, input.checksumSha256, input.contentType, input.byteSize]);
        const row = (await client.query<ClaimRow>(`INSERT INTO v2_artwork_workspace_claims(id,organization_id,workspace_id,workspace_line_id,upload_intent_id,request_id,request_fingerprint,request_revision,accepted_revision,filename,content_type,byte_size,checksum_sha256,storage_provider,object_key,state,created_by_user_id)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'supabase',$14,'pending',$15) RETURNING *`,
        [id, context.organizationId, ws.id, input.workspaceLineId ?? null, intentId, input.requestId, fingerprint, ws.revision, ws.revision + 1, input.filename, input.contentType, input.byteSize, input.checksumSha256, objectKey, ws.creatorUserId])).rows[0]!;
        const revised = await advanceSalesWorkspaceArtworkRevision(client, context, ws.id, ws.revision);
        return { row, revision: revised.revision };
      });
      if (reserved.row.state === 'uploaded') return { claim: projection(reserved.row), workspaceRevision: reserved.revision };
      let stored: StoredArtworkObject | undefined;
      let putReturned = false;
      try {
        stored = await put(reserved.row.object_key);
        putReturned = true;
        if (stored.objectKey !== reserved.row.object_key || stored.storageProvider !== reserved.row.storage_provider) throw new Error("Unexpected storage identity.");
        if (!stored.created) {
          const storedBytes = await this.storage.read(reserved.row.object_key);
          if (storedBytes.length !== Number(reserved.row.byte_size) || createHash("sha256").update(storedBytes).digest("hex") !== reserved.row.checksum_sha256) {
            throw new Error("Stored Artwork does not match the validated upload.");
          }
          await validateArtworkPdf(storedBytes);
        }
      } catch {
        await this.recordUploadFailure(client, context.organizationId, reserved.row, !putReturned || stored?.created === false);
        throw new V2ApplicationError("RETRYABLE_FAILURE", "Artwork upload failed. Retry with the same request and file.", { workspaceRevision: reserved.revision, claimId: reserved.row.id });
      }
      let finalized: WorkspaceArtworkResult;
      try { finalized = await transaction(client, async () => {
        const ws = await workspace(client, context, input.workspaceId);
        const current = (await client.query<ClaimRow>("SELECT * FROM v2_artwork_workspace_claims WHERE organization_id=$1 AND id=$2 FOR UPDATE", [context.organizationId, reserved.row.id])).rows[0]!;
        if (current.upload_generation !== reserved.row.upload_generation) conflict("Artwork upload attempt changed.");
        if (current.workspace_line_id) requireArtwork(context, "artwork.assign");
        const active = ws.state === 'draft' && Date.parse(ws.expiresAt) > Date.now() && current.state === 'pending';
        const state = active ? 'uploaded' : 'cleanup_pending';
        const row = (await client.query<ClaimRow>("UPDATE v2_artwork_workspace_claims SET state=$3,settled_upload_generation=upload_generation,cleanup_recheck_required=cleanup_recheck_required OR $4,last_error_code=NULL,updated_at=now() WHERE organization_id=$1 AND id=$2 RETURNING *", [context.organizationId, current.id, state, stored?.created === false])).rows[0]!;
        await client.query("UPDATE v2_artwork_storage_upload_intents SET state=$3,stored_at=COALESCE(stored_at,now()),last_error_code=NULL,updated_at=now() WHERE organization_id=$1 AND id=$2 AND state<>'adopted'", [context.organizationId, row.upload_intent_id, active ? 'stored' : 'cleanup_pending']);
        return { claim: projection(row), workspaceRevision: ws.revision };
      }); } catch (cause) {
        // The original session may be gone. Never let a successful late put
        // disappear behind a terminal cleanup row or a rolled-back completion.
        await this.recoverUploadCompletion(context.organizationId, reserved.row, stored?.created === false);
        throw cause;
      }
      if (finalized.claim.state !== 'uploaded') conflict("Workspace Artwork was released while the upload was in progress.");
      return finalized;
    });
  }

  private async recordUploadFailure(client: PoolClient, organizationId: string, row: ClaimRow, uncertain: boolean): Promise<void> {
    try { await transaction(client, async () => {
      const changed = await client.query(`UPDATE v2_artwork_workspace_claims SET settled_upload_generation=upload_generation,
        cleanup_recheck_required=cleanup_recheck_required OR $4,last_error_code='upload_failed',updated_at=now()
        WHERE organization_id=$1 AND id=$2 AND upload_generation=$3 AND state IN ('pending','cleanup_pending') RETURNING id`,
      [organizationId, row.id, row.upload_generation, uncertain]);
      if (changed.rows.length) await client.query("UPDATE v2_artwork_storage_upload_intents SET last_error_code='upload_failed',updated_at=now() WHERE organization_id=$1 AND id=$2 AND state<>'adopted'", [organizationId, row.upload_intent_id]);
    }); } catch { await this.recoverUploadCompletion(organizationId, row, uncertain); }
  }

  private async recoverUploadCompletion(organizationId: string, row: ClaimRow, uncertain: boolean): Promise<void> {
    const recovery = await this.pool.connect();
    try { await transaction(recovery, async () => {
      const changed = await recovery.query(`UPDATE v2_artwork_workspace_claims SET state='cleanup_pending',workspace_line_id=NULL,
        settled_upload_generation=upload_generation,cleanup_recheck_required=cleanup_recheck_required OR $4,
        last_error_code='upload_completion_recovery',updated_at=now()
        WHERE organization_id=$1 AND id=$2 AND upload_generation=$3 AND state IN ('pending','cleanup_pending') RETURNING id`,
      [organizationId, row.id, row.upload_generation, uncertain]);
      if (changed.rows.length) await recovery.query("UPDATE v2_artwork_storage_upload_intents SET state='cleanup_pending',last_error_code='upload_completion_recovery',updated_at=now() WHERE organization_id=$1 AND id=$2 AND state<>'adopted'", [organizationId, row.upload_intent_id]);
    }); } finally { recovery.release(); }
  }

  async assign(context: OperationContext, input: WorkspaceArtworkMutation & Readonly<{ claimId: string; workspaceLineId: string }>): Promise<WorkspaceArtworkResult> {
    validateSalesWorkspaceId(input.workspaceLineId);
    return this.changeClaim(context, input, input.workspaceLineId);
  }
  async remove(context: OperationContext, input: WorkspaceArtworkMutation & Readonly<{ claimId: string }>): Promise<WorkspaceArtworkResult> {
    return this.changeClaim(context, input, null);
  }
  private async changeClaim(context: OperationContext, input: WorkspaceArtworkMutation & Readonly<{ claimId: string }>, lineId: string | null): Promise<WorkspaceArtworkResult> {
    requireArtwork(context, "artwork.assign"); mutation(context, input); validateSalesWorkspaceId(input.claimId);
    const client = await this.pool.connect();
    try { return await transaction(client, async () => {
      const ws = await workspace(client, context, input.workspaceId);
      const requests = new PostgresOperationRequestRepository();
      const operation = lineId ? 'artwork.workspace.assign.v1' : 'artwork.workspace.remove.v1';
      const reserved = await requests.reserve(client, { organizationId: context.organizationId, operation, businessRequestId: input.requestId,
        payloadFingerprint: salesWorkspaceFingerprint({ ...input, lineId }), principalKind: 'staff', principalSubject: ws.creatorUserId, staffActorUserId: ws.creatorUserId });
      if (reserved.kind === 'replay') {
        assertSalesWorkspaceMutable(ws, input.expectedRevision + 1);
        return reserved.request.resultJson as WorkspaceArtworkResult;
      }
      assertSalesWorkspaceMutable(ws, input.expectedRevision);
      const row = (await client.query<ClaimRow>("SELECT * FROM v2_artwork_workspace_claims WHERE organization_id=$1 AND workspace_id=$2 AND id=$3 FOR UPDATE", [context.organizationId, ws.id, input.claimId])).rows[0];
      if (!row) throw new V2ApplicationError("NOT_FOUND", "Staged Artwork was not found.");
      if (!['pending','uploaded'].includes(row.state)) conflict("Only live TEMP Artwork can be changed.");
      if (lineId && !ws.lines.some((line) => line.id === lineId)) throw new V2ApplicationError("NOT_FOUND", "Workspace line was not found.");
      if (lineId && (await client.query("SELECT 1 FROM v2_artwork_workspace_claims WHERE organization_id=$1 AND workspace_id=$2 AND workspace_line_id=$3 AND id<>$4 AND state IN ('pending','uploaded')", [context.organizationId, ws.id, lineId, row.id])).rows.length) conflict("The line already has staged source Artwork.");
      const changed = (await client.query<ClaimRow>("UPDATE v2_artwork_workspace_claims SET workspace_line_id=$3,state=$4,updated_at=now() WHERE organization_id=$1 AND id=$2 RETURNING *", [context.organizationId, row.id, lineId, lineId ? row.state : 'cleanup_pending'])).rows[0]!;
      if (!lineId) await client.query("UPDATE v2_artwork_storage_upload_intents SET state='cleanup_pending',updated_at=now() WHERE organization_id=$1 AND id=$2 AND state<>'adopted'", [context.organizationId, row.upload_intent_id]);
      const revised = await advanceSalesWorkspaceArtworkRevision(client, context, ws.id, ws.revision);
      const result = { claim: projection(changed), workspaceRevision: revised.revision };
      await requests.succeed(client, context.organizationId, reserved.request.id, { resourceType: 'workspace_artwork', resourceId: row.id, resultJson: result });
      return result;
    }); } finally { client.release(); }
  }

  async ownsStorageIntent(input: Parameters<WorkspaceArtworkStorageLiveness['ownsStorageIntent']>[0]): Promise<boolean> {
    const client = await this.pool.connect();
    try { return Boolean((await client.query(`SELECT 1 FROM v2_artwork_workspace_claims c
      JOIN v2_artwork_storage_upload_intents i ON i.id=c.upload_intent_id AND i.organization_id=c.organization_id
      WHERE c.organization_id=$1 AND c.upload_intent_id=$2 AND c.storage_provider=$3 AND c.object_key=$4
        AND i.storage_provider=c.storage_provider AND i.object_key=c.object_key`, [input.organizationId, input.intentId, input.storageProvider, input.objectKey])).rows.length); }
    finally { client.release(); }
  }

  async cleanup(input: Readonly<{ organizationId: string; limit: number }>): Promise<WorkspaceArtworkCleanupSummary> {
    validateSalesWorkspaceId(input?.organizationId);
    if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 100) throw new V2ApplicationError("VALIDATION_ERROR", "Cleanup limit must be between 1 and 100.");
    const scan = await this.pool.connect();
    const candidates = await (async () => { try { return (await scan.query<{ id: string; workspace_id: string }>(`SELECT c.id,c.workspace_id FROM v2_artwork_workspace_claims c
      JOIN v2_sales_workspaces w ON w.id=c.workspace_id AND w.organization_id=c.organization_id
      WHERE c.organization_id=$1 AND (c.state='cleanup_pending' OR (c.state IN ('pending','uploaded') AND (w.state IN ('discarded','expired') OR w.expires_at<=now())))
      ORDER BY c.updated_at,c.id LIMIT $2`, [input.organizationId, input.limit])).rows; } finally { scan.release(); } })();
    const summary = { inspected: candidates.length, deleted: 0, retained: 0, failed: 0, busy: 0, remaining: 0 };
    for (const candidate of candidates) {
      try { await this.session(input.organizationId, candidate.workspace_id, async (client) => {
        const released = await transaction(client, async () => {
          // Lock-only coordination with Sales, never a workspace state mutation.
          const ws = (await client.query<{ state: string; expired: boolean }>("SELECT state,expires_at<=now() AS expired FROM v2_sales_workspaces WHERE organization_id=$1 AND id=$2 FOR UPDATE", [input.organizationId, candidate.workspace_id])).rows[0];
          const row = (await client.query<ClaimRow>("SELECT * FROM v2_artwork_workspace_claims WHERE organization_id=$1 AND id=$2 FOR UPDATE", [input.organizationId, candidate.id])).rows[0];
          if (!ws || !row || ['promoted','retained','deleted'].includes(row.state)) return null;
          if (row.state !== 'cleanup_pending' && !ws.expired && !['discarded','expired'].includes(ws.state)) return null;
          await client.query("UPDATE v2_artwork_workspace_claims SET state='cleanup_pending',workspace_line_id=NULL,updated_at=now() WHERE organization_id=$1 AND id=$2", [input.organizationId, row.id]);
          const canonical = (await client.query<{ id: string }>("SELECT id FROM v2_artwork_files WHERE organization_id=$1 AND storage_provider=$2 AND object_key=$3 LIMIT 1", [input.organizationId, row.storage_provider, row.object_key])).rows[0];
          const other = (await client.query("SELECT 1 FROM v2_artwork_workspace_claims WHERE organization_id=$1 AND storage_provider=$2 AND object_key=$3 AND id<>$4 AND state IN ('pending','uploaded','promoted')", [input.organizationId, row.storage_provider, row.object_key, row.id])).rows.length;
          if (canonical || other) {
            await client.query("UPDATE v2_artwork_workspace_claims SET state='retained',artwork_file_id=$3,updated_at=now() WHERE organization_id=$1 AND id=$2", [input.organizationId, row.id, canonical?.id ?? null]);
            if (canonical) await client.query("UPDATE v2_artwork_storage_upload_intents SET state='adopted',adopted_artwork_file_id=$3,adopted_at=COALESCE(adopted_at,now()),updated_at=now() WHERE organization_id=$1 AND id=$2", [input.organizationId, row.upload_intent_id, canonical.id]);
            summary.retained += 1; return null;
          }
          await client.query("UPDATE v2_artwork_storage_upload_intents SET state='cleanup_pending',updated_at=now() WHERE organization_id=$1 AND id=$2 AND state<>'adopted'", [input.organizationId, row.upload_intent_id]);
          return row;
        });
        if (!released) return;
        const settledBeforeRemoval = released.settled_upload_generation === released.upload_generation && !released.cleanup_recheck_required;
        try {
          // Idempotent provider removal is safer than exists(), which may hide an outage.
          // Settlement recorded during this I/O only qualifies the next removal,
          // not this one: the remote delete may already have preceded a late put.
          await this.storage.remove(released.object_key);
          await transaction(client, async () => {
            const row = (await client.query<ClaimRow>(`UPDATE v2_artwork_workspace_claims
              SET state=CASE WHEN $3::boolean AND upload_generation=$4 AND settled_upload_generation=$4 AND NOT cleanup_recheck_required THEN 'deleted' ELSE 'cleanup_pending' END,
                last_error_code=CASE WHEN $3::boolean AND upload_generation=$4 AND settled_upload_generation=$4 AND NOT cleanup_recheck_required THEN NULL ELSE 'upload_settlement_unknown' END,updated_at=now()
              WHERE organization_id=$1 AND id=$2 AND state='cleanup_pending' RETURNING *`, [input.organizationId, released.id, settledBeforeRemoval, released.upload_generation])).rows[0];
            if (!row) conflict("Artwork cleanup claim changed.");
            await client.query(`UPDATE v2_artwork_storage_upload_intents SET state=$3::text,
              cleaned_at=CASE WHEN $3::text='cleaned' THEN COALESCE(cleaned_at,now()) ELSE NULL END,last_error_code=$4,
              reconciliation_lease_token=NULL,reconciliation_lease_expires_at=NULL,updated_at=now() WHERE organization_id=$1 AND id=$2 AND state<>'adopted'`,
            [input.organizationId, released.upload_intent_id, row!.state === 'deleted' ? 'cleaned' : 'cleanup_pending', row!.state === 'deleted' ? null : 'upload_settlement_unknown']);
          });
          summary.deleted += 1;
        } catch {
          await transaction(client, async () => {
            await client.query("UPDATE v2_artwork_workspace_claims SET cleanup_attempts=cleanup_attempts+1,last_error_code='delete_failed',updated_at=now() WHERE organization_id=$1 AND id=$2 AND state='cleanup_pending'", [input.organizationId, released.id]);
            await client.query("UPDATE v2_artwork_storage_upload_intents SET cleanup_attempts=cleanup_attempts+1,last_error_code='delete_failed',updated_at=now() WHERE organization_id=$1 AND id=$2 AND state<>'adopted'", [input.organizationId, released.upload_intent_id]);
          });
          summary.failed += 1;
        }
      }); } catch (cause) {
        if (cause instanceof V2ApplicationError && cause.code === 'RETRYABLE_FAILURE') summary.busy += 1;
        else throw cause;
      }
    }
    const count = await this.pool.connect();
    try { summary.remaining = Number((await count.query<{ count: string }>(`SELECT count(*)::text AS count FROM v2_artwork_workspace_claims c JOIN v2_sales_workspaces w ON w.id=c.workspace_id AND w.organization_id=c.organization_id
      WHERE c.organization_id=$1 AND (c.state='cleanup_pending' OR (c.state IN ('pending','uploaded') AND (w.state IN ('discarded','expired') OR w.expires_at<=now())))`, [input.organizationId])).rows[0]!.count); }
    finally { count.release(); }
    return summary;
  }
}

/** Caller already controls BEGIN/COMMIT. All owner failure envelopes become
 * thrown errors so no partial file/assignment/ledger promotion can commit. */
export async function promoteWorkspaceArtworkInTransaction(client: PoolClient, input: WorkspaceArtworkPromotionInput): Promise<WorkspaceArtworkPromotionResult> {
  if (input.organizationId !== input.actor.organizationId) throw new V2ApplicationError("WRONG_TENANT", "Artwork promotion organization does not match the actor.");
  validateSalesWorkspaceId(input.documentId);
  const ws = await lockSalesWorkspaceForArtwork(client, input.actor, input.workspaceId, undefined, true);
  if (!['promoting','promoted'].includes(ws.state) || (ws.state !== 'promoted' && Date.parse(ws.expiresAt) <= Date.now())) conflict("Artwork promotion requires a current Sales promotion.");
  const maps = await readSalesWorkspacePromotionLineMap(client, input.actor, input.workspaceId);
  const canonical = (await client.query<{ id: string }>(`SELECT l.id FROM v2_sales_document_lines l
    JOIN v2_sales_documents d ON d.id=l.document_id AND d.organization_id=l.organization_id
    WHERE d.organization_id=$1 AND d.id=$2 AND d.document_kind=$3`, [input.organizationId, input.documentId, input.documentKind])).rows;
  if (!maps.length || canonical.length !== maps.length || maps.length !== ws.lines.length || input.lineMap.length !== ws.lines.length || new Set(input.lineMap.map((line) => line.workspaceLineId)).size !== ws.lines.length
    || maps.some((row) => !canonical.some((line) => line.id === row.canonicalLineId) || !ws.lines.some((line) => line.id === row.workspaceLineId && line.position === row.position)
      || !input.lineMap.some((line) => line.workspaceLineId === row.workspaceLineId && line.canonicalLineId === row.canonicalLineId && line.position === row.position))) conflict("Artwork promotion line mapping does not match persisted Sales identity.");
  const claims = (await client.query<ClaimRow>("SELECT * FROM v2_artwork_workspace_claims WHERE organization_id=$1 AND workspace_id=$2 AND state IN ('pending','uploaded','promoted') ORDER BY created_at,id FOR UPDATE", [input.organizationId, ws.id])).rows;
  if (!claims.length) return { promotedCount: 0, claims: [] };
  requireArtwork(input.actor, 'artwork.adopt'); requireArtwork(input.actor, 'artwork.assign');
  // Preserve the canonical Quote owner gate on both first use and replay.
  if (input.documentKind === 'quote') requireArtwork(input.actor, 'quote.edit');
  const results: WorkspaceArtworkClaim[] = [];
  for (const claim of claims) {
    const mapping = maps.find((row) => row.workspaceLineId === claim.workspace_line_id);
    if (!mapping || claim.state === 'pending') throw new V2ApplicationError("CONFLICT", "Every staged Artwork file must finish uploading and be assigned to a workspace line before promotion.");
    if (claim.state === 'promoted') {
      if (claim.canonical_document_kind !== input.documentKind || claim.canonical_document_id !== input.documentId || claim.canonical_line_id !== mapping.canonicalLineId) conflict("Artwork was promoted to a different canonical identity.");
      results.push(projection(claim)); continue;
    }
    const businessRequestId = `workspace-artwork-promote:${claim.id}`;
    const context: OperationContext = { ...input.actor, businessRequest: { id: businessRequestId, payloadFingerprint: claim.request_fingerprint } };
    const file = { businessRequestId, objectReference: { storageProvider: claim.storage_provider, objectKey: claim.object_key }, originalFilename: claim.filename,
      displayFilename: claim.filename, contentType: claim.content_type, byteSize: Number(claim.byte_size), checksum: { algorithm: 'sha256' as const, value: claim.checksum_sha256 }, source: 'customer_upload' as const };
    const result = input.documentKind === 'quote'
      ? await new QuoteArtworkApplicationService({ transaction: (action) => action(new PostgresQuoteArtworkTransaction(client)) }).adopt(context, {
        ...file, expectedRevision: (await client.query<{ revision: string }>("SELECT revision::text FROM v2_sales_documents WHERE organization_id=$1 AND id=$2 AND document_kind='quote'", [input.organizationId, input.documentId])).rows[0]?.revision ?? '',
        usage: { quoteId: brandedId<'QuoteId'>(input.documentId), quoteLineId: brandedId<'SalesLineId'>(mapping.canonicalLineId), purpose: 'customer_supplied' },
      })
      : await new ArtworkApplicationService({ transaction: (action) => action(new PostgresArtworkTransaction(client)) }).adopt(context, {
        ...file, usage: { orderId: brandedId<'OrderId'>(input.documentId), orderLineId: brandedId<'OrderLineId'>(mapping.canonicalLineId), purpose: 'customer_supplied' },
      });
    if (!result.ok) throw result.error;
    const promoted = (await client.query<ClaimRow>(`UPDATE v2_artwork_workspace_claims SET state='promoted',artwork_file_id=$3,assignment_id=$4,canonical_document_kind=$5,canonical_document_id=$6,canonical_line_id=$7,updated_at=now()
      WHERE organization_id=$1 AND id=$2 AND state='uploaded' RETURNING *`, [input.organizationId, claim.id, result.value.artworkFile.id, result.value.assignment.id, input.documentKind, input.documentId, mapping.canonicalLineId])).rows[0];
    if (!promoted) conflict("Artwork promotion changed concurrently.");
    await client.query("UPDATE v2_artwork_storage_upload_intents SET state='adopted',adopted_artwork_file_id=$3,adopted_at=COALESCE(adopted_at,now()),reconciliation_lease_token=NULL,reconciliation_lease_expires_at=NULL,last_error_code=NULL,updated_at=now() WHERE organization_id=$1 AND id=$2", [input.organizationId, claim.upload_intent_id, result.value.artworkFile.id]);
    results.push(projection(promoted));
  }
  return { promotedCount: results.length, claims: results };
}
