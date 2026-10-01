import { randomUUID } from "node:crypto";
import type { OperationContext } from "../../application/operation.js";
import { V2ApplicationError } from "../../errors/applicationError.js";
import { assertSalesLineSnapshot, normalizeSalesJobLabel } from "./contracts.js";
import type { OrderReadModel, UpdateOrderInput } from "./orderApplication.js";
import { authorizeSalesWorkspace, salesWorkspaceFingerprint, validateSalesWorkspaceHeader,
  validateSalesWorkspaceId, validateSalesWorkspaceMutation, visibleSalesWorkspaceState } from "./workspaceApplication.js";
import type { SalesWorkspace, SalesWorkspaceHeader, SalesWorkspaceSourceHeader, SalesWorkspaceStore,
  SalesWorkspaceTransaction, StartOrderEditWorkspaceInput } from "./workspaceContracts.js";
import { workspaceLineCommercialChanged, workspaceSourceLineInput } from "./workspaceLines.js";
import { brandedId } from "../shared/commercialValues.js";

export interface OrderEditWorkspaceSourcePort {
  /** Consistent, locked canonical source on the workspace transaction client. */
  read(context: OperationContext, sourceOrderId: string): Promise<OrderReadModel | null>;
  captureArtifactFingerprint(context: OperationContext, sourceOrderId: string): Promise<string>;
  /** Artwork owns its reference rows, including the empty-set baseline. */
  initializeArtwork(context: OperationContext, workspace: SalesWorkspace): Promise<void>;
}
export function authorizeOrderEditWorkspace(context: OperationContext, workspace?: SalesWorkspace) {
  return authorizeSalesWorkspace(context, workspace ?? { kind: "order_edit", organizationId: context.organizationId,
    creatorUserId: context.principal.kind === "staff" ? context.principal.userId : "" });
}
export function assertOrderEditSource(order: OrderReadModel): void {
  if (order.order.archivedAt || order.order.commercialState === "cancelled") {
    throw new V2ApplicationError("CONFLICT", "Archived or cancelled Orders cannot be edited through a workspace.", { reason: "source_order_terminal" });
  }
}
export function orderEditWorkspaceHeader(source: SalesWorkspaceSourceHeader): SalesWorkspaceHeader {
  return { customerContact: source.customerContact,
    ...(source.purchaseOrderNumber === undefined ? {} : { purchaseOrderNumber: source.purchaseOrderNumber }),
    ...(source.jobLabel === undefined ? {} : { jobLabel: source.jobLabel }),
    ...(source.requestedDueDate === undefined ? {} : { requestedDueDate: new Date(source.requestedDueDate).toISOString() }),
    ...(source.requestedFulfillment === undefined ? {} : { requestedFulfillment: source.requestedFulfillment }),
    terms: source.terms };
}
export class OrderEditWorkspaceApplicationService {
  constructor(private readonly store: SalesWorkspaceStore, private readonly options: Readonly<{
    source: (transaction: SalesWorkspaceTransaction) => OrderEditWorkspaceSourcePort;
    now?: () => Date;
    newId?: () => string;
  }>) {}
  async start(context: OperationContext, input: StartOrderEditWorkspaceInput): Promise<SalesWorkspace> {
    const principal = authorizeOrderEditWorkspace(context);
    if (!input || Object.getPrototypeOf(input) !== Object.prototype || Object.keys(input).some((key) => !["requestId", "sourceOrderId", "expectedSourceRevision"].includes(key))) {
      throw new V2ApplicationError("VALIDATION_ERROR", "Invalid Order edit workspace start.");
    }
    validateSalesWorkspaceId(input.sourceOrderId);
    validateSalesWorkspaceMutation({ requestId: input.requestId, expectedRevision: 1 });
    if (input.expectedSourceRevision !== undefined && !/^[1-9]\d{0,17}$/.test(input.expectedSourceRevision)) {
      throw new V2ApplicationError("VALIDATION_ERROR", "Invalid source Order revision.");
    }
    const fingerprint = salesWorkspaceFingerprint(input);
    return this.store.run(async (tx) => {
      if (!tx.findOrderEditStart || !tx.recordOrderEditStart || !tx.findActiveOrderEdit) {
        throw new V2ApplicationError("INTERNAL_ERROR", "Order edit persistence is not configured.");
      }
      await tx.lockCreationRequest(context.organizationId, input.requestId);
      const replay = await tx.findOrderEditStart(context.organizationId, input.requestId, principal.userId);
      if (replay) {
        if (replay.creatorUserId !== principal.userId || replay.fingerprint !== fingerprint) throw new V2ApplicationError("CONFLICT", "Order edit start request input changed.");
        authorizeOrderEditWorkspace(context, replay.result);
        return visibleSalesWorkspaceState(replay.result, this.options.now?.() ?? new Date());
      }
      if (await tx.findCreation(context.organizationId, input.requestId)) throw new V2ApplicationError("CONFLICT", "Workspace creation request is already used.");
      await tx.lockCreationRequest(context.organizationId, `order_edit:${principal.userId}:${input.sourceOrderId}`);
      const now = this.options.now?.() ?? new Date();
      const active = await tx.findActiveOrderEdit(context.organizationId, principal.userId, input.sourceOrderId, now.toISOString());
      if (active) {
        authorizeOrderEditWorkspace(context, active);
        if (input.expectedSourceRevision !== undefined && active.baseRevision !== input.expectedSourceRevision) throw new V2ApplicationError("STALE_STATE", "The resumed workspace has a different source revision.");
        await tx.recordOrderEditStart(context.organizationId, input.requestId, fingerprint, active);
        return active;
      }
      const source = this.options.source(tx);
      const current = await source.read(context, input.sourceOrderId);
      if (!current || current.order.organizationId !== context.organizationId || current.order.orderId !== input.sourceOrderId) throw new V2ApplicationError("NOT_FOUND", "Source Order was not found.");
      assertOrderEditSource(current);
      if (input.expectedSourceRevision !== undefined && current.revision !== input.expectedSourceRevision) throw new V2ApplicationError("STALE_STATE", "Source Order has changed; reload before editing.");
      if (!/^[1-9]\d{0,17}$/.test(current.revision) || !current.order.lines.length || current.order.lines.length > 500) throw new V2ApplicationError("VALIDATION_ERROR", "Source Order exceeds edit workspace limits.");
      if (typeof current.number.display !== "string" || !current.number.display.length || current.number.display.length > 300 || current.number.display.includes("\u0000")) {
        throw new V2ApplicationError("VALIDATION_ERROR", "Source Order display number exceeds edit workspace limits.");
      }
      const { lines, ...headerSnapshot } = current.order;
      const sourceHeader = { ...headerSnapshot, orderNumber: current.number.display };
      if (Buffer.byteLength(JSON.stringify(sourceHeader), "utf8") > 262144) throw new V2ApplicationError("VALIDATION_ERROR", "Source header evidence exceeds edit workspace limits.");
      const id = validateSalesWorkspaceId(this.options.newId?.() ?? randomUUID());
      const sourceArtifactFingerprint = await source.captureArtifactFingerprint(context, input.sourceOrderId);
      if (!/^(?:sha256:)?[a-f0-9]{64}$/.test(sourceArtifactFingerprint)) throw new V2ApplicationError("INTERNAL_ERROR", "Artwork source fingerprint is incomplete.");
      const workspace: SalesWorkspace = { id, organizationId: context.organizationId, creatorUserId: principal.userId,
        kind: "order_edit", state: "draft", sourceDocumentKind: "order", sourceDocumentId: input.sourceOrderId,
        baseRevision: current.revision, sourceHeader, sourceArtifactFingerprint, revision: 1,
        header: validateSalesWorkspaceHeader(orderEditWorkspaceHeader(sourceHeader), context.organizationId),
        lines: lines.map((line, position) => {
          assertSalesLineSnapshot(line);
          if (line.resolvedConfiguration.organizationId !== context.organizationId || Buffer.byteLength(JSON.stringify(line), "utf8") > 262144) throw new V2ApplicationError("VALIDATION_ERROR", "Source line evidence exceeds edit workspace limits.");
          return { id: validateSalesWorkspaceId(this.options.newId?.() ?? randomUUID()), workspaceId: id, position, sourcePosition: position,
            sourceLineId: line.lineId, sourceLineSnapshot: line, input: workspaceSourceLineInput(line),
            ...(line.operationalNote === undefined ? {} : { operationalNote: line.operationalNote }), revision: 1 };
        }), removedLines: [], createdAt: now.toISOString(), updatedAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString() };
      if (Buffer.byteLength(JSON.stringify(workspace), "utf8") > 8 * 1024 * 1024) throw new V2ApplicationError("VALIDATION_ERROR", "Source snapshot exceeds edit workspace limits.");
      await tx.create({ ...workspace, lines: [] }, input.requestId, fingerprint);
      for (const line of workspace.lines) await tx.putLine(context.organizationId, line);
      await source.initializeArtwork(context, workspace);
      await tx.recordOrderEditStart(context.organizationId, input.requestId, fingerprint, workspace);
      return workspace;
    });
  }
}

export type OrderEditWorkspaceChangeSet = Readonly<{
  patch: UpdateOrderInput["patch"];
  lineChanges: NonNullable<UpdateOrderInput["lineChanges"]>;
  finalLineOrder: NonNullable<UpdateOrderInput["finalLineOrder"]>;
  changed: boolean;
  repricesLines: boolean;
  configurationChangedLineIds: readonly string[];
}>;
/** Source evidence, never an ACTIVE Product lookup, determines the complete diff. */
export function orderEditWorkspaceChangeSet(workspace: SalesWorkspace): OrderEditWorkspaceChangeSet {
  if (workspace.kind !== "order_edit" || !workspace.sourceHeader || !workspace.baseRevision || workspace.sourceHeader.orderId !== workspace.sourceDocumentId) {
    throw new V2ApplicationError("INTERNAL_ERROR", "Order edit source evidence is incomplete.");
  }
  const baseline = validateSalesWorkspaceHeader(orderEditWorkspaceHeader(workspace.sourceHeader), workspace.organizationId);
  const header = validateSalesWorkspaceHeader(workspace.header, workspace.organizationId);
  if (!header.customerContact || !workspace.lines.length) throw new V2ApplicationError("VALIDATION_ERROR", "Order edit Save requires a customer or contact and at least one live line.");
  const same = (left: unknown, right: unknown) => salesWorkspaceFingerprint(left ?? null) === salesWorkspaceFingerprint(right ?? null);
  // Partial UI terms cannot erase hidden source tax/representative references.
  const terms = { ...workspace.sourceHeader.terms, ...header.terms };
  // Compare owner meaning without rewriting an untouched historical spelling.
  const sameJobLabel = same(header.jobLabel, baseline.jobLabel)
    || normalizeSalesJobLabel(header.jobLabel) === normalizeSalesJobLabel(baseline.jobLabel);
  const sameDueDate = same(header.requestedDueDate, baseline.requestedDueDate)
    || same(header.requestedDueDate, workspace.sourceHeader.requestedDueDate);
  const patch: UpdateOrderInput["patch"] = {
    ...(same(header.customerContact, baseline.customerContact) ? {} : { customerContact: header.customerContact }),
    ...(same(header.purchaseOrderNumber, baseline.purchaseOrderNumber) ? {} : { purchaseOrderNumber: header.purchaseOrderNumber ?? null }),
    ...(sameJobLabel ? {} : { jobLabel: header.jobLabel ?? null }),
    ...(sameDueDate ? {} : { requestedDueDate: header.requestedDueDate ?? null }),
    ...(same(header.requestedFulfillment, baseline.requestedFulfillment) ? {} : { requestedFulfillment: header.requestedFulfillment ?? null }),
    ...(same(terms, baseline.terms) ? {} : { terms }),
  };
  const lineChanges: NonNullable<UpdateOrderInput["lineChanges"]>[number][] = [];
  const configurationChangedLineIds: string[] = [];
  const allSources = [...workspace.lines, ...(workspace.removedLines ?? [])].filter((line) => line.sourceLineId);
  if (new Set(allSources.map((line) => line.sourceLineId)).size !== allSources.length || new Set(allSources.map((line) => line.sourcePosition)).size !== allSources.length) {
    throw new V2ApplicationError("INTERNAL_ERROR", "Order edit source-line identities are inconsistent.");
  }
  let repricesLines = false;
  const tempIds = new Set<string>();
  for (const [position, line] of workspace.lines.entries()) {
    if (line.workspaceId !== workspace.id || line.position !== position || tempIds.has(line.id)) throw new V2ApplicationError("INTERNAL_ERROR", "Order edit TEMP line identity or order is inconsistent.");
    tempIds.add(line.id);
    const source = line.sourceLineSnapshot;
    if (!line.sourceLineId) {
      if (source) throw new V2ApplicationError("INTERNAL_ERROR", "A new TEMP line cannot supply source evidence.");
      lineChanges.push({ kind: "add", line: { ...line.input, clientLineKey: line.id, ...(line.operationalNote ? { operationalNote: line.operationalNote } : {}) } });
      repricesLines = true;
      continue;
    }
    if (!source || source.lineId !== line.sourceLineId || !Number.isInteger(line.sourcePosition) || line.sourcePosition! < 0) throw new V2ApplicationError("INTERNAL_ERROR", "Source line evidence is incomplete.");
    const commercialChanged = workspaceLineCommercialChanged(line);
    if (commercialChanged) {
      if (["locked", "discount"].includes(source.sellingPriceDecision.kind)) throw new V2ApplicationError("CONFLICT", "Historical locked or discounted pricing cannot be rebuilt through this workspace. Presentation edits preserve its source evidence.", { reason: "unsupported_source_selling_rebuild" });
      const selectionsChanged = !same(line.input.selections ?? {}, source.resolvedConfiguration.selections);
      const dimensionsChanged = !same(line.input.dimensions, source.resolvedConfiguration.dimensions);
      lineChanges.push({ kind: "update", lineId: source.lineId, line: { productId: line.input.productId, quantity: line.input.quantity,
        ...(line.input.description === undefined ? {} : { description: line.input.description }),
        ...(line.input.selling === undefined ? {} : { selling: line.input.selling }),
        ...(selectionsChanged ? { selections: line.input.selections ?? {} } : {}),
        ...(dimensionsChanged && line.input.dimensions ? { dimensions: line.input.dimensions } : {}) } });
      repricesLines = true;
      if (line.input.productId !== source.productId || line.input.quantity !== source.quantity
        || dimensionsChanged || selectionsChanged
        || (line.previews?.order && !same(line.previews.order.resolvedConfiguration, source.resolvedConfiguration))) configurationChangedLineIds.push(source.lineId);
    } else if (line.input.description !== source.description) {
      lineChanges.push({ kind: "update_description", lineId: source.lineId, description: line.input.description ?? source.description });
    }
    // The canonical generic reprice rebuilds the line and does not carry its note.
    if (line.operationalNote !== source.operationalNote || (commercialChanged && line.operationalNote !== undefined)) lineChanges.push({ kind: "update_note", lineId: source.lineId,
      ...(line.operationalNote === undefined ? {} : { note: line.operationalNote }) });
  }
  for (const line of workspace.removedLines ?? []) {
    if (!line.sourceLineId || !line.sourceLineSnapshot || line.sourceLineId !== line.sourceLineSnapshot.lineId) throw new V2ApplicationError("INTERNAL_ERROR", "Removed source evidence is incomplete.");
    lineChanges.push({ kind: "remove", lineId: line.sourceLineSnapshot.lineId });
  }
  const originalOrder = allSources.slice().sort((a, b) => a.sourcePosition! - b.sourcePosition!).map((line) => line.sourceLineId);
  const orderChanged = !same(originalOrder, workspace.lines.map((line) => line.sourceLineId ?? line.id));
  const finalLineOrder: NonNullable<UpdateOrderInput["finalLineOrder"]> = workspace.lines.map((line) => line.sourceLineId
    ? { lineId: brandedId<"SalesLineId">(line.sourceLineId) } : { clientLineKey: line.id });
  if (patch.customerContact && repricesLines) throw new V2ApplicationError("CONFLICT", "Customer changes combined with repricing or new/duplicated lines require Sales customer-pricing reconciliation.", { reason: "customer_change_with_repricing" });
  return { patch, lineChanges, finalLineOrder,
    changed: Object.keys(patch).length > 0 || lineChanges.length > 0 || orderChanged, repricesLines, configurationChangedLineIds };
}
