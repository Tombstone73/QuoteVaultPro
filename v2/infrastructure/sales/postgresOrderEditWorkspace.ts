import type { Pool, PoolClient } from "pg";
import type { OperationContext } from "../../src/application/operation.js";
import { AuthorityPolicy } from "../../src/authorization/authorityPolicy.js";
import type { Capability } from "../../src/authorization/capabilities.js";
import { failure, success, V2ApplicationError, type ApplicationResult } from "../../src/errors/applicationError.js";
import { OrderApplicationService, type OrderTransaction, type UpdateOrderInput } from "../../src/modules/sales/orderApplication.js";
import { OrderEditWorkspaceApplicationService, assertOrderEditSource, authorizeOrderEditWorkspace,
  orderEditWorkspaceChangeSet } from "../../src/modules/sales/orderEditWorkspace.js";
import { assertSalesWorkspaceMutable, bumpSalesWorkspaceRevision, getAuthorizedSalesWorkspace,
  salesWorkspaceFingerprint, validateSalesWorkspaceId, validateSalesWorkspaceLineInput, validateSalesWorkspaceMutation } from "../../src/modules/sales/workspaceApplication.js";
import type { SalesWorkspace, SalesWorkspaceLineMapEntry, SalesWorkspacePromotionReceipt, SalesWorkspaceTransaction,
  StartOrderEditWorkspaceInput, WorkspaceLine } from "../../src/modules/sales/workspaceContracts.js";
import { workspaceLineCommercialChanged, workspaceLinePreviewFingerprint } from "../../src/modules/sales/workspaceLines.js";
import type { PromoteSalesWorkspaceInput, WorkspacePromotionReceipt, WorkspacePromotionResult } from "../../src/modules/sales/workspacePromotion.js";
import { brandedId, canonicalJson, type JsonValue } from "../../src/modules/shared/commercialValues.js";
import { PostgresSalesWorkspaceStore, PostgresSalesWorkspaceTransaction } from "./postgresSalesWorkspace.js";
import type { WorkspaceOrderEditHandler } from "./postgresWorkspacePromotion.js";
import type { OrderEditBillingSafetyAssessment } from "../../src/modules/billing/orderEditSafety.js";

export interface OrderEditWorkspaceArtworkPort {
  captureFingerprint(context: OperationContext, sourceOrderId: string): Promise<string>;
  initializeWorkspace(context: OperationContext, workspace: SalesWorkspace): Promise<void>;
  /** Serialize validation/apply with canonical Artwork writers until outer COMMIT. */
  validate(context: OperationContext, workspace: SalesWorkspace): Promise<Readonly<{ changed: boolean }>>;
  apply(context: OperationContext, workspace: SalesWorkspace, lineMap: readonly SalesWorkspaceLineMapEntry[]): Promise<Readonly<{ changed: boolean }>>;
  /** Recheck current owner-specific removal/replace/staged capabilities before replay disclosure. */
  authorizeReplay(context: OperationContext, workspace: SalesWorkspace, receipt: SalesWorkspacePromotionReceipt): Promise<void>;
}
export type OrderEditWorkspaceOptions = Readonly<{
  now?: () => Date;
  orderTransaction: (client: PoolClient) => OrderTransaction;
  artwork: (client: PoolClient) => OrderEditWorkspaceArtworkPort;
  /** Billing owner locks relevant Invoices in stable ID order BEFORE Order FOR UPDATE. */
  billingEditGuard: (client: PoolClient, context: OperationContext, sourceOrderId: string) => Promise<OrderEditBillingSafetyAssessment>;
  reconcileOrderInTransaction: (client: PoolClient, organizationId: string, orderId: string) => Promise<void>;
  /** Sales consumes scoped operational facts; this does not authorize foreign writes. */
  readProductionContext: (client: PoolClient, organizationId: string, orderId: string, lineIds: readonly string[]) => Promise<readonly string[]>;
}>;
const requireCapability = (context: OperationContext, capability: Capability) => {
  if (!new AuthorityPolicy().decide(context.principal, { capability, resource: { organizationId: context.organizationId } }).allowed) {
    throw new V2ApplicationError("FORBIDDEN", "Current authority is insufficient for this Order edit.");
  }
};
const jsonResult = (value: object): Readonly<Record<string, JsonValue>> => JSON.parse(JSON.stringify(value,
  (_key, entry: unknown) => typeof entry === "bigint" ? entry.toString() : entry));

/** No static canonical persistence/V1 pool import. Every owner is injected on one client. */
export class PostgresOrderEditWorkspace {
  constructor(private readonly pool: Pick<Pool, "connect">, private readonly options: OrderEditWorkspaceOptions) {}
  async start(context: OperationContext, input: StartOrderEditWorkspaceInput): Promise<SalesWorkspace> {
    const store = new PostgresSalesWorkspaceStore(this.pool as Pool);
    return new OrderEditWorkspaceApplicationService(store, { now: this.options.now, source: (transaction) => {
      if (!(transaction instanceof PostgresSalesWorkspaceTransaction)) throw new V2ApplicationError("INTERNAL_ERROR", "Order edit requires the caller's transaction client.");
      const client = transaction.client, order = this.options.orderTransaction(client), artwork = this.options.artwork(client);
      return { read: (actor, id) => order.read(brandedId<"OrganizationId">(actor.organizationId), brandedId<"OrderId">(id), true),
        captureArtifactFingerprint: (actor, id) => artwork.captureFingerprint(actor, id),
        initializeArtwork: (actor, workspace) => artwork.initializeWorkspace(actor, workspace) };
    } }).start(context, input);
  }
  /** Injection into existing A/B promotion retains its mutex/transaction boundary. */
  readonly saveInTransaction: WorkspaceOrderEditHandler = async (client, context, input, workspace, store) => {
    authorizeOrderEditWorkspace(context, workspace);
    if (workspace.kind !== "order_edit" || input.target !== "order" || workspace.sourceDocumentKind !== "order" || !workspace.sourceDocumentId || !workspace.baseRevision) throw new V2ApplicationError("VALIDATION_ERROR", "Invalid Order edit Save target.");
    const now = this.options.now?.() ?? new Date();
    if (!Number.isFinite(Date.parse(workspace.expiresAt)) || !Number.isFinite(now.getTime()) || (workspace.state !== "promoted" && Date.parse(workspace.expiresAt) <= now.getTime())) throw new V2ApplicationError("CONFLICT", "Order edit workspace has expired.", { reason: "workspace_expired" });
    const diff = orderEditWorkspaceChangeSet(workspace);
    for (const line of workspace.lines) {
      if (workspaceLineCommercialChanged(line) && line.input.selling && line.input.selling.kind !== "calculated") requireCapability(context, "order.overridePrice");
    }
    const fingerprint = salesWorkspaceFingerprint({ organizationId: workspace.organizationId, creatorUserId: workspace.creatorUserId,
      workspaceId: workspace.id, target: "order", inputRevision: input.expectedRevision, header: workspace.header,
      lines: workspace.lines, removedLines: workspace.removedLines ?? [], sourceHeader: workspace.sourceHeader,
      sourceArtifactFingerprint: workspace.sourceArtifactFingerprint, sourceDocumentId: workspace.sourceDocumentId,
      baseRevision: workspace.baseRevision, expiresAt: workspace.expiresAt });
    await store.lockPromotionRequest(context.organizationId, input.requestId);
    const requestReceipt = await store.findPromotionRequest(context.organizationId, input.requestId);
    if (requestReceipt && (requestReceipt.workspaceId !== workspace.id || requestReceipt.fingerprint !== fingerprint)) throw new V2ApplicationError("CONFLICT", "Order edit Save request is already used for different input.", { reason: "promotion_request" });
    const artwork = this.options.artwork(client);
    const existing = await store.getPromotion(context.organizationId, workspace.id);
    if (existing) {
      if (workspace.state !== "promoted" || existing.target !== "order" || existing.documentId !== workspace.sourceDocumentId || existing.requestId !== input.requestId || existing.inputRevision !== input.expectedRevision || existing.fingerprint !== fingerprint) throw new V2ApplicationError("CONFLICT", "Order edit was saved with different input or request identity.", { reason: "promotion_request" });
      if (existing.result === undefined || typeof existing.artworkPromoted !== "boolean") throw new V2ApplicationError("INTERNAL_ERROR", "Order edit receipt is incomplete.");
      await artwork.authorizeReplay(context, workspace, existing);
      return { receipt: existing as WorkspacePromotionReceipt, replayed: true, promotedWorkspaceHeader: existing.header };
    }
    assertSalesWorkspaceMutable(workspace, input.expectedRevision, now);
    const tx = this.options.orderTransaction(client);
    const organizationId = brandedId<"OrganizationId">(context.organizationId), orderId = brandedId<"OrderId">(workspace.sourceDocumentId);
    // Scope/auth precede Invoice locks. This initial read intentionally takes no Order mutation lock.
    const scoped = await tx.read(organizationId, orderId);
    if (!scoped || scoped.order.organizationId !== organizationId || scoped.order.orderId !== orderId) throw new V2ApplicationError("NOT_FOUND", "Source Order was not found.");
    const billing = await this.options.billingEditGuard(client, context, orderId);
    const current = await tx.read(organizationId, orderId, true);
    if (!current) throw new V2ApplicationError("NOT_FOUND", "Source Order was not found.");
    assertOrderEditSource(current);
    if (current.revision !== workspace.baseRevision) throw new V2ApplicationError("STALE_STATE", "Source Order has changed; start a new edit workspace.", { reason: "source_revision" });
    const baselineSources = [...workspace.lines, ...(workspace.removedLines ?? [])].filter((line) => line.sourceLineId).sort((a, b) => a.sourcePosition! - b.sourcePosition!);
    if (baselineSources.length !== current.order.lines.length || baselineSources.some((line, index) => canonicalJson(line.sourceLineSnapshot) !== canonicalJson(current.order.lines[index]))) {
      throw new V2ApplicationError("STALE_STATE", "Source Order line evidence has changed.", { reason: "source_snapshot" });
    }
    if (diff.configurationChangedLineIds.length) {
      const blocked = await this.options.readProductionContext(client, context.organizationId, orderId, diff.configurationChangedLineIds);
      if (blocked.length) throw new V2ApplicationError("CONFLICT", "Quantity/configuration edits with progressed Production, rework/replacement or Fulfillment evidence require owner reconciliation (BDR-2/BDR-4).", { reason: "progressed_order_configuration", lineCount: blocked.length });
    }
    const artifactIntent = await artwork.validate(context, workspace);
    const changed = diff.changed || artifactIntent.changed;
    if (changed && billing.hasRetainedShippingCharges) throw new V2ApplicationError("CONFLICT", "This Invoice retains shipping additional charges. Billing reconciliation is required before saving an Order edit.", { reason: "retained_shipping_additional_charges" });
    if (changed && billing.editability !== "editable") throw new V2ApplicationError("CONFLICT", "Billing cannot synchronize this Order edit.", { reason: billing.reason ?? "billing_edit_blocked" });
    for (const line of workspace.lines) {
      if (!workspaceLineCommercialChanged(line)) continue;
      validateSalesWorkspaceLineInput(line.input);
      const preview = line.previews?.order;
      if (!preview || preview.target !== "order" || preview.inputFingerprint !== workspaceLinePreviewFingerprint(line.input, workspace.header.customerContact)
        || canonicalJson(preview.customerContact ?? null) !== canonicalJson(workspace.header.customerContact ?? null)) throw new V2ApplicationError("CONFLICT", "Current Order pricing evidence is required for every added or commercially changed line.", { reason: "preview_stale" });
    }
    await store.beginPromotion(context.organizationId, workspace.id, workspace.revision, input.requestId, "order", fingerprint);
    let actual = current;
    let correlations: readonly Readonly<{ clientLineKey: string; orderLineId: string }>[] = [];
    if (changed) {
      const businessRequestId = `workspace:order_edit:${salesWorkspaceFingerprint({ organizationId: context.organizationId, workspaceId: workspace.id, requestId: input.requestId })}`;
      const command: UpdateOrderInput = {
        businessRequestId, orderId, expectedRevision: workspace.baseRevision, patch: diff.patch, lineChanges: diff.lineChanges,
        finalLineOrder: diff.finalLineOrder };
      const ownerContext: OperationContext = { ...context, operationId: "sales.order.edit.v1",
        businessRequest: { id: businessRequestId, payloadFingerprint: `sha256:${salesWorkspaceFingerprint(command)}` } };
      const result = await new OrderApplicationService({ transaction: (action) => action(tx) }).update(ownerContext, command, { touchRevision: artifactIntent.changed });
      if (!result.ok) throw result.error;
      actual = result.value.order;
      correlations = result.value.lineCorrelations ?? [];
      if (actual.order.orderId !== orderId || actual.revision !== String(Number(workspace.baseRevision) + 1)) throw new V2ApplicationError("INTERNAL_ERROR", "Canonical Order edit did not advance its source revision exactly once.");
    }
    const lineMap: SalesWorkspaceLineMapEntry[] = workspace.lines.map((line, position) => {
      const canonicalLineId = line.sourceLineId ?? correlations.find((item) => item.clientLineKey === line.id)?.orderLineId;
      const canonical = actual.order.lines[position];
      if (!canonicalLineId || canonical?.lineId !== canonicalLineId) throw new V2ApplicationError("INTERNAL_ERROR", "Order edit line correlations or final ordering are incomplete.");
      if (workspaceLineCommercialChanged(line)) this.assertPreview(line, canonical);
      return { workspaceLineId: line.id, canonicalLineId, position };
    });
    if (actual.order.lines.length !== lineMap.length || new Set(lineMap.map((line) => line.canonicalLineId)).size !== lineMap.length
      || correlations.length !== workspace.lines.filter((line) => !line.sourceLineId).length) throw new V2ApplicationError("INTERNAL_ERROR", "Order edit requires a complete live TEMP-to-canonical line map.");
    await store.recordPromotionLineMap(context.organizationId, workspace.id, "order", orderId, lineMap);
    const appliedArtwork = changed ? await artwork.apply(context, workspace, lineMap) : { changed: false };
    if (appliedArtwork.changed !== artifactIntent.changed) throw new V2ApplicationError("CONFLICT", "Artwork edit intent changed during Save.", { reason: "artwork_intent_changed" });
    if (changed) await this.options.reconcileOrderInTransaction(client, context.organizationId, orderId);
    const final = await tx.read(organizationId, orderId);
    if (!final || final.revision !== actual.revision) throw new V2ApplicationError("INTERNAL_ERROR", "Order edit final revision is inconsistent.");
    const receipt: WorkspacePromotionReceipt = { workspaceId: workspace.id, organizationId: context.organizationId,
      requestId: input.requestId, fingerprint, inputRevision: input.expectedRevision, target: "order", documentId: orderId,
      documentRevision: final.revision, displayNumber: final.number.display, header: workspace.header,
      lineMap, promotedAt: now.toISOString(), result: jsonResult(final), artworkPromoted: appliedArtwork.changed };
    await store.recordPromotion(receipt);
    await store.update({ ...bumpSalesWorkspaceRevision(workspace, now), state: "promoted", promotion: receipt }, workspace.revision);
    return { receipt, replayed: false, promotedWorkspaceHeader: receipt.header };
  };
  async save(context: OperationContext, input: PromoteSalesWorkspaceInput): Promise<ApplicationResult<WorkspacePromotionResult>> {
    try {
      authorizeOrderEditWorkspace(context);
      if (!input || Object.getPrototypeOf(input) !== Object.prototype || Object.keys(input).some((key) => !["workspaceId", "target", "requestId", "expectedRevision"].includes(key)) || input.target !== "order") throw new V2ApplicationError("VALIDATION_ERROR", "Invalid Order edit Save.");
      validateSalesWorkspaceId(input.workspaceId);
      validateSalesWorkspaceMutation({ requestId: input.requestId, expectedRevision: input.expectedRevision });
      if (context.businessRequest?.id !== input.requestId) throw new V2ApplicationError("VALIDATION_ERROR", "Order edit Save business identity does not match the operation context.");
      const client = await this.pool.connect();
      try {
        await client.query("BEGIN");
        const store = new PostgresSalesWorkspaceTransaction(client);
        const workspace = await getAuthorizedSalesWorkspace(store, context, input.workspaceId, true);
        const result = await this.saveInTransaction(client, context, input, workspace, store);
        await client.query("COMMIT");
        return success(result);
      } catch (error) { await client.query("ROLLBACK"); throw error; }
      finally { client.release(); }
    } catch (error) {
      return failure(error instanceof V2ApplicationError ? error : new V2ApplicationError("INTERNAL_ERROR", "Order edit Save could not be completed.", {}, { cause: error }));
    }
  }
  private assertPreview(temp: WorkspaceLine, actual: import("../../src/modules/sales/contracts.js").SalesLineSnapshot): void {
    const preview = temp.previews?.order;
    if (!preview || canonicalJson(preview.resolvedConfiguration) !== canonicalJson(actual.resolvedConfiguration)
      || canonicalJson(preview.pricingResult) !== canonicalJson(actual.pricingResult)
      || canonicalJson(preview.sellingPriceDecision.resultingLineAmount) !== canonicalJson(actual.sellingLineAmount)) throw new V2ApplicationError("CONFLICT", "Current Product configuration or customer pricing changed; refresh before saving.", { reason: "preview_stale" });
  }
}
