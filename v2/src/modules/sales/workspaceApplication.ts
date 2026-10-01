import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { requireOperationPrincipalScope, type OperationContext } from "../../application/operation.js";
import { AuthorityPolicy } from "../../authorization/authorityPolicy.js";
import type { StaffPrincipal } from "../../authorization/principals.js";
import { V2ApplicationError } from "../../errors/applicationError.js";
import { canonicalJson } from "../shared/commercialValues.js";
import type {
  CreateSalesWorkspaceInput, SalesWorkspace, SalesWorkspaceHeader, SalesWorkspaceLineInput,
  SalesWorkspaceKind, SalesWorkspaceMutation, SalesWorkspaceStore, SalesWorkspaceTransaction, SaveSalesWorkspaceInput,
} from "./workspaceContracts.js";

const invalid = (message: string): never => { throw new V2ApplicationError("VALIDATION_ERROR", message); };
const uuid = z.string().uuid();
const requestId = z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const revision = z.number().int().positive().max(2147483646);
const text = (max: number) => z.string().max(max).refine((value) => !value.includes("\u0000"));
const contact = z.object({ organizationId: uuid, customerId: uuid.optional(), contactId: uuid.optional() }).strict()
  .refine((value) => Boolean(value.customerId || value.contactId));
const isoDate = z.string().datetime({ offset: true }).refine((value) => Number.isFinite(Date.parse(value)));
const headerSchema = z.object({
  customerContact: contact.optional(), purchaseOrderNumber: text(200).optional(), jobLabel: text(300).optional(),
  requestedDueDate: isoDate.optional(), notes: text(4000).optional(),
  terms: z.object({ termsCode: text(100).optional(), taxContextReference: text(200).optional(),
    salesRepresentativeId: uuid.optional(), commercialNotes: text(4000).optional() }).strict().optional(),
  requestedFulfillment: z.object({ method: z.enum(["pickup", "shipping", "local_delivery"]),
    instructions: text(2000).optional(), destination: z.object({ recipient: text(200).optional(),
      company: text(200).optional(), addressLine1: text(300), addressLine2: text(300).optional(), city: text(200),
      region: text(100).optional(), postalCode: text(40).optional(), country: text(100).optional(),
      phone: text(80).optional() }).strict().optional() }).strict().optional(),
}).strict();
const decimal = z.string().max(30).regex(/^(?:0|[1-9]\d*)(?:\.\d+)?$/).refine((value) => Number(value) > 0 && Number(value) <= 1e9);
const lineSchema = z.object({ productId: uuid, description: text(4000).optional(),
  quantity: z.number().int().positive().max(2147483647),
  dimensions: z.object({ width: decimal, height: decimal, unit: z.enum(["in", "ft", "mm"]) }).strict().optional(),
  selections: z.record(z.unknown()).optional(),
  selling: z.discriminatedUnion("kind", [z.object({ kind: z.literal("calculated") }).strict(),
    z.object({ kind: z.literal("unit_override"), unitCents: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), reason: text(1000).refine((value) => value.trim().length > 0) }).strict(),
    z.object({ kind: z.literal("total_override"), totalCents: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), reason: text(1000).refine((value) => value.trim().length > 0) }).strict(),
  ]).optional(),
}).strict();

function parse<T>(schema: z.ZodType<T>, input: unknown, label: string): T {
  const result = schema.safeParse(input);
  if (!result.success) return invalid(`Invalid ${label}.`);
  return result.data;
}

/** JSON selections are data, not an unbounded escape hatch for commercial facts. */
function assertSelectionValue(value: unknown, depth = 0, budget = { remaining: 2048 }): void {
  if (--budget.remaining < 0 || depth > 6) invalid("Selections exceed structural limits.");
  if (value === null || typeof value === "boolean") return;
  if (typeof value === "number" && Number.isFinite(value)) return;
  if (typeof value === "string" && value.length <= 4000 && !value.includes("\u0000")) return;
  if (Array.isArray(value) && value.length <= 128) { value.forEach((entry) => assertSelectionValue(entry, depth + 1, budget)); return; }
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    const entries = Object.entries(value);
    if (entries.length > 128) invalid("Too many selection fields.");
    for (const [key, entry] of entries) {
      if (!key || key.length > 128 || ["__proto__", "constructor", "prototype"].includes(key) || key.includes("\u0000")) invalid("Invalid selection key.");
      assertSelectionValue(entry, depth + 1, budget);
    }
    return;
  }
  invalid("Selections must be bounded JSON values.");
}

export function validateSalesWorkspaceId(value: unknown): string { return parse(uuid, value, "workspace identity"); }
export function validateSalesWorkspaceMutation(value: SalesWorkspaceMutation): SalesWorkspaceMutation {
  return parse(z.object({ requestId, expectedRevision: revision }).strict(), value, "workspace mutation");
}
export function validateSalesWorkspaceHeader(value: unknown, organizationId: string): SalesWorkspaceHeader {
  const parsed = parse(headerSchema, value, "workspace header");
  if (parsed.customerContact && parsed.customerContact.organizationId !== organizationId) {
    throw new V2ApplicationError("WRONG_TENANT", "Customer reference is outside the workspace organization.");
  }
  if (Buffer.byteLength(JSON.stringify(parsed), "utf8") > 32768) invalid("Workspace header is too large.");
  return parsed as SalesWorkspaceHeader;
}
export function validateSalesWorkspaceLineInput(value: unknown): SalesWorkspaceLineInput {
  if (value && typeof value === "object" && "selections" in value && value.selections !== undefined) assertSelectionValue(value.selections);
  const parsed = parse(lineSchema, value, "workspace line input");
  if (parsed.selections) assertSelectionValue(parsed.selections);
  if (Buffer.byteLength(JSON.stringify(parsed), "utf8") > 65536) invalid("Workspace line input is too large.");
  return parsed as SalesWorkspaceLineInput;
}
export function salesWorkspaceFingerprint(value: unknown): string {
  // Optional TS properties are absent on the JSON wire, not distinct requests.
  return createHash("sha256").update(canonicalJson(JSON.parse(JSON.stringify(value)))).digest("hex");
}
export function authorizeSalesWorkspace(context: OperationContext, workspace?: Pick<SalesWorkspace, "kind" | "organizationId" | "creatorUserId">): StaffPrincipal {
  requireOperationPrincipalScope(context);
  const principal = context.principal;
  if (principal.kind !== "staff") throw new V2ApplicationError("FORBIDDEN", "Sales workspaces require a verified Staff principal.");
  const policy = new AuthorityPolicy();
  const canCreate = ["quote.create", "order.create"].some((capability) => policy.decide(principal, {
    capability: capability as "quote.create" | "order.create", resource: { organizationId: context.organizationId },
  }).allowed);
  const canEdit = ["order.view", "order.edit"].every((capability) => policy.decide(principal, {
    capability: capability as "order.view" | "order.edit", resource: { organizationId: context.organizationId },
  }).allowed);
  if (workspace?.kind === "order_edit" ? !canEdit : workspace ? !canCreate : !canCreate && !canEdit) {
    throw new V2ApplicationError("FORBIDDEN", workspace?.kind === "order_edit" ? "Order viewing and editing authority is required." : "Sales workspace authority is required.");
  }
  if (workspace && (workspace.organizationId !== context.organizationId || workspace.creatorUserId !== principal.userId)) {
    throw new V2ApplicationError("NOT_FOUND", "Sales workspace was not found.");
  }
  if (workspace && workspace.kind !== "new_sales" && workspace.kind !== "order_edit") {
    throw new V2ApplicationError("CONFLICT", "Transactional Quote editing is not supported.", { reason: "workspace_kind_unsupported" });
  }
  return principal;
}
/** Read only identity/kind until fresh authority for the exact workspace is established. */
export async function getAuthorizedSalesWorkspace(tx: SalesWorkspaceTransaction, context: OperationContext,
  workspaceId: string, lock = false): Promise<SalesWorkspace> {
  const principal = authorizeSalesWorkspace(context);
  if (tx.getKind) {
    const kind = await tx.getKind(context.organizationId, principal.userId, workspaceId);
    if (!kind) throw new V2ApplicationError("NOT_FOUND", "Sales workspace was not found.");
    authorizeSalesWorkspace(context, { kind, organizationId: context.organizationId, creatorUserId: principal.userId });
  }
  const workspace = await tx.get(context.organizationId, principal.userId, workspaceId, lock);
  if (!workspace) throw new V2ApplicationError("NOT_FOUND", "Sales workspace was not found.");
  authorizeSalesWorkspace(context, workspace);
  return workspace;
}
export function assertSalesWorkspaceMutable(workspace: SalesWorkspace, expectedRevision: number, now = new Date()): void {
  parse(revision, expectedRevision, "workspace revision");
  if (workspace.state !== "draft" || !Number.isFinite(Date.parse(workspace.expiresAt)) || !Number.isFinite(now.getTime()) || Date.parse(workspace.expiresAt) <= now.getTime()) {
    throw new V2ApplicationError("CONFLICT", "Sales workspace is no longer an active draft.");
  }
  if (workspace.kind !== "new_sales" && workspace.kind !== "order_edit") invalid("Transactional Quote editing is not implemented.");
  if (workspace.revision !== expectedRevision) throw new V2ApplicationError("CONFLICT", "Sales workspace revision has changed.");
}
export function bumpSalesWorkspaceRevision(workspace: SalesWorkspace, now = new Date()): SalesWorkspace {
  parse(revision, workspace.revision, "workspace revision");
  return { ...workspace, revision: workspace.revision + 1, updatedAt: now.toISOString() };
}
const visibleState = (workspace: SalesWorkspace, now: Date): SalesWorkspace => workspace.state === "draft" && Date.parse(workspace.expiresAt) <= now.getTime()
  ? { ...workspace, state: "expired" } : workspace;
export const visibleSalesWorkspaceState = visibleState;

export class SalesWorkspaceApplicationService {
  constructor(private readonly store: SalesWorkspaceStore, private readonly options: Readonly<{
    now?: () => Date;
    newId?: () => string;
    onDiscard?: (transaction: SalesWorkspaceTransaction, workspace: SalesWorkspace) => Promise<void>;
  }> = {}) {}
  private now(): Date { return this.options.now?.() ?? new Date(); }

  async create(context: OperationContext, input: CreateSalesWorkspaceInput): Promise<SalesWorkspace> {
    const principal = authorizeSalesWorkspace(context, { kind: "new_sales", organizationId: context.organizationId,
      creatorUserId: context.principal.kind === "staff" ? context.principal.userId : "" });
    const parsed = parse(z.object({ requestId, kind: z.enum(["new_sales", "quote_edit", "order_edit"]).optional(),
      header: headerSchema.optional(), sourceDocumentKind: z.enum(["quote", "order"]).optional(),
      sourceDocumentId: uuid.optional(), baseRevision: text(128).optional() }).strict(), input, "workspace creation");
    if ((parsed.kind ?? "new_sales") !== "new_sales" || parsed.sourceDocumentKind || parsed.sourceDocumentId || parsed.baseRevision) {
      invalid("Transactional source editing is not implemented.");
    }
    const header = validateSalesWorkspaceHeader(parsed.header ?? {}, context.organizationId);
    const fingerprint = salesWorkspaceFingerprint({ kind: "new_sales", header });
    return this.store.run(async (tx) => {
      await tx.lockCreationRequest(context.organizationId, parsed.requestId);
      const existing = await tx.findCreation(context.organizationId, parsed.requestId);
      if (existing) {
        if (existing.creatorUserId !== principal.userId) throw new V2ApplicationError("CONFLICT", "Workspace creation request is already used.");
        const workspace = await getAuthorizedSalesWorkspace(tx, context, existing.workspaceId, true);
        if (existing.fingerprint !== fingerprint) throw new V2ApplicationError("CONFLICT", "Workspace creation request input changed.");
        return visibleState(workspace, this.now());
      }
      const now = this.now();
      const workspace: SalesWorkspace = { id: validateSalesWorkspaceId(this.options.newId?.() ?? randomUUID()),
        organizationId: context.organizationId, creatorUserId: principal.userId, kind: "new_sales", state: "draft",
        revision: 1, header, lines: [], createdAt: now.toISOString(), updatedAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString() };
      await tx.create(workspace, parsed.requestId, fingerprint);
      return workspace;
    });
  }
  async get(context: OperationContext, workspaceId: string): Promise<SalesWorkspace> {
    authorizeSalesWorkspace(context);
    validateSalesWorkspaceId(workspaceId);
    return this.store.run(async (tx) => {
      const workspace = await getAuthorizedSalesWorkspace(tx, context, workspaceId);
      return visibleState(workspace, this.now());
    });
  }
  async list(context: OperationContext, limit = 50): Promise<readonly SalesWorkspace[]> {
    const principal = authorizeSalesWorkspace(context);
    parse(z.number().int().min(1).max(100), limit, "workspace list limit");
    const kinds: SalesWorkspaceKind[] = [];
    for (const kind of ["new_sales", "order_edit"] as const) {
      try { authorizeSalesWorkspace(context, { kind, organizationId: context.organizationId, creatorUserId: principal.userId }); kinds.push(kind); }
      catch (error) { if (!(error instanceof V2ApplicationError) || error.code !== "FORBIDDEN") throw error; }
    }
    return this.store.run(async (tx) => (await tx.list(context.organizationId, principal.userId, this.now().toISOString(), limit, kinds))
      .filter((workspace) => kinds.includes(workspace.kind)));
  }
  async saveDraft(context: OperationContext, workspaceId: string, input: SaveSalesWorkspaceInput): Promise<SalesWorkspace> {
    authorizeSalesWorkspace(context);
    const parsed = parse(z.object({ requestId, expectedRevision: revision, header: headerSchema }).strict(), input, "workspace save");
    const header = validateSalesWorkspaceHeader(parsed.header, context.organizationId);
    return this.mutate(context, workspaceId, parsed, "save_draft", { header }, async (tx, workspace) => {
      const changed = salesWorkspaceFingerprint(workspace.header.customerContact ?? null) !== salesWorkspaceFingerprint(header.customerContact ?? null);
      if (changed) await tx.invalidatePreviews(workspace.organizationId, workspace.id);
      return { ...workspace, header, lines: changed ? workspace.lines.map((line) => ({ ...line, previews: undefined, revision: line.revision + 1 })) : workspace.lines };
    });
  }
  async discard(context: OperationContext, workspaceId: string, input: SalesWorkspaceMutation): Promise<SalesWorkspace> {
    validateSalesWorkspaceMutation(input);
    return this.mutate(context, workspaceId, input, "discard", {}, async (tx, workspace) => {
      await this.options.onDiscard?.(tx, workspace);
      return { ...workspace, state: "discarded" };
    });
  }
  async expire(context: OperationContext, limit = 100): Promise<readonly string[]> {
    const principal = authorizeSalesWorkspace(context);
    parse(z.number().int().min(1).max(100), limit, "workspace expiry limit");
    return this.store.run(async (tx) => {
      const kinds = (["new_sales", "order_edit"] as const).filter((kind) => {
        try { authorizeSalesWorkspace(context, { kind, organizationId: context.organizationId, creatorUserId: principal.userId }); return true; }
        catch (error) { if (!(error instanceof V2ApplicationError) || error.code !== "FORBIDDEN") throw error; return false; }
      });
      const ids = await tx.expireDrafts(context.organizationId, principal.userId, this.now().toISOString(), limit, kinds);
      for (const id of ids) {
        const workspace = await tx.get(context.organizationId, principal.userId, id);
        if (workspace) await this.options.onDiscard?.(tx, workspace);
      }
      return ids;
    });
  }
  private async mutate(context: OperationContext, workspaceId: string, input: SalesWorkspaceMutation, operation: string,
    payload: unknown, work: (tx: SalesWorkspaceTransaction, workspace: SalesWorkspace) => Promise<SalesWorkspace>): Promise<SalesWorkspace> {
    authorizeSalesWorkspace(context);
    validateSalesWorkspaceId(workspaceId);
    const fingerprint = salesWorkspaceFingerprint({ operation, expectedRevision: input.expectedRevision, payload });
    return this.store.run(async (tx) => {
      const workspace = await getAuthorizedSalesWorkspace(tx, context, workspaceId, true);
      const replay = await tx.getRequest(context.organizationId, workspaceId, input.requestId);
      if (replay) {
        if (replay.operation !== operation || replay.fingerprint !== fingerprint) throw new V2ApplicationError("CONFLICT", "Workspace request input changed.");
        return visibleState(replay.result, this.now());
      }
      assertSalesWorkspaceMutable(workspace, input.expectedRevision, this.now());
      const result = bumpSalesWorkspaceRevision(await work(tx, workspace), this.now());
      await tx.update(result, workspace.revision);
      await tx.recordRequest(context.organizationId, workspaceId, input.requestId, { operation, fingerprint, result });
      return result;
    });
  }
}
