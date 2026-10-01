import { randomUUID } from "node:crypto";
import type { OperationContext } from "../../application/operation.js";
import { V2ApplicationError } from "../../errors/applicationError.js";
import {
  assertSalesWorkspaceMutable, authorizeSalesWorkspace, bumpSalesWorkspaceRevision,
  salesWorkspaceFingerprint, validateSalesWorkspaceHeader, validateSalesWorkspaceId,
  validateSalesWorkspaceLineInput, validateSalesWorkspaceMutation, visibleSalesWorkspaceState,
} from "./workspaceApplication.js";
import type {
  SalesWorkspace, SalesWorkspaceHeader, SalesWorkspaceLineInput, SalesWorkspaceMutation,
  SalesWorkspaceStore, SalesWorkspaceTransaction, WorkspaceLine,
} from "./workspaceContracts.js";

/** Provenance of the original entry, not a substitute for current Pricing evidence. */
export function workspaceLinePreviewFingerprint(
  input: SalesWorkspaceLineInput, customerContact?: SalesWorkspaceHeader["customerContact"],
): string {
  return salesWorkspaceFingerprint({ input, customerContact: customerContact ?? null });
}

export interface SalesWorkspaceLinePricing {
  preview(context: OperationContext, header: SalesWorkspaceHeader, input: SalesWorkspaceLineInput): Promise<NonNullable<WorkspaceLine["previews"]>>;
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
    input: SalesWorkspaceMutation & Readonly<{ line: SalesWorkspaceLineInput; header?: SalesWorkspaceHeader }>): Promise<SalesWorkspace> {
    this.validateCommand(input, ["line", "header"]);
    const lineInput = validateSalesWorkspaceLineInput(input.line);
    return this.mutate(context, workspaceId, input, "add_line", { line: lineInput }, async (tx, workspace) => {
      if (workspace.lines.length >= 500) throw new V2ApplicationError("VALIDATION_ERROR", "Workspace line limit reached.");
      const previews = await this.options.pricing(tx).preview(context, workspace.header, lineInput);
      const line: WorkspaceLine = { id: validateSalesWorkspaceId(this.options.newId?.() ?? randomUUID()),
        workspaceId, position: workspace.lines.length, input: lineInput, previews, revision: 1 };
      await tx.putLine(workspace.organizationId, line);
      return { ...workspace, lines: [...workspace.lines, line] };
    });
  }

  async update(context: OperationContext, workspaceId: string,
    input: SalesWorkspaceMutation & Readonly<{ lineId: string; line: SalesWorkspaceLineInput; header?: SalesWorkspaceHeader }>): Promise<SalesWorkspace> {
    this.validateCommand(input, ["lineId", "line", "header"]);
    validateSalesWorkspaceId(input.lineId);
    const lineInput = validateSalesWorkspaceLineInput(input.line);
    return this.mutate(context, workspaceId, input, "update_line", { lineId: input.lineId, line: lineInput }, async (tx, workspace) => {
      const prior = this.line(workspace, input.lineId);
      const previews = await this.options.pricing(tx).preview(context, workspace.header, lineInput);
      const replacement: WorkspaceLine = { ...prior, input: lineInput, previews, revision: prior.revision + 1 };
      await tx.putLine(workspace.organizationId, replacement);
      return { ...workspace, lines: workspace.lines.map((line) => line.id === prior.id ? replacement : line) };
    });
  }

  async remove(context: OperationContext, workspaceId: string,
    input: SalesWorkspaceMutation & Readonly<{ lineId: string; header?: SalesWorkspaceHeader }>): Promise<SalesWorkspace> {
    this.validateCommand(input, ["lineId", "header"]);
    validateSalesWorkspaceId(input.lineId);
    return this.mutate(context, workspaceId, input, "remove_line", { lineId: input.lineId }, async (tx, workspace) => {
      this.line(workspace, input.lineId);
      // Artwork releases its FK/claims before Sales removes this stable TEMP identity.
      await this.options.releaseLineArtwork(tx, workspace, input.lineId);
      await tx.deleteLine(workspace.organizationId, workspaceId, input.lineId);
      const lines = workspace.lines.filter((line) => line.id !== input.lineId);
      if (lines.length) await tx.reorderLines(workspace.organizationId, workspaceId, lines.map((line) => line.id));
      return { ...workspace, lines: lines.map((line, position) => ({ ...line, position, revision: line.revision + 1 })) };
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
        const previews = await pricing.preview(context, workspace.header, line.input);
        const refreshed = { ...line, previews, revision: line.revision + 1 };
        await tx.putLine(workspace.organizationId, refreshed);
        lines.push(refreshed);
      }
      return { ...workspace, lines };
    });
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
    const principal = authorizeSalesWorkspace(context);
    validateSalesWorkspaceId(workspaceId);
    const header = input.header === undefined ? undefined : validateSalesWorkspaceHeader(input.header, context.organizationId);
    const fingerprint = salesWorkspaceFingerprint({ operation, expectedRevision: input.expectedRevision, payload: { ...payload, header } });
    return this.store.run(async (tx) => {
      const workspace = await tx.get(context.organizationId, principal.userId, workspaceId, true);
      if (!workspace) throw new V2ApplicationError("NOT_FOUND", "Sales workspace was not found.");
      authorizeSalesWorkspace(context, workspace);
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
