import { randomUUID } from "node:crypto";
import type { OperationContext } from "../../application/operation.js";
import { AuthorityPolicy } from "../../authorization/authorityPolicy.js";
import type { SalesLineSnapshot } from "./contracts.js";
import { V2ApplicationError } from "../../errors/applicationError.js";
import {
  assertSalesWorkspaceMutable, authorizeSalesWorkspace, bumpSalesWorkspaceRevision, getAuthorizedSalesWorkspace,
  salesWorkspaceFingerprint, validateSalesWorkspaceHeader, validateSalesWorkspaceId,
  validateSalesWorkspaceLineInput, validateSalesWorkspaceMutation, visibleSalesWorkspaceState,
} from "./workspaceApplication.js";
import type {
  SalesWorkspace, SalesWorkspaceHeader, SalesWorkspaceLineInput, SalesWorkspaceMutation,
  SalesWorkspaceStore, SalesWorkspaceTarget, SalesWorkspaceTransaction, WorkspaceLine,
} from "./workspaceContracts.js";

/** Provenance of the original entry, not a substitute for current Pricing evidence. */
export function workspaceLinePreviewFingerprint(
  input: SalesWorkspaceLineInput, customerContact?: SalesWorkspaceHeader["customerContact"],
): string {
  return salesWorkspaceFingerprint({ input, customerContact: customerContact ?? null });
}

export interface SalesWorkspaceLinePricing {
  preview(context: OperationContext, header: SalesWorkspaceHeader, input: SalesWorkspaceLineInput, target?: SalesWorkspaceTarget): Promise<NonNullable<WorkspaceLine["previews"]>>;
}
export function workspaceSourceLineInput(source: SalesLineSnapshot): SalesWorkspaceLineInput {
  const decision = source.sellingPriceDecision;
  return { productId: source.productId, description: source.description, quantity: source.quantity,
    selections: source.resolvedConfiguration.selections,
    ...(source.resolvedConfiguration.dimensions ? { dimensions: source.resolvedConfiguration.dimensions } : {}),
    ...(decision.kind === "calculated" ? { selling: { kind: "calculated" as const } }
      : decision.kind === "unit_override" ? { selling: { kind: "unit_override" as const, unitCents: decision.resultingUnitAmount.cents, reason: decision.reason } }
      : decision.kind === "total_override" ? { selling: { kind: "total_override" as const, totalCents: decision.resultingLineAmount.cents, reason: decision.reason } } : {}) };
}
export function workspaceLineCommercialChanged(line: WorkspaceLine): boolean {
  if (!line.sourceLineSnapshot) return true;
  const commercial = ({ description: _description, ...input }: SalesWorkspaceLineInput) => ({ ...input, selections: input.selections ?? {} });
  return salesWorkspaceFingerprint(commercial(line.input)) !== salesWorkspaceFingerprint(commercial(workspaceSourceLineInput(line.sourceLineSnapshot)));
}
function operationalNote(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.length > 4000 || value.includes("\u0000")) throw new V2ApplicationError("VALIDATION_ERROR", "Invalid workspace operational note.");
  return value.trim() || undefined;
}

/** Only TEMP persistence is reachable here; each dependency joins the locked transaction. */
export class SalesWorkspaceLineService {
  constructor(private readonly store: SalesWorkspaceStore, private readonly options: Readonly<{
    pricing: (transaction: SalesWorkspaceTransaction) => SalesWorkspaceLinePricing;
    releaseLineArtwork: (transaction: SalesWorkspaceTransaction, workspace: SalesWorkspace, lineId: string) => Promise<void>;
    now?: () => Date;
    newId?: () => string;
  }>) {}

  async add(context: OperationContext, workspaceId: string,
    input: SalesWorkspaceMutation & Readonly<{ line: SalesWorkspaceLineInput; header?: SalesWorkspaceHeader; operationalNote?: string }>): Promise<SalesWorkspace> {
    this.validateCommand(input, ["line", "header", "operationalNote"]);
    const lineInput = validateSalesWorkspaceLineInput(input.line);
    const note = operationalNote(input.operationalNote);
    return this.mutate(context, workspaceId, input, "add_line", { line: lineInput, operationalNote: note }, async (tx, workspace) => {
      if (workspace.lines.length >= 500) throw new V2ApplicationError("VALIDATION_ERROR", "Workspace line limit reached.");
      const previews = await this.preview(tx, context, workspace, lineInput);
      const line: WorkspaceLine = { id: validateSalesWorkspaceId(this.options.newId?.() ?? randomUUID()),
        workspaceId, position: workspace.lines.length, input: lineInput, ...(note ? { operationalNote: note } : {}), previews, revision: 1 };
      await tx.putLine(workspace.organizationId, line);
      return { ...workspace, lines: [...workspace.lines, line] };
    });
  }

  async update(context: OperationContext, workspaceId: string,
    input: SalesWorkspaceMutation & Readonly<{ lineId: string; line: SalesWorkspaceLineInput; header?: SalesWorkspaceHeader; operationalNote?: string }>): Promise<SalesWorkspace> {
    this.validateCommand(input, ["lineId", "line", "header", "operationalNote"]);
    validateSalesWorkspaceId(input.lineId);
    const lineInput = validateSalesWorkspaceLineInput(input.line);
    const note = operationalNote(input.operationalNote);
    const changesNote = Object.prototype.hasOwnProperty.call(input, "operationalNote");
    return this.mutate(context, workspaceId, input, "update_line", { lineId: input.lineId, line: lineInput, changesNote, operationalNote: note }, async (tx, workspace) => {
      const prior = this.line(workspace, input.lineId);
      const candidate = { ...prior, input: lineInput };
      const commercialChanged = workspace.kind !== "order_edit" || workspaceLineCommercialChanged(candidate);
      if (commercialChanged && prior.sourceLineSnapshot && ["locked", "discount"].includes(prior.sourceLineSnapshot.sellingPriceDecision.kind)) {
        throw new V2ApplicationError("CONFLICT", "Historical locked or discounted pricing cannot be rebuilt through this workspace. Presentation edits preserve its source evidence.", { reason: "unsupported_source_selling_rebuild" });
      }
      const previews = commercialChanged ? await this.preview(tx, context, workspace, lineInput) : undefined;
      const replacement: WorkspaceLine = { ...candidate, ...(changesNote ? { operationalNote: note } : {}), previews, revision: prior.revision + 1 };
      await tx.putLine(workspace.organizationId, replacement);
      return { ...workspace, lines: workspace.lines.map((line) => line.id === prior.id ? replacement : line) };
    });
  }

  async remove(context: OperationContext, workspaceId: string,
    input: SalesWorkspaceMutation & Readonly<{ lineId: string; header?: SalesWorkspaceHeader }>): Promise<SalesWorkspace> {
    this.validateCommand(input, ["lineId", "header"]);
    validateSalesWorkspaceId(input.lineId);
    return this.mutate(context, workspaceId, input, "remove_line", { lineId: input.lineId }, async (tx, workspace) => {
      const removed = this.line(workspace, input.lineId);
      // Artwork releases its FK/claims before Sales removes this stable TEMP identity.
      await this.options.releaseLineArtwork(tx, workspace, input.lineId);
      await tx.deleteLine(workspace.organizationId, workspaceId, input.lineId);
      const lines = workspace.lines.filter((line) => line.id !== input.lineId);
      if (lines.length) await tx.reorderLines(workspace.organizationId, workspaceId, lines.map((line) => line.id));
      return { ...workspace, ...(removed.sourceLineId ? { removedLines: [...(workspace.removedLines ?? []), { ...removed, revision: removed.revision + 1 }] } : {}),
        lines: lines.map((line, position) => ({ ...line, position, revision: line.revision + 1 })) };
    });
  }

  async reorder(context: OperationContext, workspaceId: string,
    input: SalesWorkspaceMutation & Readonly<{ lineIds: readonly string[]; header?: SalesWorkspaceHeader }>): Promise<SalesWorkspace> {
    this.validateCommand(input, ["lineIds", "header"]);
    if (!Array.isArray(input.lineIds) || input.lineIds.length > 500) throw new V2ApplicationError("VALIDATION_ERROR", "Invalid workspace line order.");
    input.lineIds.forEach(validateSalesWorkspaceId);
    return this.mutate(context, workspaceId, input, "reorder_lines", { lineIds: input.lineIds }, async (tx, workspace) => {
      const lines = new Map(workspace.lines.map((line) => [line.id, line]));
      if (input.lineIds.length !== lines.size || new Set(input.lineIds).size !== lines.size || input.lineIds.some((id) => !lines.has(id))) {
        throw new V2ApplicationError("VALIDATION_ERROR", "Workspace line order must include every line exactly once.");
      }
      if (input.lineIds.length) await tx.reorderLines(workspace.organizationId, workspaceId, input.lineIds);
      return { ...workspace, lines: input.lineIds.map((id, position) => ({ ...lines.get(id)!, position, revision: lines.get(id)!.revision + 1 })) };
    });
  }

  async refresh(context: OperationContext, workspaceId: string,
    input: SalesWorkspaceMutation & Readonly<{ header?: SalesWorkspaceHeader }>): Promise<SalesWorkspace> {
    this.validateCommand(input, ["header"]);
    return this.mutate(context, workspaceId, input, "refresh_lines", {}, async (tx, workspace) => {
      const pricing = this.options.pricing(tx);
      const lines: WorkspaceLine[] = [];
      for (const line of workspace.lines) {
        if (workspace.kind === "order_edit" && !workspaceLineCommercialChanged(line)) { lines.push(line); continue; }
        if (workspace.kind === "order_edit" && line.sourceLineSnapshot && ["locked", "discount"].includes(line.sourceLineSnapshot.sellingPriceDecision.kind)) {
          throw new V2ApplicationError("CONFLICT", "Historical locked or discounted pricing cannot be rebuilt through this workspace.", { reason: "unsupported_source_selling_rebuild" });
        }
        const previews = await this.preview(tx, context, workspace, line.input, pricing);
        const refreshed = { ...line, previews, revision: line.revision + 1 };
        await tx.putLine(workspace.organizationId, refreshed);
        lines.push(refreshed);
      }
      return { ...workspace, lines };
    });
  }

  private async preview(tx: SalesWorkspaceTransaction, context: OperationContext, workspace: SalesWorkspace,
    input: SalesWorkspaceLineInput, pricing = this.options.pricing(tx)): Promise<NonNullable<WorkspaceLine["previews"]>> {
    if (workspace.kind === "order_edit" && input.selling && input.selling.kind !== "calculated" && !new AuthorityPolicy().decide(context.principal, {
      capability: "order.overridePrice", resource: { organizationId: context.organizationId },
    }).allowed) throw new V2ApplicationError("FORBIDDEN", "Order selling-price override authority is required.");
    return pricing.preview(context, workspace.header, input, workspace.kind === "order_edit" ? "order" : undefined);
  }

  private line(workspace: SalesWorkspace, id: string): WorkspaceLine {
    const line = workspace.lines.find((candidate) => candidate.id === id);
    if (!line) throw new V2ApplicationError("NOT_FOUND", "TEMP line was not found in this workspace.");
    return line;
  }

  private validateCommand(input: SalesWorkspaceMutation, fields: readonly string[]): void {
    if (!input || typeof input !== "object" || Object.getPrototypeOf(input) !== Object.prototype
      || Object.keys(input).some((key) => !["requestId", "expectedRevision", ...fields].includes(key))) {
      throw new V2ApplicationError("VALIDATION_ERROR", "Invalid workspace line command.");
    }
    validateSalesWorkspaceMutation({ requestId: input.requestId, expectedRevision: input.expectedRevision });
  }

  private async mutate(context: OperationContext, workspaceId: string,
    input: SalesWorkspaceMutation & Readonly<{ header?: SalesWorkspaceHeader }>, operation: string, payload: object,
    work: (tx: SalesWorkspaceTransaction, workspace: SalesWorkspace) => Promise<SalesWorkspace>): Promise<SalesWorkspace> {
    authorizeSalesWorkspace(context);
    validateSalesWorkspaceId(workspaceId);
    const header = input.header === undefined ? undefined : validateSalesWorkspaceHeader(input.header, context.organizationId);
    const fingerprint = salesWorkspaceFingerprint({ operation, expectedRevision: input.expectedRevision, payload: { ...payload, header } });
    return this.store.run(async (tx) => {
      const workspace = await getAuthorizedSalesWorkspace(tx, context, workspaceId, true);
      const replay = await tx.getRequest(context.organizationId, workspaceId, input.requestId);
      if (replay) {
        if (replay.operation !== operation || replay.fingerprint !== fingerprint) throw new V2ApplicationError("CONFLICT", "Workspace request input changed.");
        return visibleSalesWorkspaceState(replay.result, this.options.now?.() ?? new Date());
      }
      assertSalesWorkspaceMutable(workspace, input.expectedRevision, this.options.now?.());
      let next = workspace;
      if (header) {
        const changed = salesWorkspaceFingerprint(header.customerContact ?? null) !== salesWorkspaceFingerprint(workspace.header.customerContact ?? null);
        if (changed) await tx.invalidatePreviews(workspace.organizationId, workspaceId);
        next = { ...workspace, header, lines: changed ? workspace.lines.map((line) => ({ ...line, previews: undefined, revision: line.revision + 1 })) : workspace.lines };
      }
      const result = bumpSalesWorkspaceRevision(await work(tx, next), this.options.now?.());
      await tx.update(result, workspace.revision);
      await tx.recordRequest(workspace.organizationId, workspaceId, input.requestId, { operation, fingerprint, result });
      return result;
    });
  }
}
