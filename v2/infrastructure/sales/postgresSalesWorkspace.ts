import type { Pool, PoolClient } from "pg";
import type { OperationContext } from "../../src/application/operation.js";
import { V2ApplicationError } from "../../src/errors/applicationError.js";
import { assertSalesWorkspaceMutable, authorizeSalesWorkspace, getAuthorizedSalesWorkspace, salesWorkspaceFingerprint, validateSalesWorkspaceHeader,
  validateSalesWorkspaceId, validateSalesWorkspaceLineInput, validateSalesWorkspaceMutation } from "../../src/modules/sales/workspaceApplication.js";
import type { SalesWorkspace, SalesWorkspacePromotionReceipt, SalesWorkspaceRequestReceipt,
  SalesWorkspaceKind, SalesWorkspaceStore, SalesWorkspaceTransaction, WorkspaceLine, SalesWorkspaceTarget, SalesWorkspaceLineMapEntry } from "../../src/modules/sales/workspaceContracts.js";

type HeaderRow = { id: string; organization_id: string; creator_user_id: string; kind: SalesWorkspace["kind"];
  state: SalesWorkspace["state"]; source_document_kind: SalesWorkspace["sourceDocumentKind"] | null;
  source_document_id: string | null; base_revision: string | null; revision: number;
  header_json: SalesWorkspace["header"]; source_header_json?: SalesWorkspace["sourceHeader"] | null;
  source_artifact_fingerprint?: string | null; created_at: Date | string; updated_at: Date | string; expires_at: Date | string };
type LineRow = { id: string; workspace_id: string; position: number; source_line_id: string | null;
  input_json: WorkspaceLine["input"]; preview_json: WorkspaceLine["previews"] | null; revision: number;
  source_snapshot?: WorkspaceLine["sourceLineSnapshot"] | null; source_position?: number | null; operational_note?: string | null; removed?: boolean };
type PromotionRow = { workspace_id: string; organization_id: string; request_id: string; fingerprint: string;
  input_revision: number; target: SalesWorkspacePromotionReceipt["target"]; document_id: string; document_revision: string;
  display_number: string | null; header_json: SalesWorkspace["header"]; promoted_at: Date | string;
  result_json: SalesWorkspacePromotionReceipt["result"] | null; artwork_promoted: boolean | null };
const iso = (value: Date | string): string => new Date(value).toISOString();
const conflict = (message: string): never => { throw new V2ApplicationError("CONFLICT", message); };
const limitCheck = (limit: number): void => {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new V2ApplicationError("VALIDATION_ERROR", "Limit must be between 1 and 100.");
};

/** Joins an existing transaction. No connection acquisition or BEGIN/COMMIT here. */
export class PostgresSalesWorkspaceTransaction implements SalesWorkspaceTransaction {
  private readonly locked = new Map<string, string>();
  private readonly lockedKinds = new Map<string, SalesWorkspaceKind>();
  constructor(readonly client: PoolClient) {}
  private key(organizationId: string, workspaceId: string): string { return JSON.stringify([organizationId, workspaceId]); }
  private requireLock(organizationId: string, workspaceId: string): string {
    const creator = this.locked.get(this.key(organizationId, workspaceId));
    if (!creator) throw new V2ApplicationError("CONFLICT", "Workspace must be locked before mutation.");
    return creator;
  }
  async lockCreationRequest(organizationId: string, requestId: string): Promise<void> {
    await this.client.query("SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))", ["sales_workspace_create", JSON.stringify([organizationId, requestId])]);
  }
  async findCreation(organizationId: string, requestId: string) {
    const result = await this.client.query<{ id: string; creator_user_id: string; creation_fingerprint: string }>(
      "SELECT id,creator_user_id,creation_fingerprint FROM v2_sales_workspaces WHERE organization_id=$1 AND creation_request_id=$2", [organizationId, requestId]);
    const row = result.rows[0];
    return row ? { workspaceId: row.id, creatorUserId: row.creator_user_id, fingerprint: row.creation_fingerprint } : null;
  }
  async create(workspace: SalesWorkspace, requestId: string, fingerprint: string): Promise<void> {
    validateSalesWorkspaceId(workspace.id);
    validateSalesWorkspaceMutation({ requestId, expectedRevision: 1 });
    validateSalesWorkspaceHeader(workspace.header, workspace.organizationId);
    if (workspace.state !== "draft" || workspace.revision !== 1 || workspace.lines.length || workspace.promotion) throw new V2ApplicationError("VALIDATION_ERROR", "Only an initial empty TEMP draft can be created.");
    if (workspace.kind === "order_edit") {
      if (workspace.sourceDocumentKind !== "order" || !workspace.sourceDocumentId || !workspace.baseRevision || !workspace.sourceHeader || !workspace.sourceArtifactFingerprint) {
        throw new V2ApplicationError("VALIDATION_ERROR", "Order edit source evidence is required.");
      }
      await this.client.query(`INSERT INTO v2_sales_workspaces
        (id,organization_id,creator_user_id,kind,state,revision,header_json,creation_request_id,creation_fingerprint,created_at,updated_at,expires_at,
          source_document_kind,source_document_id,base_revision,source_header_json,source_artifact_fingerprint)
        VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11,$12,'order',$13,$14,$15::jsonb,$16)`,
      [workspace.id, workspace.organizationId, workspace.creatorUserId, workspace.kind, workspace.state, workspace.revision,
        JSON.stringify(workspace.header), requestId, fingerprint, workspace.createdAt, workspace.updatedAt, workspace.expiresAt,
        workspace.sourceDocumentId, workspace.baseRevision, JSON.stringify(workspace.sourceHeader), workspace.sourceArtifactFingerprint]);
    } else {
      if (workspace.kind !== "new_sales" || workspace.sourceDocumentId || workspace.sourceDocumentKind || workspace.baseRevision || workspace.sourceHeader || workspace.sourceArtifactFingerprint) {
        throw new V2ApplicationError("VALIDATION_ERROR", "Only a new Sales or captured Order edit draft can be created.");
      }
      await this.client.query(`INSERT INTO v2_sales_workspaces
      (id,organization_id,creator_user_id,kind,state,revision,header_json,creation_request_id,creation_fingerprint,created_at,updated_at,expires_at)
      VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11,$12)`,
    [workspace.id, workspace.organizationId, workspace.creatorUserId, workspace.kind, workspace.state, workspace.revision,
        JSON.stringify(workspace.header), requestId, fingerprint, workspace.createdAt, workspace.updatedAt, workspace.expiresAt]);
    }
    this.locked.set(this.key(workspace.organizationId, workspace.id), workspace.creatorUserId);
    this.lockedKinds.set(this.key(workspace.organizationId, workspace.id), workspace.kind);
  }
  async getKind(organizationId: string, creatorUserId: string, workspaceId: string): Promise<SalesWorkspaceKind | null> {
    const result = await this.client.query<{ kind: SalesWorkspaceKind }>("SELECT kind FROM v2_sales_workspaces WHERE organization_id=$1 AND creator_user_id=$2 AND id=$3", [organizationId, creatorUserId, workspaceId]);
    return result.rows[0]?.kind ?? null;
  }
  async findActiveOrderEdit(organizationId: string, creatorUserId: string, sourceOrderId: string, now: string): Promise<SalesWorkspace | null> {
    // Expired drafts still occupy the active index until their TEMP-only transition.
    const expired = await this.client.query<{ id: string }>(`UPDATE v2_sales_workspaces SET state='expired',revision=revision+1,updated_at=$4
      WHERE organization_id=$1 AND creator_user_id=$2 AND source_document_id=$3 AND kind='order_edit' AND state='draft' AND expires_at<=$4 RETURNING id`, [organizationId, creatorUserId, sourceOrderId, now]);
    for (const row of expired.rows) this.locked.set(this.key(organizationId, row.id), creatorUserId);
    const result = await this.client.query<{ id: string }>(`SELECT id FROM v2_sales_workspaces WHERE organization_id=$1 AND creator_user_id=$2
      AND source_document_id=$3 AND kind='order_edit' AND state='draft' AND expires_at>$4 FOR UPDATE`, [organizationId, creatorUserId, sourceOrderId, now]);
    return result.rows[0] ? this.get(organizationId, creatorUserId, result.rows[0].id, true) : null;
  }
  async findOrderEditStart(organizationId: string, requestId: string, creatorUserId: string) {
    const identity = await this.client.query<{ creator_user_id: string }>(
      "SELECT creator_user_id FROM v2_sales_order_edit_starts WHERE organization_id=$1 AND request_id=$2", [organizationId, requestId]);
    if (!identity.rows[0]) return null;
    if (identity.rows[0].creator_user_id !== creatorUserId) throw new V2ApplicationError("NOT_FOUND", "Order edit start was not found.");
    const result = await this.client.query<{ creator_user_id: string; fingerprint: string; result_json: SalesWorkspace }>(
      "SELECT creator_user_id,fingerprint,result_json FROM v2_sales_order_edit_starts WHERE organization_id=$1 AND request_id=$2 AND creator_user_id=$3", [organizationId, requestId, creatorUserId]);
    const row = result.rows[0];
    return row ? { creatorUserId: row.creator_user_id, fingerprint: row.fingerprint, result: row.result_json } : null;
  }
  async recordOrderEditStart(organizationId: string, requestId: string, fingerprint: string, workspace: SalesWorkspace): Promise<void> {
    const creator = this.requireLock(organizationId, workspace.id);
    if (creator !== workspace.creatorUserId || workspace.organizationId !== organizationId || workspace.kind !== "order_edit") conflict("Order edit start scope changed.");
    await this.client.query(`INSERT INTO v2_sales_order_edit_starts(organization_id,request_id,workspace_id,creator_user_id,fingerprint,result_json)
      VALUES($1,$2,$3,$4,$5,$6::jsonb)`, [organizationId, requestId, workspace.id, creator, fingerprint, JSON.stringify(workspace)]);
  }
  async get(organizationId: string, creatorUserId: string, workspaceId: string, lock = false): Promise<SalesWorkspace | null> {
    validateSalesWorkspaceId(workspaceId);
    const params = [organizationId, creatorUserId, workspaceId];
    const result = lock
      ? await this.client.query<HeaderRow>("SELECT * FROM v2_sales_workspaces WHERE organization_id=$1 AND creator_user_id=$2 AND id=$3 FOR UPDATE", params)
      : await this.client.query<HeaderRow>("SELECT * FROM v2_sales_workspaces WHERE organization_id=$1 AND creator_user_id=$2 AND id=$3 FOR SHARE", params);
    const row = result.rows[0];
    if (!row) return null;
    if (lock) { this.locked.set(this.key(organizationId, workspaceId), creatorUserId); this.lockedKinds.set(this.key(organizationId, workspaceId), row.kind); }
    const lines = await this.client.query<LineRow>("SELECT * FROM v2_sales_workspace_lines WHERE organization_id=$1 AND workspace_id=$2 ORDER BY position,id", [organizationId, workspaceId]);
    const promotion = await this.getPromotion(organizationId, workspaceId);
    const mappedLines = lines.rows.map((line) => ({ id: line.id, workspaceId: line.workspace_id, position: line.position,
      ...(line.source_line_id ? { sourceLineId: line.source_line_id } : {}),
      ...(line.source_snapshot ? { sourceLineSnapshot: line.source_snapshot } : {}),
      ...(line.source_position !== undefined && line.source_position !== null ? { sourcePosition: line.source_position } : {}),
      ...(line.operational_note ? { operationalNote: line.operational_note } : {}), input: line.input_json,
      ...(line.preview_json ? { previews: line.preview_json } : {}), revision: line.revision }));
    return { id: row.id, organizationId: row.organization_id, creatorUserId: row.creator_user_id, kind: row.kind,
      state: row.state, revision: row.revision, header: row.header_json,
      ...(row.source_document_kind ? { sourceDocumentKind: row.source_document_kind } : {}),
      ...(row.source_document_id ? { sourceDocumentId: row.source_document_id } : {}),
      ...(row.base_revision ? { baseRevision: row.base_revision } : {}),
      ...(row.source_header_json ? { sourceHeader: row.source_header_json } : {}),
      ...(row.source_artifact_fingerprint ? { sourceArtifactFingerprint: row.source_artifact_fingerprint } : {}),
      lines: mappedLines.filter((_line, index) => !lines.rows[index]!.removed),
      ...(row.kind === "order_edit" ? { removedLines: mappedLines.filter((_line, index) => lines.rows[index]!.removed) } : {}),
      createdAt: iso(row.created_at), updatedAt: iso(row.updated_at), expiresAt: iso(row.expires_at),
      ...(promotion ? { promotion } : {}) };
  }
  async list(organizationId: string, creatorUserId: string, now: string, limit: number, kinds: readonly SalesWorkspaceKind[] = ["new_sales", "order_edit"]): Promise<readonly SalesWorkspace[]> {
    limitCheck(limit);
    const rows = await this.client.query<{ id: string }>(`SELECT id FROM v2_sales_workspaces
      WHERE organization_id=$1 AND creator_user_id=$2 AND state='draft' AND expires_at>$3 AND kind=ANY($5::text[])
      ORDER BY updated_at DESC,id LIMIT $4 FOR SHARE`, [organizationId, creatorUserId, now, limit, kinds]);
    const workspaces: SalesWorkspace[] = [];
    for (const row of rows.rows) { const workspace = await this.get(organizationId, creatorUserId, row.id); if (workspace) workspaces.push(workspace); }
    return workspaces;
  }
  async update(workspace: SalesWorkspace, expectedRevision: number): Promise<void> {
    const creator = this.requireLock(workspace.organizationId, workspace.id);
    if (creator !== workspace.creatorUserId) conflict("Workspace creator cannot change.");
    validateSalesWorkspaceHeader(workspace.header, workspace.organizationId);
    if (workspace.revision !== expectedRevision + 1) conflict("Workspace update requires one CAS revision.");
    if (workspace.state === "promoting") conflict("Use beginPromotion for the transaction-local promotion transition.");
    const result = await this.client.query(`UPDATE v2_sales_workspaces SET header_json=$1::jsonb,state=$2,revision=$3,updated_at=$4
      WHERE organization_id=$5 AND creator_user_id=$6 AND id=$7 AND revision=$8 AND state IN ('draft','promoting')`,
    [JSON.stringify(workspace.header), workspace.state, workspace.revision, workspace.updatedAt, workspace.organizationId, creator, workspace.id, expectedRevision]);
    if (result.rowCount !== 1) conflict("Workspace changed or is no longer mutable.");
  }
  async putLine(organizationId: string, line: WorkspaceLine): Promise<void> {
    this.requireLock(organizationId, line.workspaceId);
    validateSalesWorkspaceId(line.id);
    validateSalesWorkspaceLineInput(line.input);
    const result = this.lockedKinds.get(this.key(organizationId, line.workspaceId)) === "order_edit" || line.sourceLineSnapshot || Object.prototype.hasOwnProperty.call(line, "operationalNote")
      ? await this.client.query(`INSERT INTO v2_sales_workspace_lines
        (id,organization_id,workspace_id,position,source_line_id,input_json,preview_json,revision,source_snapshot,source_position,operational_note)
        VALUES($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,$9::jsonb,$10,$11)
        ON CONFLICT(id) DO UPDATE SET position=EXCLUDED.position,input_json=EXCLUDED.input_json,preview_json=EXCLUDED.preview_json,
          operational_note=EXCLUDED.operational_note,revision=EXCLUDED.revision,updated_at=now()
        WHERE v2_sales_workspace_lines.organization_id=EXCLUDED.organization_id AND v2_sales_workspace_lines.workspace_id=EXCLUDED.workspace_id
          AND v2_sales_workspace_lines.source_line_id IS NOT DISTINCT FROM EXCLUDED.source_line_id
          AND v2_sales_workspace_lines.source_snapshot IS NOT DISTINCT FROM EXCLUDED.source_snapshot
          AND v2_sales_workspace_lines.source_position IS NOT DISTINCT FROM EXCLUDED.source_position
          AND v2_sales_workspace_lines.removed=false AND v2_sales_workspace_lines.revision=EXCLUDED.revision-1`,
      [line.id, organizationId, line.workspaceId, line.position, line.sourceLineId ?? null, JSON.stringify(line.input),
        line.previews ? JSON.stringify(line.previews) : null, line.revision, line.sourceLineSnapshot ? JSON.stringify(line.sourceLineSnapshot) : null,
        line.sourcePosition ?? null, line.operationalNote ?? null])
      : await this.client.query(`INSERT INTO v2_sales_workspace_lines
      (id,organization_id,workspace_id,position,source_line_id,input_json,preview_json,revision)
      VALUES($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8)
      ON CONFLICT (id) DO UPDATE SET position=EXCLUDED.position,input_json=EXCLUDED.input_json,
        preview_json=EXCLUDED.preview_json,revision=EXCLUDED.revision,updated_at=now()
      WHERE v2_sales_workspace_lines.organization_id=EXCLUDED.organization_id
        AND v2_sales_workspace_lines.workspace_id=EXCLUDED.workspace_id
        AND v2_sales_workspace_lines.revision=EXCLUDED.revision-1`,
    [line.id, organizationId, line.workspaceId, line.position, line.sourceLineId ?? null, JSON.stringify(line.input),
      line.previews ? JSON.stringify(line.previews) : null, line.revision]);
    if (result.rowCount !== 1) conflict("Workspace line identity or revision changed.");
  }
  async deleteLine(organizationId: string, workspaceId: string, lineId: string): Promise<void> {
    this.requireLock(organizationId, workspaceId);
    validateSalesWorkspaceId(lineId);
    const source = await this.client.query<{ source_line_id: string | null }>("SELECT source_line_id FROM v2_sales_workspace_lines WHERE organization_id=$1 AND workspace_id=$2 AND id=$3", [organizationId, workspaceId, lineId]);
    const result = source.rows[0]?.source_line_id
      ? await this.client.query("UPDATE v2_sales_workspace_lines SET removed=true,position=1000000+source_position,revision=revision+1,updated_at=now() WHERE organization_id=$1 AND workspace_id=$2 AND id=$3 AND removed=false", [organizationId, workspaceId, lineId])
      : await this.client.query("DELETE FROM v2_sales_workspace_lines WHERE organization_id=$1 AND workspace_id=$2 AND id=$3", [organizationId, workspaceId, lineId]);
    if (result.rowCount !== 1) throw new V2ApplicationError("NOT_FOUND", "Workspace line was not found.");
  }
  async reorderLines(organizationId: string, workspaceId: string, lineIds: readonly string[]): Promise<void> {
    this.requireLock(organizationId, workspaceId);
    lineIds.forEach(validateSalesWorkspaceId);
    const existing = await this.client.query<LineRow>("SELECT * FROM v2_sales_workspace_lines WHERE organization_id=$1 AND workspace_id=$2", [organizationId, workspaceId]);
    const live = existing.rows.filter((line) => !line.removed);
    if (new Set(lineIds).size !== lineIds.length || live.length !== lineIds.length || live.some((line) => !lineIds.includes(line.id))) {
      throw new V2ApplicationError("VALIDATION_ERROR", "Reordering requires every workspace line exactly once.");
    }
    // Empty workspaces are valid; no generated IN () or dynamic SQL.
    for (const [position, id] of lineIds.entries()) {
      await this.client.query("UPDATE v2_sales_workspace_lines SET position=$1,revision=revision+1,updated_at=now() WHERE organization_id=$2 AND workspace_id=$3 AND id=$4", [position, organizationId, workspaceId, id]);
    }
  }
  async invalidatePreviews(organizationId: string, workspaceId: string): Promise<void> {
    this.requireLock(organizationId, workspaceId);
    await this.client.query("UPDATE v2_sales_workspace_lines SET preview_json=NULL,revision=revision+1,updated_at=now() WHERE organization_id=$1 AND workspace_id=$2", [organizationId, workspaceId]);
  }
  async getRequest(organizationId: string, workspaceId: string, requestId: string): Promise<SalesWorkspaceRequestReceipt | null> {
    this.requireLock(organizationId, workspaceId);
    const result = await this.client.query<{ operation: string; fingerprint: string; result_json: SalesWorkspace }>(
      "SELECT operation,fingerprint,result_json FROM v2_sales_workspace_requests WHERE organization_id=$1 AND workspace_id=$2 AND request_id=$3", [organizationId, workspaceId, requestId]);
    const row = result.rows[0];
    return row ? { operation: row.operation, fingerprint: row.fingerprint, result: row.result_json } : null;
  }
  async recordRequest(organizationId: string, workspaceId: string, requestId: string, receipt: SalesWorkspaceRequestReceipt): Promise<void> {
    const creator = this.requireLock(organizationId, workspaceId);
    validateSalesWorkspaceMutation({ requestId, expectedRevision: receipt.result.revision });
    if (receipt.result.organizationId !== organizationId || receipt.result.id !== workspaceId || receipt.result.creatorUserId !== creator) conflict("Workspace receipt scope mismatch.");
    await this.client.query(`INSERT INTO v2_sales_workspace_requests(organization_id,workspace_id,request_id,operation,fingerprint,result_json)
      VALUES($1,$2,$3,$4,$5,$6::jsonb)`, [organizationId, workspaceId, requestId, receipt.operation, receipt.fingerprint, JSON.stringify(receipt.result)]);
  }
  async getPromotion(organizationId: string, workspaceId: string): Promise<SalesWorkspacePromotionReceipt | null> {
    const result = await this.client.query<PromotionRow>("SELECT * FROM v2_sales_workspace_promotions WHERE organization_id=$1 AND workspace_id=$2", [organizationId, workspaceId]);
    const row = result.rows[0];
    if (!row) return null;
    const lineMap = await this.getPromotionLineMap(organizationId, workspaceId);
    return { workspaceId: row.workspace_id, organizationId: row.organization_id, requestId: row.request_id,
      fingerprint: row.fingerprint, inputRevision: row.input_revision, target: row.target, documentId: row.document_id,
      documentRevision: row.document_revision, ...(row.display_number ? { displayNumber: row.display_number } : {}),
      header: row.header_json, promotedAt: iso(row.promoted_at), lineMap,
      ...(row.result_json !== null ? { result: row.result_json } : {}),
      ...(row.artwork_promoted !== null ? { artworkPromoted: row.artwork_promoted } : {}) };
  }
  async lockPromotionRequest(organizationId: string, requestId: string): Promise<void> {
    validateSalesWorkspaceMutation({ requestId, expectedRevision: 1 });
    await this.client.query("SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))", ["sales_workspace_promote", JSON.stringify([organizationId, requestId])]);
  }
  async findPromotionRequest(organizationId: string, requestId: string): Promise<SalesWorkspacePromotionReceipt | null> {
    const result = await this.client.query<{ workspace_id: string }>("SELECT workspace_id FROM v2_sales_workspace_promotions WHERE organization_id=$1 AND request_id=$2", [organizationId, requestId]);
    return result.rows[0] ? this.getPromotion(organizationId, result.rows[0].workspace_id) : null;
  }
  async beginPromotion(organizationId: string, workspaceId: string, expectedRevision: number,
    requestId: string, target: SalesWorkspaceTarget, fingerprint: string): Promise<void> {
    const creator = this.requireLock(organizationId, workspaceId);
    validateSalesWorkspaceId(workspaceId);
    validateSalesWorkspaceMutation({ requestId, expectedRevision });
    if ((target !== "quote" && target !== "order") || !/^[a-f0-9]{64}$/.test(fingerprint)) {
      throw new V2ApplicationError("VALIDATION_ERROR", "Invalid workspace promotion identity.");
    }
    await this.lockPromotionRequest(organizationId, requestId);
    if (await this.findPromotionRequest(organizationId, requestId)) conflict("Promotion request is already used.");
    const result = await this.client.query(`UPDATE v2_sales_workspaces SET state='promoting',
      promotion_request_id=$5,promotion_target=$6,promotion_fingerprint=$7
      WHERE organization_id=$1 AND creator_user_id=$2 AND id=$3 AND revision=$4
         AND (kind='new_sales' OR (kind='order_edit' AND $6='order')) AND state='draft' AND expires_at>now()`,
    [organizationId, creator, workspaceId, expectedRevision, requestId, target, fingerprint]);
    if (result.rowCount !== 1) conflict("Workspace changed, expired, or is no longer an active draft.");
  }
  async getPromotionLineMap(organizationId: string, workspaceId: string): Promise<readonly SalesWorkspaceLineMapEntry[]> {
    const lines = await this.client.query<{ workspace_line_id: string; canonical_line_id: string; position: number }>(
      "SELECT workspace_line_id,canonical_line_id,position FROM v2_sales_workspace_promotion_lines WHERE organization_id=$1 AND workspace_id=$2 ORDER BY position", [organizationId, workspaceId]);
    return lines.rows.map((line) => ({ workspaceLineId: line.workspace_line_id, canonicalLineId: line.canonical_line_id, position: line.position }));
  }
  async recordPromotionLineMap(organizationId: string, workspaceId: string, target: SalesWorkspaceTarget,
    documentId: string, lineMap: readonly SalesWorkspaceLineMapEntry[]): Promise<void> {
    this.requireLock(organizationId, workspaceId);
    validateSalesWorkspaceId(documentId);
    const current = await this.client.query<{ state: SalesWorkspace["state"]; promotion_target: SalesWorkspaceTarget | null }>(
      "SELECT state,promotion_target FROM v2_sales_workspaces WHERE organization_id=$1 AND id=$2", [organizationId, workspaceId]);
    if (current.rows[0]?.state !== "promoting" || current.rows[0].promotion_target !== target) conflict("Line mapping requires the reserved promotion target.");
    const lines = await this.client.query<LineRow>("SELECT * FROM v2_sales_workspace_lines WHERE organization_id=$1 AND workspace_id=$2 ORDER BY position", [organizationId, workspaceId]);
    const live = lines.rows.filter((line) => !line.removed);
    if (!live.length || live.length !== lineMap.length || new Set(lineMap.map((line) => line.canonicalLineId)).size !== lineMap.length
      || live.some((line, index) => line.id !== lineMap[index]?.workspaceLineId || line.position !== lineMap[index]?.position)) {
      conflict("Promotion requires a complete ordered TEMP-to-canonical line map.");
    }
    for (const line of lineMap) {
      validateSalesWorkspaceId(line.canonicalLineId);
      await this.client.query(`INSERT INTO v2_sales_workspace_promotion_lines
        (organization_id,workspace_id,workspace_line_id,document_id,canonical_line_id,position,target) VALUES($1,$2,$3,$4,$5,$6,$7)`,
      [organizationId, workspaceId, line.workspaceLineId, documentId, line.canonicalLineId, line.position, target]);
    }
  }
  async recordPromotion(receipt: SalesWorkspacePromotionReceipt): Promise<void> {
    this.requireLock(receipt.organizationId, receipt.workspaceId);
    validateSalesWorkspaceMutation({ requestId: receipt.requestId, expectedRevision: receipt.inputRevision });
    validateSalesWorkspaceId(receipt.documentId);
    validateSalesWorkspaceHeader(receipt.header, receipt.organizationId);
    const existingMap = await this.getPromotionLineMap(receipt.organizationId, receipt.workspaceId);
    if (existingMap.length) {
      if (salesWorkspaceFingerprint(existingMap) !== salesWorkspaceFingerprint(receipt.lineMap)) conflict("Promotion receipt differs from its persisted line map.");
    } else await this.recordPromotionLineMap(receipt.organizationId, receipt.workspaceId, receipt.target, receipt.documentId, receipt.lineMap);
    await this.client.query(`INSERT INTO v2_sales_workspace_promotions
      (organization_id,workspace_id,request_id,fingerprint,input_revision,target,document_id,document_revision,display_number,header_json,promoted_at,result_json,artwork_promoted)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12::jsonb,$13)`,
    [receipt.organizationId, receipt.workspaceId, receipt.requestId, receipt.fingerprint, receipt.inputRevision, receipt.target,
      receipt.documentId, receipt.documentRevision, receipt.displayNumber ?? null, JSON.stringify(receipt.header), receipt.promotedAt,
      receipt.result === undefined ? null : JSON.stringify(receipt.result), receipt.artworkPromoted ?? null]);
  }
  async expireDrafts(organizationId: string, creatorUserId: string, now: string, limit: number, kinds: readonly SalesWorkspaceKind[] = ["new_sales", "order_edit"]): Promise<readonly string[]> {
    limitCheck(limit);
    const result = await this.client.query<{ id: string }>(`WITH candidates AS (
      SELECT id FROM v2_sales_workspaces WHERE organization_id=$1 AND creator_user_id=$2 AND state='draft' AND expires_at<=$3 AND kind=ANY($5::text[])
      ORDER BY expires_at,id LIMIT $4 FOR UPDATE SKIP LOCKED)
      UPDATE v2_sales_workspaces w SET state='expired',revision=w.revision+1,updated_at=$3
      FROM candidates c WHERE w.id=c.id AND w.organization_id=$1 AND w.creator_user_id=$2 RETURNING w.id`, [organizationId, creatorUserId, now, limit, kinds]);
    for (const row of result.rows) this.locked.set(this.key(organizationId, row.id), creatorUserId);
    return result.rows.map((row) => row.id);
  }
}

export class PostgresSalesWorkspaceStore implements SalesWorkspaceStore {
  constructor(private readonly pool: Pool) {}
  async run<T>(work: (transaction: PostgresSalesWorkspaceTransaction) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await work(new PostgresSalesWorkspaceTransaction(client));
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      if (error instanceof V2ApplicationError) throw error;
      const code = (error as { code?: string }).code;
      if (["23505", "40001", "40P01"].includes(code ?? "")) throw new V2ApplicationError("CONFLICT", "Workspace transaction conflicted.", {}, { cause: error });
      if (["23503", "23514", "22001", "22003"].includes(code ?? "")) throw new V2ApplicationError("VALIDATION_ERROR", "Workspace persistence constraints rejected the request.", {}, { cause: error });
      throw error;
    } finally { client.release(); }
  }
  async withWorkspace<T>(context: OperationContext, workspaceId: string, expectedRevision: number,
    work: (transaction: PostgresSalesWorkspaceTransaction, workspace: SalesWorkspace) => Promise<T>): Promise<T> {
    authorizeSalesWorkspace(context);
    validateSalesWorkspaceId(workspaceId);
    return this.run(async (tx) => {
      const workspace = await getAuthorizedSalesWorkspace(tx, context, workspaceId, true);
      assertSalesWorkspaceMutable(workspace, expectedRevision);
      return work(tx, workspace);
    });
  }
}
