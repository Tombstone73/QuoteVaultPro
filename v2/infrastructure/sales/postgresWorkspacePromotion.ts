import { createHash } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type { OperationContext } from "../../src/application/operation.js";
import { AuthorityPolicy } from "../../src/authorization/authorityPolicy.js";
import type { Capability } from "../../src/authorization/capabilities.js";
import { failure, success, V2ApplicationError, type ApplicationResult } from "../../src/errors/applicationError.js";
import type { WorkspaceArtworkPromotionInput, WorkspaceArtworkPromotionResult } from "../../src/modules/artwork/workspaceArtwork.js";
import type { CustomerScopedPricingPort } from "../../src/modules/products/customerCommercial.js";
import type { SalesLineSnapshot } from "../../src/modules/sales/contracts.js";
import { OrderApplicationService, type OrderTransaction } from "../../src/modules/sales/orderApplication.js";
import { QuoteApplicationService, type QuoteTransaction } from "../../src/modules/sales/quoteApplication.js";
import {
  authorizeSalesWorkspace, bumpSalesWorkspaceRevision, salesWorkspaceFingerprint,
  validateSalesWorkspaceHeader, validateSalesWorkspaceId, validateSalesWorkspaceLineInput, validateSalesWorkspaceMutation,
} from "../../src/modules/sales/workspaceApplication.js";
import type {
  SalesWorkspaceLineMapEntry, SalesWorkspaceTransaction, WorkspaceLine,
} from "../../src/modules/sales/workspaceContracts.js";
import { workspaceLinePreviewFingerprint } from "../../src/modules/sales/workspaceLines.js";
import {
  WorkspacePromotionConflictError,
  type PromoteSalesWorkspaceInput, type WorkspacePromotion, type WorkspacePromotionReceipt, type WorkspacePromotionResult,
} from "../../src/modules/sales/workspacePromotion.js";
import { brandedId, canonicalJson, type JsonValue } from "../../src/modules/shared/commercialValues.js";
import { createCustomerCommercialPricingPort } from "../products/customerCommercialPricingPort.js";
import { PostgresSalesWorkspaceTransaction } from "./postgresSalesWorkspace.js";

/** The Artwork owner joins this client; it must neither control the transaction
 * nor perform storage/provider I/O. There is deliberately no default no-op. */
export type WorkspaceArtworkPromotionRunner = (client: PoolClient, input: WorkspaceArtworkPromotionInput) => Promise<WorkspaceArtworkPromotionResult>;

export type WorkspacePromotionOptions = Readonly<{
  now?: () => Date;
  workspaceTransaction?: (client: PoolClient) => SalesWorkspaceTransaction;
  /** Composition supplies existing-client owner transactions, never runners
   * that acquire another connection or open a nested transaction. */
  quoteTransaction: (client: PoolClient) => QuoteTransaction;
  orderTransaction: (client: PoolClient, customerPricing: CustomerScopedPricingPort) => OrderTransaction;
}>;

const jsonResult = (value: object): Readonly<Record<string, JsonValue>> => JSON.parse(JSON.stringify(value,
  (_key, entry: unknown) => typeof entry === "bigint" ? entry.toString() : entry)) as Readonly<Record<string, JsonValue>>;

const requireCapability = (context: OperationContext, capability: Capability): void => {
  if (!new AuthorityPolicy().decide(context.principal, {
    capability, resource: { organizationId: context.organizationId },
  }).allowed) throw new V2ApplicationError("FORBIDDEN", "The principal does not have authority for this workspace promotion.");
};

function validateCreatedLine(temp: WorkspaceLine, actual: SalesLineSnapshot, target: "quote" | "order"): void {
  if (actual.productId !== temp.input.productId || actual.quantity !== temp.input.quantity) {
    throw new V2ApplicationError("INTERNAL_ERROR", "Canonical line correlation does not match the workspace input.");
  }
  const preview = temp.previews?.[target];
  if (!preview || canonicalJson(preview.resolvedConfiguration) !== canonicalJson(actual.resolvedConfiguration) ||
    preview.pricingResult.evidenceFingerprint !== actual.pricingResult.evidenceFingerprint ||
    canonicalJson(preview.pricingResult) !== canonicalJson(actual.pricingResult) ||
    canonicalJson(preview.pricingResult.calculatedLineAmount) !== canonicalJson(actual.calculatedLineAmount) ||
    canonicalJson(preview.sellingPriceDecision.resultingLineAmount) !== canonicalJson(actual.sellingLineAmount)) {
    throw new WorkspacePromotionConflictError("preview_stale", "Product configuration or pricing changed. Refresh the workspace before saving.");
  }
}

/** One transaction owns the workspace lock, canonical creation, owner effects,
 * complete line map and final receipt. Canonical failure envelopes must escape
 * as exceptions before COMMIT, even when a failing owner already wrote rows. */
export class PostgresWorkspacePromotion implements WorkspacePromotion {
  constructor(
    private readonly pool: Pick<Pool, "connect">,
    private readonly promoteArtwork: WorkspaceArtworkPromotionRunner,
    private readonly options: WorkspacePromotionOptions,
  ) {}

  async promote(context: OperationContext, input: PromoteSalesWorkspaceInput): Promise<ApplicationResult<WorkspacePromotionResult>> {
    try {
      const principal = authorizeSalesWorkspace(context);
      if (!input || Object.keys(input).some((key) => !["workspaceId", "target", "requestId", "expectedRevision"].includes(key))) {
        throw new V2ApplicationError("VALIDATION_ERROR", "Invalid workspace promotion input.");
      }
      validateSalesWorkspaceId(input.workspaceId);
      validateSalesWorkspaceMutation({ requestId: input.requestId, expectedRevision: input.expectedRevision });
      if (input.target !== "quote" && input.target !== "order") throw new V2ApplicationError("VALIDATION_ERROR", "Invalid promotion target.");
      if (context.businessRequest?.id !== input.requestId) throw new V2ApplicationError("VALIDATION_ERROR", "The promotion business request identity does not match the operation context.");
      requireCapability(context, input.target === "quote" ? "quote.create" : "order.create");
      const client = await this.pool.connect();
      try {
        await client.query("BEGIN");
        const store = this.options.workspaceTransaction?.(client) ?? new PostgresSalesWorkspaceTransaction(client);
        const workspace = await store.get(context.organizationId, principal.userId, input.workspaceId, true);
        if (!workspace) throw new V2ApplicationError("NOT_FOUND", "Sales workspace was not found.");
        authorizeSalesWorkspace(context, workspace);
        if (workspace.lines.some((line) => line.input.selling && line.input.selling.kind !== "calculated")) {
          requireCapability(context, input.target === "quote" ? "quote.overridePrice" : "order.overridePrice");
        }
        const now = this.options.now?.() ?? new Date();
        if (!Number.isFinite(Date.parse(workspace.expiresAt)) || !Number.isFinite(now.getTime()) ||
          (workspace.state !== "promoted" && Date.parse(workspace.expiresAt) <= now.getTime())) {
          throw new WorkspacePromotionConflictError("workspace_expired", "Sales workspace has expired or has invalid expiry evidence.");
        }
        if (workspace.kind !== "new_sales" || workspace.sourceDocumentId || workspace.sourceDocumentKind || workspace.baseRevision) {
          throw new WorkspacePromotionConflictError("workspace_state", "Only a new Sales workspace can be promoted.");
        }
        const fingerprint = salesWorkspaceFingerprint({
          organizationId: workspace.organizationId, creatorUserId: workspace.creatorUserId, workspaceId: workspace.id,
          target: input.target, inputRevision: input.expectedRevision, header: workspace.header,
          lines: workspace.lines, expiresAt: workspace.expiresAt,
        });
        // The transaction-scoped request lock reserves this key until its
        // immutable target/input-fingerprint receipt is written below.
        await store.lockPromotionRequest(context.organizationId, input.requestId);
        const requestReceipt = await store.findPromotionRequest(context.organizationId, input.requestId);
        const existing = await store.getPromotion(context.organizationId, workspace.id);
        if (requestReceipt && (requestReceipt.workspaceId !== workspace.id || requestReceipt.fingerprint !== fingerprint)) {
          throw new WorkspacePromotionConflictError("promotion_request", "Promotion request is already used for different input.");
        }
        if (existing) {
          if (workspace.state !== "promoted" || existing.requestId !== input.requestId || existing.target !== input.target ||
            existing.inputRevision !== input.expectedRevision || existing.fingerprint !== fingerprint) {
            throw new WorkspacePromotionConflictError("promotion_request", "Sales workspace was already promoted with different input or request identity.");
          }
          const receipt = existing as WorkspacePromotionReceipt;
          if (receipt.result === undefined || typeof receipt.artworkPromoted !== "boolean") {
            throw new V2ApplicationError("INTERNAL_ERROR", "Promotion receipt is incomplete.");
          }
          if (receipt.artworkPromoted) {
            requireCapability(context, "artwork.adopt");
            requireCapability(context, "artwork.assign");
            if (input.target === "quote") requireCapability(context, "quote.edit");
          }
          await client.query("COMMIT");
          return success({ receipt, replayed: true, promotedWorkspaceHeader: receipt.header });
        }
        if (workspace.state !== "draft") throw new WorkspacePromotionConflictError("workspace_state", "Sales workspace is not an active draft.");
        if (workspace.revision !== input.expectedRevision) throw new WorkspacePromotionConflictError("workspace_revision", "Sales workspace revision has changed.");
        const header = validateSalesWorkspaceHeader(workspace.header, context.organizationId);
        if (!header.customerContact || !workspace.lines.length) throw new V2ApplicationError("VALIDATION_ERROR", "Promotion requires a customer or contact and at least one line.");
        const tempIds = new Set<string>();
        for (const [position, line] of workspace.lines.entries()) {
          validateSalesWorkspaceId(line.id);
          validateSalesWorkspaceLineInput(line.input);
          if (line.workspaceId !== workspace.id || line.position !== position || tempIds.has(line.id) || line.sourceLineId) {
            throw new V2ApplicationError("INTERNAL_ERROR", "Workspace line identity or ordering is inconsistent.");
          }
          tempIds.add(line.id);
          const preview = line.previews?.[input.target];
          if (!preview) throw new WorkspacePromotionConflictError("preview_required", "Refresh target pricing before saving this workspace.");
          if (preview.target !== input.target || preview.inputFingerprint !== workspaceLinePreviewFingerprint(line.input, header.customerContact) ||
            canonicalJson(preview.customerContact ?? null) !== canonicalJson(header.customerContact)) {
            throw new WorkspacePromotionConflictError("preview_stale", "Workspace input changed since its pricing preview. Refresh before saving.");
          }
        }
        await store.beginPromotion(context.organizationId, workspace.id, workspace.revision, input.requestId, input.target, fingerprint);
        // The owner reserves its own tuple; never pre-reserve it in this coordinator.
        const ownerRequestId = `workspace:${input.target}:${createHash("sha256").update(canonicalJson({
          organizationId: context.organizationId, workspaceId: workspace.id, requestId: input.requestId,
        })).digest("hex")}`;
        const common = {
          businessRequestId: ownerRequestId, customerContact: header.customerContact,
          ...(header.purchaseOrderNumber === undefined ? {} : { purchaseOrderNumber: header.purchaseOrderNumber }),
          ...(header.requestedDueDate === undefined ? {} : { requestedDueDate: header.requestedDueDate }),
          ...(header.requestedFulfillment === undefined ? {} : { requestedFulfillment: header.requestedFulfillment }),
          ...(header.terms === undefined ? {} : { terms: header.terms }),
        };
        const ownerContext = (command: unknown): OperationContext => ({ ...context,
          operationId: `sales.${input.target}.create.v1`,
          businessRequest: { id: ownerRequestId, payloadFingerprint: `sha256:${salesWorkspaceFingerprint(command)}` },
        });
        let documentId: string;
        let lineMap: SalesWorkspaceLineMapEntry[];
        let reread: () => Promise<{ revision: string; number: { display: string } } & object>;
        if (input.target === "quote") {
          const tx = this.options.quoteTransaction(client);
          const command = { ...common, lines: workspace.lines.map((line) => line.input) };
          const created = await new QuoteApplicationService({ transaction: (action) => action(tx) }).create(ownerContext(command), command);
          if (!created.ok) throw created.error;
          const lines = created.value.quote.quote.lines;
          if (lines.length !== workspace.lines.length || new Set(lines.map((line) => line.lineId)).size !== lines.length) {
            throw new V2ApplicationError("INTERNAL_ERROR", "Created Quote line cardinality does not match the workspace.");
          }
          documentId = created.value.quote.quote.quoteId;
          lineMap = workspace.lines.map((line, index) => {
            const actual = lines[index]!;
            validateCreatedLine(line, actual, "quote");
            return { workspaceLineId: line.id, canonicalLineId: actual.lineId, position: line.position };
          });
          reread = async () => {
            const final = await tx.read(brandedId<"OrganizationId">(context.organizationId), brandedId<"QuoteId">(documentId));
            if (!final) throw new V2ApplicationError("INTERNAL_ERROR", "Created Quote could not be read after Artwork promotion.");
            return final;
          };
        } else {
      const customerPricing = createCustomerCommercialPricingPort(client);
          const tx = this.options.orderTransaction(client, customerPricing);
          if (tx.customerPricing !== customerPricing) {
            throw new V2ApplicationError("INTERNAL_ERROR", "Workspace Order promotion requires the existing customer pricing adapter on the same client.");
          }
          const command = { ...common, lines: workspace.lines.map((line) => ({ ...line.input, clientLineKey: line.id })) };
          const created = await new OrderApplicationService({ transaction: (action) => action(tx) }).create(ownerContext(command), command);
          if (!created.ok) throw created.error;
          const lines = created.value.order.order.lines;
          const correlations = created.value.lineCorrelations ?? [];
          if (lines.length !== workspace.lines.length || correlations.length !== lines.length ||
            new Set(lines.map((line) => line.lineId)).size !== lines.length ||
            new Set(correlations.map((item) => item.clientLineKey)).size !== lines.length ||
            new Set(correlations.map((item) => item.orderLineId)).size !== lines.length) {
            throw new V2ApplicationError("INTERNAL_ERROR", "Created Order line correlations are incomplete.");
          }
          documentId = created.value.order.order.orderId;
          lineMap = workspace.lines.map((line) => {
            const correlation = correlations.find((item) => item.clientLineKey === line.id);
            const actual = lines.find((item) => item.lineId === correlation?.orderLineId);
            if (!actual) throw new V2ApplicationError("INTERNAL_ERROR", "Created Order line correlation is missing.");
            validateCreatedLine(line, actual, "order");
            return { workspaceLineId: line.id, canonicalLineId: actual.lineId, position: line.position };
          });
          reread = async () => {
            const final = await tx.read(brandedId<"OrganizationId">(context.organizationId), brandedId<"OrderId">(documentId));
            if (!final) throw new V2ApplicationError("INTERNAL_ERROR", "Created Order could not be read after Artwork promotion.");
            return final;
          };
        }
        await store.recordPromotionLineMap(context.organizationId, workspace.id, input.target, documentId, lineMap);
        const artwork = await this.promoteArtwork(client, {
          organizationId: context.organizationId, workspaceId: workspace.id, actor: context,
          documentKind: input.target, documentId, lineMap,
        });
        const document = await reread();
        const receipt: WorkspacePromotionReceipt = {
          workspaceId: workspace.id, organizationId: context.organizationId, requestId: input.requestId,
          fingerprint, inputRevision: input.expectedRevision, target: input.target, documentId,
          documentRevision: document.revision, displayNumber: document.number.display,
          header, lineMap, promotedAt: now.toISOString(), result: jsonResult(document), artworkPromoted: artwork.promotedCount > 0,
        };
        await store.recordPromotion(receipt);
        await store.update({ ...bumpSalesWorkspaceRevision(workspace, now), state: "promoted", promotion: receipt }, workspace.revision);
        await client.query("COMMIT");
        return success({ receipt, replayed: false, promotedWorkspaceHeader: receipt.header });
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    } catch (error) {
      return failure(error instanceof V2ApplicationError ? error : new V2ApplicationError("INTERNAL_ERROR", "Workspace promotion could not be completed.", {}, { cause: error }));
    }
  }
}
