import type { Pool, PoolClient } from "pg";
import { requireOperationPrincipalScope, type OperationContext } from "../../src/application/operation.js";
import { AuthorityPolicy } from "../../src/authorization/authorityPolicy.js";
import { V2ApplicationError } from "../../src/errors/applicationError.js";
import { ArtworkApplicationService } from "../../src/modules/artwork/artworkApplication.js";
import type {
  ApplyOrderEditArtworkInput, CaptureOrderEditArtworkInput, OrderEditArtwork, OrderEditArtworkAction,
  OrderEditArtworkApplyResult, OrderEditArtworkIntentResult, OrderEditArtworkReference,
  OrderEditArtworkSourceInput, OrderEditArtworkSourceLine, OrderEditArtworkValidation,
} from "../../src/modules/artwork/orderEditArtwork.js";
import { authorizeSalesWorkspace, salesWorkspaceFingerprint, validateSalesWorkspaceId, validateSalesWorkspaceMutation } from "../../src/modules/sales/workspaceApplication.js";
import type { SalesWorkspace } from "../../src/modules/sales/workspaceContracts.js";
import { brandedId } from "../../src/modules/shared/commercialValues.js";
import { PostgresOperationRequestRepository } from "../persistence/postgresOperationRequests.js";
import { advanceSalesWorkspaceArtworkRevision, lockSalesWorkspaceForArtwork, readSalesWorkspaceForArtwork } from "../sales/workspaceArtworkAccess.js";
import { lockOrderArtworkCoordination, PostgresArtworkTransaction } from "./postgresArtworkTransaction.js";
import { promoteWorkspaceArtworkInTransaction } from "./postgresWorkspaceArtwork.js";

type Evidence = Readonly<{
  assignment: Readonly<{ purpose: OrderEditArtworkReference["purpose"] }>;
  file: Readonly<{ display_filename: string; content_type: string; byte_size: string }>;
}>;
type SourceRow = {
  source_assignment_id: string; source_canonical_line_id: string; source_artwork_file_id: string;
  source_status: OrderEditArtworkReference["status"]; source_quote_accepted_artwork_snapshot_id: string | null;
  source_evidence_json: Evidence;
};
type ReferenceRow = SourceRow & { workspace_line_id: string; action: OrderEditArtworkAction };
type SessionRow = {
  order_document_id: string; source_line_map_json: readonly OrderEditArtworkSourceLine[]; baseline_fingerprint: string;
};
// An apply cannot skip the pre-Sales membership check or reuse one from a prior
// transaction on a pooled client. No client-authored token grants this state.
const validated = new WeakMap<PoolClient, Map<string, { transactionId: string; fingerprint: string }>>();
const key = (input: OrderEditArtworkSourceInput): string => JSON.stringify([input.context.organizationId, input.workspaceId, input.orderId]);
function conflict(message: string): never { throw new V2ApplicationError("CONFLICT", message); }

function requireArtwork(context: OperationContext, capability: "artwork.view" | "artwork.assign" | "artwork.adopt"): void {
  requireOperationPrincipalScope(context);
  if (context.principal.kind !== "staff" || !new AuthorityPolicy().decide(context.principal, { capability, resource: { organizationId: context.organizationId } }).allowed) {
    throw new V2ApplicationError("FORBIDDEN", "The principal does not have authority for Order edit Artwork.");
  }
}
function assertSource(workspace: SalesWorkspace, orderId?: string): void {
  if (workspace.kind !== "order_edit" || workspace.sourceDocumentKind !== "order" || !workspace.sourceDocumentId
    || (orderId !== undefined && workspace.sourceDocumentId !== orderId)) conflict("Artwork editing requires the exact source Order workspace.");
}
async function session(client: PoolClient, input: OrderEditArtworkSourceInput): Promise<SessionRow> {
  const row = (await client.query<SessionRow>("SELECT * FROM v2_artwork_workspace_edit_sessions WHERE organization_id=$1 AND workspace_id=$2", [input.context.organizationId, input.workspaceId])).rows[0];
  if (!row || row.order_document_id !== input.orderId) conflict("Order edit Artwork source was not captured.");
  return row;
}
async function sourceRows(client: PoolClient, organizationId: string, orderId: string): Promise<SourceRow[]> {
  const rows = await client.query<SourceRow>(`SELECT a.id AS source_assignment_id,a.order_line_id AS source_canonical_line_id,
    a.artwork_file_id AS source_artwork_file_id,a.source_quote_accepted_artwork_snapshot_id,
    CASE WHEN r.artwork_assignment_id IS NOT NULL THEN
      CASE WHEN EXISTS (SELECT 1 FROM v2_artwork_assignments s WHERE s.organization_id=a.organization_id AND s.supersedes_artwork_assignment_id=a.id)
        THEN 'removed_and_superseded' ELSE 'removed' END
      WHEN EXISTS (SELECT 1 FROM v2_artwork_assignments s WHERE s.organization_id=a.organization_id AND s.supersedes_artwork_assignment_id=a.id)
        THEN 'superseded' ELSE 'current' END AS source_status,
    jsonb_build_object('assignment',to_jsonb(a),'file',to_jsonb(f)||jsonb_build_object('byte_size',f.byte_size::text),'removal',to_jsonb(r),
      'supersededBy',COALESCE((SELECT jsonb_agg(s.id ORDER BY s.id) FROM v2_artwork_assignments s
        WHERE s.organization_id=a.organization_id AND s.supersedes_artwork_assignment_id=a.id),'[]'::jsonb)) AS source_evidence_json
    FROM v2_artwork_assignments a JOIN v2_artwork_files f ON f.organization_id=a.organization_id AND f.id=a.artwork_file_id
    LEFT JOIN v2_artwork_assignment_removals r ON r.organization_id=a.organization_id AND r.artwork_assignment_id=a.id
    WHERE a.organization_id=$1 AND a.order_document_id=$2 ORDER BY a.order_line_id,a.id`, [organizationId, orderId]);
  return rows.rows;
}
async function canonicalLineIds(client: PoolClient, organizationId: string, orderId: string): Promise<string[]> {
  return (await client.query<{ id: string }>("SELECT id FROM v2_sales_document_lines WHERE organization_id=$1 AND document_id=$2 ORDER BY id", [organizationId, orderId])).rows.map((row) => row.id);
}
function sourceFingerprint(input: Pick<OrderEditArtworkSourceInput, "context" | "orderId">, lineIds: readonly string[], rows: readonly SourceRow[]): string {
  return salesWorkspaceFingerprint({ organizationId: input.context.organizationId, orderId: input.orderId, lineIds: [...lineIds].sort(), rows });
}

/** Sales needs the opaque token before inserting its immutable source header.
 * Its start authorization is reused here; retain this client/transaction through
 * source capture so no new assignment can enter between the two owner calls. */
export async function captureOrderEditArtworkFingerprint(client: PoolClient, input: Readonly<{ context: OperationContext; orderId: string }>): Promise<string> {
  authorizeSalesWorkspace(input.context, { kind: "order_edit", organizationId: input.context.organizationId,
    creatorUserId: input.context.principal.kind === "staff" ? input.context.principal.userId : "" });
  validateSalesWorkspaceId(input.orderId);
  await lockOrderArtworkCoordination(client, input.context.organizationId, input.orderId);
  return sourceFingerprint(input, await canonicalLineIds(client, input.context.organizationId, input.orderId),
    await sourceRows(client, input.context.organizationId, input.orderId));
}
async function references(client: PoolClient, input: OrderEditArtworkSourceInput): Promise<ReferenceRow[]> {
  return (await client.query<ReferenceRow>(`SELECT r.*,COALESCE(i.action,'KEEP') AS action FROM v2_artwork_workspace_edit_refs r
    LEFT JOIN v2_artwork_workspace_edit_intents i ON i.organization_id=r.organization_id AND i.workspace_id=r.workspace_id AND i.source_assignment_id=r.source_assignment_id
    WHERE r.organization_id=$1 AND r.workspace_id=$2 ORDER BY r.source_canonical_line_id,r.source_assignment_id`, [input.context.organizationId, input.workspaceId])).rows;
}
async function assertFingerprint(client: PoolClient, input: OrderEditArtworkSourceInput, baseline: SessionRow, afterSales = false): Promise<void> {
  const lineIds = afterSales ? baseline.source_line_map_json.map((line) => line.canonicalLineId)
    : await canonicalLineIds(client, input.context.organizationId, input.orderId);
  if (sourceFingerprint(input, lineIds, await sourceRows(client, input.context.organizationId, input.orderId)) !== baseline.baseline_fingerprint) {
    conflict("Order Artwork changed after this edit workspace was opened. Reload before saving.");
  }
}

/** Trusted Sales start only, on its transaction client after creating every
 * source TEMP line. Captures even an entirely empty canonical Artwork set. */
export async function captureOrderEditArtwork(client: PoolClient, input: CaptureOrderEditArtworkInput): Promise<Readonly<{ fingerprint: string }>> {
  validateSalesWorkspaceId(input.orderId);
  const workspace = await lockSalesWorkspaceForArtwork(client, input.context, input.workspaceId);
  assertSource(workspace, input.orderId);
  const lineMap = input.lineMap.map((line) => ({ workspaceLineId: validateSalesWorkspaceId(line.workspaceLineId), canonicalLineId: validateSalesWorkspaceId(line.canonicalLineId) }))
    .sort((a, b) => a.canonicalLineId.localeCompare(b.canonicalLineId));
  if (lineMap.length !== workspace.lines.length || new Set(lineMap.map((line) => line.workspaceLineId)).size !== lineMap.length
    || new Set(lineMap.map((line) => line.canonicalLineId)).size !== lineMap.length
    || lineMap.some((line) => !workspace.lines.some((temp) => temp.id === line.workspaceLineId && temp.sourceLineId === line.canonicalLineId))) conflict("Artwork capture requires the complete Sales source-line mapping.");
  await lockOrderArtworkCoordination(client, input.context.organizationId, input.orderId);
  const existing = (await client.query<SessionRow>("SELECT * FROM v2_artwork_workspace_edit_sessions WHERE organization_id=$1 AND workspace_id=$2", [input.context.organizationId, input.workspaceId])).rows[0];
  if (existing) {
    if (existing.order_document_id !== input.orderId || salesWorkspaceFingerprint(existing.source_line_map_json) !== salesWorkspaceFingerprint(lineMap)) conflict("Artwork source capture identity cannot change.");
    return { fingerprint: existing.baseline_fingerprint };
  }
  const lineIds = await canonicalLineIds(client, input.context.organizationId, input.orderId);
  if (lineIds.length !== lineMap.length || lineIds.some((id) => !lineMap.some((line) => line.canonicalLineId === id))) conflict("Artwork capture requires every source Order line, including empty lines.");
  const rows = await sourceRows(client, input.context.organizationId, input.orderId);
  const fingerprint = sourceFingerprint(input, lineIds, rows);
  if (workspace.sourceArtifactFingerprint !== fingerprint) conflict("Artwork source token changed before immutable workspace capture.");
  await client.query(`INSERT INTO v2_artwork_workspace_edit_sessions(organization_id,workspace_id,order_document_id,source_line_map_json,baseline_fingerprint)
    VALUES($1,$2,$3,$4::jsonb,$5)`, [input.context.organizationId, input.workspaceId, input.orderId, JSON.stringify(lineMap), fingerprint]);
  for (const row of rows) {
    const mapping = lineMap.find((line) => line.canonicalLineId === row.source_canonical_line_id);
    if (!mapping) conflict("Artwork source is outside the captured Order lines.");
    await client.query(`INSERT INTO v2_artwork_workspace_edit_refs(organization_id,workspace_id,workspace_line_id,source_canonical_line_id,
      source_assignment_id,source_artwork_file_id,source_status,source_quote_accepted_artwork_snapshot_id,source_evidence_json,baseline_fingerprint)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10)`, [input.context.organizationId, input.workspaceId, mapping.workspaceLineId,
      row.source_canonical_line_id, row.source_assignment_id, row.source_artwork_file_id, row.source_status,
      row.source_quote_accepted_artwork_snapshot_id, JSON.stringify(row.source_evidence_json), fingerprint]);
  }
  return { fingerprint };
}

/** Receipt replay rechecks current owner capabilities without returning any
 * immutable reference metadata to a header-only editor. */
export async function authorizeOrderEditArtworkReplay(client: PoolClient, input: OrderEditArtworkSourceInput): Promise<void> {
  const workspace = await readSalesWorkspaceForArtwork(client, input.context, input.workspaceId);
  assertSource(workspace, input.orderId);
  await session(client, input);
  if ((await references(client, input)).some((ref) => ref.action === "REMOVE")) {
    requireArtwork(input.context, "artwork.view"); requireArtwork(input.context, "artwork.assign");
  }
  const staged = await client.query("SELECT 1 FROM v2_artwork_workspace_claims WHERE organization_id=$1 AND workspace_id=$2 AND state='promoted' LIMIT 1", [input.context.organizationId, input.workspaceId]);
  if (staged.rows.length) { requireArtwork(input.context, "artwork.adopt"); requireArtwork(input.context, "artwork.assign"); }
}

export class PostgresOrderEditArtwork implements OrderEditArtwork {
  constructor(private readonly pool: Pick<Pool, "connect">) {}

  async readOrderEditArtwork(context: OperationContext, workspaceId: string): Promise<readonly OrderEditArtworkReference[]> {
    requireArtwork(context, "artwork.view");
    const client = await this.pool.connect();
    try {
      const workspace = await readSalesWorkspaceForArtwork(client, context, workspaceId);
      assertSource(workspace);
      const input = { context, workspaceId, orderId: workspace.sourceDocumentId! };
      await session(client, input);
      return (await references(client, input)).map((row) => ({
        workspaceLineId: row.workspace_line_id, sourceCanonicalLineId: row.source_canonical_line_id,
        sourceAssignmentId: row.source_assignment_id, artworkFileId: row.source_artwork_file_id,
        status: row.source_status, action: row.action, filename: row.source_evidence_json.file.display_filename,
        contentType: row.source_evidence_json.file.content_type, byteSize: Number(row.source_evidence_json.file.byte_size),
        purpose: row.source_evidence_json.assignment.purpose, sourceQuoteAcceptedArtworkSnapshotId: row.source_quote_accepted_artwork_snapshot_id,
      }));
    } finally { client.release(); }
  }

  async stageOrderEditArtworkIntent(context: OperationContext, workspaceId: string, sourceAssignmentId: string,
    action: OrderEditArtworkAction, expectedWorkspaceRevision: number, requestId: string): Promise<OrderEditArtworkIntentResult> {
    requireArtwork(context, "artwork.view"); requireArtwork(context, "artwork.assign");
    validateSalesWorkspaceId(sourceAssignmentId);
    validateSalesWorkspaceMutation({ expectedRevision: expectedWorkspaceRevision, requestId });
    if (action !== "KEEP" && action !== "REMOVE") throw new V2ApplicationError("VALIDATION_ERROR", "Only KEEP and REMOVE Artwork intents are supported; replacement and designation require their existing owner workflows.");
    if (context.businessRequest?.id !== requestId) throw new V2ApplicationError("VALIDATION_ERROR", "A matching business request identity is required.");
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const workspace = await lockSalesWorkspaceForArtwork(client, context, workspaceId);
      assertSource(workspace);
      const input = { context, workspaceId, orderId: workspace.sourceDocumentId! };
      const requests = new PostgresOperationRequestRepository();
      const reserved = await requests.reserve(client, { organizationId: context.organizationId, operation: "artwork.workspace.order_edit.intent.v1", businessRequestId: requestId,
        payloadFingerprint: salesWorkspaceFingerprint({ workspaceId, sourceAssignmentId, action, expectedWorkspaceRevision }),
        principalKind: "staff", principalSubject: workspace.creatorUserId, staffActorUserId: workspace.creatorUserId });
      if (reserved.kind === "replay") {
        const result = reserved.request.resultJson as OrderEditArtworkIntentResult | null;
        if (!result || workspace.revision !== result.workspaceRevision || expectedWorkspaceRevision + 1 !== result.workspaceRevision) conflict("Order edit Artwork intent replay is stale.");
        await client.query("COMMIT"); return result;
      }
      if (workspace.revision !== expectedWorkspaceRevision) conflict("Sales workspace revision has changed.");
      const baseline = await session(client, input);
      await lockOrderArtworkCoordination(client, context.organizationId, input.orderId);
      await assertFingerprint(client, input, baseline);
      const ref = (await references(client, input)).find((row) => row.source_assignment_id === sourceAssignmentId);
      if (!ref || !workspace.lines.some((line) => line.id === ref.workspace_line_id)) throw new V2ApplicationError("NOT_FOUND", "Captured Artwork reference was not found on a retained workspace line.");
      if (ref.source_status !== "current") conflict("Only current captured Artwork references can be changed.");
      await client.query(`INSERT INTO v2_artwork_workspace_edit_intents(organization_id,workspace_id,source_assignment_id,action)
        VALUES($1,$2,$3,$4) ON CONFLICT(organization_id,workspace_id,source_assignment_id) DO UPDATE SET action=EXCLUDED.action,updated_at=now()`, [context.organizationId, workspaceId, sourceAssignmentId, action]);
      const revised = await advanceSalesWorkspaceArtworkRevision(client, context, workspaceId, workspace.revision);
      const result = { sourceAssignmentId, action, workspaceRevision: revised.revision };
      await requests.succeed(client, context.organizationId, reserved.request.id, { resourceType: "workspace_artwork_edit", resourceId: workspaceId, resultJson: result });
      await client.query("COMMIT"); return result;
    } catch (cause) { await client.query("ROLLBACK"); throw cause; }
    finally { client.release(); }
  }
}

/** Call BEFORE Sales.update, after its Billing lock step. The same client and
 * transaction must be retained through apply and commit, including empty sets. */
export async function validateOrderEditArtworkInTransaction(client: PoolClient, input: OrderEditArtworkSourceInput): Promise<OrderEditArtworkValidation> {
  const workspace = await lockSalesWorkspaceForArtwork(client, input.context, input.workspaceId, undefined, true);
  assertSource(workspace, input.orderId);
  const baseline = await session(client, input);
  await lockOrderArtworkCoordination(client, input.context.organizationId, input.orderId);
  await assertFingerprint(client, input, baseline);
  const refs = await references(client, input);
  const removals = refs.filter((ref) => ref.action === "REMOVE");
  if (removals.length) { requireArtwork(input.context, "artwork.view"); requireArtwork(input.context, "artwork.assign"); }
  if (refs.some((ref) => !workspace.lines.some((line) => line.id === ref.workspace_line_id && line.sourceLineId === ref.source_canonical_line_id))) {
    conflict("Source Order line removal is blocked by retained Artwork assignment history, even with a REMOVE intent.");
  }
  const claims = (await client.query<{ workspace_line_id: string | null; state: string }>("SELECT workspace_line_id,state FROM v2_artwork_workspace_claims WHERE organization_id=$1 AND workspace_id=$2 AND state IN ('pending','uploaded')", [input.context.organizationId, input.workspaceId])).rows;
  if (claims.length) {
    requireArtwork(input.context, "artwork.adopt"); requireArtwork(input.context, "artwork.assign");
    if (claims.some((claim) => claim.state !== "uploaded" || !workspace.lines.some((line) => line.id === claim.workspace_line_id))) conflict("Every staged Artwork file must finish uploading and be assigned before Save.");
  }
  const transactionId = (await client.query<{ id: string }>("SELECT txid_current()::text AS id")).rows[0]!.id;
  const validations = validated.get(client) ?? new Map();
  for (const [entryKey, entry] of validations) if (entry.transactionId !== transactionId) validations.delete(entryKey);
  validations.set(key(input), { transactionId, fingerprint: baseline.baseline_fingerprint }); validated.set(client, validations);
  return { hasChanges: Boolean(removals.length || claims.length), sourceLineIdsWithHistory: [...new Set(refs.map((ref) => ref.source_canonical_line_id))] };
}

/** All canonical owner errors are thrown, never returned as a false success to
 * the outer Sales transaction. This function never bumps a Sales revision. */
export async function applyOrderEditArtworkInTransaction(client: PoolClient, input: ApplyOrderEditArtworkInput): Promise<OrderEditArtworkApplyResult> {
  const workspace = await lockSalesWorkspaceForArtwork(client, input.context, input.workspaceId, undefined, true);
  assertSource(workspace, input.orderId);
  if (workspace.state !== "promoting" && workspace.state !== "promoted") conflict("Artwork apply requires the Sales edit promotion boundary.");
  const baseline = await session(client, input);
  await lockOrderArtworkCoordination(client, input.context.organizationId, input.orderId);
  const mappingFingerprint = salesWorkspaceFingerprint({ orderId: input.orderId, lineMap: [...input.lineMap].sort((a, b) => a.position - b.position) });
  const refs = await references(client, input);
  const removals = refs.filter((ref) => ref.action === "REMOVE");
  if (removals.length) { requireArtwork(input.context, "artwork.view"); requireArtwork(input.context, "artwork.assign"); }
  const applied = (await client.query<{ mapping_fingerprint: string; result_json: OrderEditArtworkApplyResult }>("SELECT * FROM v2_artwork_workspace_edit_applications WHERE organization_id=$1 AND workspace_id=$2", [input.context.organizationId, input.workspaceId])).rows[0];
  if (applied) {
    if (applied.mapping_fingerprint !== mappingFingerprint) conflict("Order edit Artwork was applied with a different line mapping.");
    // The staging owner rechecks upload capabilities and persisted line identity
    // on replay before any file IDs from the application receipt are disclosed.
    await promoteWorkspaceArtworkInTransaction(client, { organizationId: input.context.organizationId, workspaceId: input.workspaceId, actor: input.context,
      documentKind: "order", documentId: input.orderId, lineMap: input.lineMap });
    return applied.result_json;
  }
  const transactionId = (await client.query<{ id: string }>("SELECT txid_current()::text AS id")).rows[0]!.id;
  const validation = validated.get(client)?.get(key(input));
  if (!validation || validation.transactionId !== transactionId || validation.fingerprint !== baseline.baseline_fingerprint) conflict("Order edit Artwork must be validated before the Sales mutation on this transaction client.");
  await assertFingerprint(client, input, baseline, true);
  if (refs.some((ref) => !input.lineMap.some((line) => line.workspaceLineId === ref.workspace_line_id && line.canonicalLineId === ref.source_canonical_line_id))) conflict("Artwork history prevents source line deletion or remapping.");
  const artwork = new ArtworkApplicationService({ transaction: (action) => action(new PostgresArtworkTransaction(client)) });
  for (const ref of removals) {
    const requestId = `order-edit-artwork-remove:${input.workspaceId}:${ref.source_assignment_id}`;
    const result = await artwork.remove({ ...input.context, businessRequest: { id: requestId, payloadFingerprint: "owner-computed" } }, {
      businessRequestId: requestId, artworkAssignmentId: brandedId<"ArtworkAssignmentId">(ref.source_assignment_id),
      orderId: brandedId<"OrderId">(input.orderId), orderLineId: brandedId<"OrderLineId">(ref.source_canonical_line_id),
    });
    if (!result.ok) throw result.error;
  }
  const promoted = await promoteWorkspaceArtworkInTransaction(client, { organizationId: input.context.organizationId, workspaceId: input.workspaceId,
    actor: input.context, documentKind: "order", documentId: input.orderId, lineMap: input.lineMap });
  const result = { ...promoted, removedCount: removals.length };
  await client.query(`INSERT INTO v2_artwork_workspace_edit_applications(organization_id,workspace_id,mapping_fingerprint,result_json)
    VALUES($1,$2,$3,$4::jsonb)`, [input.context.organizationId, input.workspaceId, mappingFingerprint, JSON.stringify(result)]);
  validated.get(client)?.delete(key(input));
  return result;
}
